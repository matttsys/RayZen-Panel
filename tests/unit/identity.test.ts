/**
 * Identity resolution: where a deployment's panel path, credentials and hostname
 * come from.
 *
 * This module is what makes one committed repository deployable by anyone. There is
 * no build step that knows the hostname, no server that hands out credentials, and
 * no packaged artifact in the Deploy to Cloudflare path, so everything has to be
 * resolved from the request, the environment, or KV, in that order of authority.
 *
 * The properties worth pinning are the ones whose failure is silent:
 *
 *   - Precedence. An embedded block must win, or upgrading an existing packaged
 *     deployment to this build would move its identity and orphan every
 *     subscription link already handed out.
 *   - Write frequency. The free plan allows 1,000 KV writes a day. A resolution that
 *     wrote on every cold start would spend that budget on nothing.
 *   - Credential handling. The account id and API token are read from the
 *     environment and must never reach KV, because KV is what settings exports and
 *     backups read.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    IDENTITY_KV_KEY,
    claimIdentity,
    invalidateIdentityCache,
    persistIdentitySettings,
    readIdentityRecord,
    resolveIdentity
} from '@identity';
import { createEnv, createKvStub, type KvStub } from '../helpers/worker';
import { TEST_EMBEDED_SETTINGS } from '../setup/globals';

const HOST = 'my-panel.workers.dev';

const request = (host = HOST) => new Request(`https://${host}/`);

let embedded: unknown;
let kv: KvStub;

beforeEach(() => {
    embedded = (globalThis as Record<string, unknown>).EMBEDED_SETTINGS;
    delete (globalThis as Record<string, unknown>).EMBEDED_SETTINGS;
    invalidateIdentityCache();
    kv = createKvStub();
});

afterEach(() => {
    (globalThis as Record<string, unknown>).EMBEDED_SETTINGS = embedded;
    invalidateIdentityCache();
});

describe('bootstrapping an identity', () => {
    it('generates a complete identity and stores it', async () => {
        const identity = await resolveIdentity(request(), createEnv(kv.namespace));

        expect(identity.source).toBe('kv');
        expect(identity.mainDomain).toBe(HOST);
        expect(identity.workerName).toBe('my-panel');

        // A path short enough to brute-force, or one carrying characters that need
        // URL-escaping, would break the only thing protecting the login page.
        expect(identity.securePath).toMatch(/^[A-Za-z0-9]{24}$/);
        expect(identity.vlUUID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(identity.trPass).toMatch(/^[A-Za-z0-9]{32}$/);

        expect(JSON.parse(kv.store.get(IDENTITY_KV_KEY) ?? '{}')).toMatchObject({
            securePath: identity.securePath,
            vlUUID: identity.vlUUID,
            trPass: identity.trPass
        });
    });

    it('generates a different identity per deployment', async () => {
        const first = await resolveIdentity(request(), createEnv(createKvStub().namespace));
        invalidateIdentityCache();
        const second = await resolveIdentity(request(), createEnv(createKvStub().namespace));

        expect(first.securePath).not.toBe(second.securePath);
        expect(first.vlUUID).not.toBe(second.vlUUID);
        expect(first.trPass).not.toBe(second.trPass);
    });

    it('writes once, not once per cold start', async () => {
        await resolveIdentity(request(), createEnv(kv.namespace));
        invalidateIdentityCache();
        await resolveIdentity(request(), createEnv(kv.namespace));
        invalidateIdentityCache();
        await resolveIdentity(request(), createEnv(kv.namespace));

        expect(kv.calls.filter(entry => entry.op === 'put')).toHaveLength(1);
    });

    it('reads once per isolate, then serves from cache', async () => {
        const env = createEnv(kv.namespace);
        await resolveIdentity(request(), env);
        await resolveIdentity(request(), env);
        await resolveIdentity(request(), env);

        // The relay path resolves an identity for every connection, so a KV read per
        // call would be a read per WebSocket.
        expect(kv.calls.filter(entry => entry.op === 'get')).toHaveLength(1);
    });

    it('leaves an unclaimed deployment with no email', async () => {
        const identity = await resolveIdentity(request(), createEnv(kv.namespace));
        expect(identity.accEmail).toBe('');
    });
});

describe('the hostname follows the request', () => {
    it('reports whichever hostname the client used', async () => {
        const env = createEnv(kv.namespace);

        expect((await resolveIdentity(request('a.workers.dev'), env)).mainDomain).toBe('a.workers.dev');
        expect((await resolveIdentity(request('panel.example.com'), env)).mainDomain).toBe('panel.example.com');
    });

    it('derives the worker name from the hostname, but lets the environment declare it', async () => {
        // `hostname.split('.')[0]` is right for a workers.dev address and wrong for a
        // custom domain, where the first label is whatever the operator chose.
        const derived = await resolveIdentity(request('rayzen-edge.acct.workers.dev'), createEnv(kv.namespace));
        expect(derived.workerName).toBe('rayzen-edge');

        invalidateIdentityCache();
        const declared = await resolveIdentity(
            request('panel.example.com'),
            createEnv(kv.namespace, { RAYZEN_WORKER_NAME: 'rayzen-edge' } as never)
        );
        expect(declared.workerName).toBe('rayzen-edge');
    });
});

describe('environment overrides', () => {
    it('override stored values field by field', async () => {
        const identity = await resolveIdentity(
            request(),
            createEnv(kv.namespace, {
                RAYZEN_SECURE_PATH: 'pinnedPath',
                RAYZEN_VL_UUID: '00000000-0000-4000-8000-00000000abcd',
                RAYZEN_TR_PASS: 'pinnedTrojanPassword',
                RAYZEN_PROXY_IP_MODE: 'nat64',
                RAYZEN_PROXY_IPS: '203.0.113.7, 203.0.113.8',
                RAYZEN_PREFIXES: '[2001:db8::]',
                RAYZEN_FALLBACK: 'fallback.example',
                RAYZEN_DOH_URL: 'https://doh.example/dns-query',
                RAYZEN_ADMIN_EMAIL: 'Owner@Example.Invalid'
            } as never)
        );

        expect(identity.securePath).toBe('pinnedPath');
        expect(identity.vlUUID).toBe('00000000-0000-4000-8000-00000000abcd');
        expect(identity.trPass).toBe('pinnedTrojanPassword');
        expect(identity.proxyIpMode).toBe('nat64');
        expect(identity.proxyIPs).toEqual(['203.0.113.7', '203.0.113.8']);
        expect(identity.prefixes).toEqual(['[2001:db8::]']);
        expect(identity.fallback).toBe('fallback.example');
        expect(identity.dohUrl).toBe('https://doh.example/dns-query');
        expect(identity.accEmail).toBe('owner@example.invalid');
    });

    it('leave unset fields generated, so one value can be pinned without the rest', async () => {
        const identity = await resolveIdentity(
            request(),
            createEnv(kv.namespace, { RAYZEN_SECURE_PATH: 'pinnedPath' } as never)
        );

        expect(identity.securePath).toBe('pinnedPath');
        expect(identity.trPass).toMatch(/^[A-Za-z0-9]{32}$/);
    });

    it('keep the Cloudflare credentials out of KV', async () => {
        await resolveIdentity(
            request(),
            createEnv(kv.namespace, {
                RAYZEN_CF_ACCOUNT_ID: 'account-id-value',
                RAYZEN_CF_API_TOKEN: 'api-token-value'
            } as never)
        );

        const stored = kv.store.get(IDENTITY_KV_KEY) ?? '';
        expect(stored).not.toContain('api-token-value');
        expect(stored).not.toContain('account-id-value');
    });

    it('supply the credentials to the running deployment', async () => {
        const identity = await resolveIdentity(
            request(),
            createEnv(kv.namespace, {
                RAYZEN_CF_ACCOUNT_ID: 'account-id-value',
                RAYZEN_CF_API_TOKEN: 'api-token-value'
            } as never)
        );

        expect(identity.accID).toBe('account-id-value');
        expect(identity.apiToken).toBe('api-token-value');
    });
});

describe('an embedded identity block wins', () => {
    beforeEach(() => {
        (globalThis as Record<string, unknown>).EMBEDED_SETTINGS = TEST_EMBEDED_SETTINGS;
        invalidateIdentityCache();
    });

    it('is used without touching KV at all', async () => {
        const identity = await resolveIdentity(request(), createEnv(kv.namespace));

        expect(identity.source).toBe('embedded');
        expect(identity.securePath).toBe(TEST_EMBEDED_SETTINGS.securePath);
        // An existing packaged deployment upgrading to this build must keep the exact
        // path and credentials it has already handed out.
        expect(identity.vlUUID).toBe(TEST_EMBEDED_SETTINGS.vlUUID);
        expect(kv.calls).toEqual([]);
    });

    it('falls back to the environment for credentials it does not carry', async () => {
        (globalThis as Record<string, unknown>).EMBEDED_SETTINGS = {
            ...TEST_EMBEDED_SETTINGS,
            accID: ''
        };
        invalidateIdentityCache();

        const identity = await resolveIdentity(
            request(),
            createEnv(kv.namespace, { RAYZEN_CF_API_TOKEN: 'env-token' } as never)
        );

        expect(identity.apiToken).toBe('env-token');
    });

    it('falls back to the request hostname when its own is empty', async () => {
        // A self-redeploy from a renamed Worker can carry a stale hostname, and a
        // stale hostname means every generated config points at the wrong host.
        (globalThis as Record<string, unknown>).EMBEDED_SETTINGS = {
            ...TEST_EMBEDED_SETTINGS,
            mainDomain: ''
        };
        invalidateIdentityCache();

        expect((await resolveIdentity(request(), createEnv(kv.namespace))).mainDomain).toBe(HOST);
    });
});

describe('a deployment with nothing to resolve from', () => {
    it('explains which binding is missing rather than failing obscurely', async () => {
        await expect(resolveIdentity(request(), {} as Env)).rejects.toThrow(/variable name kv/);
    });

    it('distinguishes an unreachable namespace from an empty one', async () => {
        // Treating a read failure as "absent" would generate and write a second
        // identity, silently invalidating every subscription link in circulation.
        const broken = createKvStub();
        broken.namespace.get = () => Promise.reject(new Error('KV exploded'));

        await expect(resolveIdentity(request(), createEnv(broken.namespace)))
            .rejects.toThrow(/could not read its identity/);
    });

    it('reports a write failure instead of pretending the deployment is ready', async () => {
        const broken = createKvStub();
        broken.namespace.put = () => Promise.reject(new Error('over the write limit'));

        await expect(resolveIdentity(request(), createEnv(broken.namespace)))
            .rejects.toThrow(/could not write its identity/);
    });
});

describe('a hand-edited or partial document', () => {
    it('is filled in rather than rejected', async () => {
        // KV is operator-visible, so a half-written document is a real state. Losing
        // the deployment to it would be worse than regenerating the missing fields.
        kv = createKvStub({ [IDENTITY_KV_KEY]: { securePath: 'keptPath' } });

        const identity = await resolveIdentity(request(), createEnv(kv.namespace));

        expect(identity.securePath).toBe('keptPath');
        expect(identity.vlUUID).toMatch(/^[0-9a-f-]{36}$/);
        expect(identity.proxyIPs).toEqual([]);
    });

    it('survives a valid JSON value of the wrong type', async () => {
        kv = createKvStub({ [IDENTITY_KV_KEY]: [1, 2, 3] });

        const identity = await resolveIdentity(request(), createEnv(kv.namespace));
        expect(identity.securePath).toMatch(/^[A-Za-z0-9]{24}$/);
    });

    it('refuses to regenerate over an unparseable record', async () => {
        // Regenerating would hand the deployment a new panel path and new protocol
        // credentials, silently invalidating every subscription in circulation. The
        // operator has to make that call, so the message names the key to delete.
        kv = createKvStub({ [IDENTITY_KV_KEY]: 'not json at all' });

        await expect(resolveIdentity(request(), createEnv(kv.namespace)))
            .rejects.toThrow(/rz:identity/);
    });
});

describe('writing identity changes back', () => {
    it('persists the fields the settings form owns and drops the cache', async () => {
        const env = createEnv(kv.namespace);
        await resolveIdentity(request(), env);

        await persistIdentitySettings(env, { securePath: 'newPath', proxyIPs: ['203.0.113.9'] });

        // Resolved fresh, because a cached identity would serve the old path until the
        // isolate recycled: the operator would change the path and still see the old
        // URL in the panel.
        const identity = await resolveIdentity(request(), env);
        expect(identity.securePath).toBe('newPath');
        expect(identity.proxyIPs).toEqual(['203.0.113.9']);
    });

    it('leaves the fields it was not given alone', async () => {
        const env = createEnv(kv.namespace);
        const before = await resolveIdentity(request(), env);

        await persistIdentitySettings(env, { securePath: 'newPath' });

        expect((await readIdentityRecord(env)).trPass).toBe(before.trPass);
    });

    it('claiming records the email in lower case', async () => {
        const env = createEnv(kv.namespace);
        await resolveIdentity(request(), env);

        await claimIdentity(env, '  Owner@Example.Invalid  ');

        expect((await resolveIdentity(request(), env)).accEmail).toBe('owner@example.invalid');
    });

    it('claiming does not disturb the generated path or credentials', async () => {
        const env = createEnv(kv.namespace);
        const before = await resolveIdentity(request(), env);

        await claimIdentity(env, 'owner@example.invalid');
        const after = await resolveIdentity(request(), env);

        expect(after.securePath).toBe(before.securePath);
        expect(after.vlUUID).toBe(before.vlUUID);
        expect(after.trPass).toBe(before.trPass);
    });
});
