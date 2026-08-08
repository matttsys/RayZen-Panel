/**
 * First-run setup: the route that makes the Deploy to Cloudflare button usable.
 *
 * A deployment created by the button has no email, no password, and a randomly
 * generated panel path that only the Worker knows. This page is the one and only
 * thing that reveals that path, and it must stop existing the moment somebody has
 * used it. Both halves matter:
 *
 *   - If it never appeared, a button deployment would be unreachable: there is no
 *     way to guess a 24-character random path.
 *   - If it kept appearing, anyone who found the Worker's address could reset the
 *     administrator's credentials.
 *
 * These tests drive the real router, because the second property is a routing
 * property: after the claim, `/` has to behave exactly as it does on a deployment
 * that never had a setup page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEnv, createKvStub, type KvStub } from '../helpers/worker';
import { invalidateIdentityCache, IDENTITY_KV_KEY } from '@identity';
import { verifyPassword } from '../../src/auth/password';

vi.mock('cloudflare:sockets', () => ({
    connect: () => {
        throw new Error('no socket in this suite');
    }
}));

const HOST = 'my-panel.workers.dev';

/** Imported lazily so the socket mock is registered before the module graph loads. */
async function router() {
    return (await import('../../src/worker')).default;
}

/**
 * A deployment with no embedded identity block: the Deploy to Cloudflare shape.
 * `EMBEDED_SETTINGS` is deleted rather than stubbed, because its mere presence is
 * what makes `resolveIdentity` choose the embedded source.
 */
function unembedded(): void {
    delete (globalThis as Record<string, unknown>).EMBEDED_SETTINGS;
    invalidateIdentityCache();
}

let embedded: unknown;
let kv: KvStub;

beforeEach(() => {
    embedded = (globalThis as Record<string, unknown>).EMBEDED_SETTINGS;
    kv = createKvStub();
    unembedded();
});

afterEach(() => {
    (globalThis as Record<string, unknown>).EMBEDED_SETTINGS = embedded;
    invalidateIdentityCache();
    vi.unstubAllGlobals();
});

function get(path = '/', env = createEnv(kv.namespace)): Promise<Response> {
    return router().then(worker => worker.fetch(new Request(`https://${HOST}${path}`), env));
}

function claim(body: unknown, env = createEnv(kv.namespace)): Promise<Response> {
    return router().then(worker =>
        worker.fetch(
            new Request(`https://${HOST}/setup/claim`, {
                method: 'POST',
                body: JSON.stringify(body)
            }),
            env
        )
    );
}

interface ClaimResult {
    success: boolean;
    message: string | null;
    body: { panelUrl?: string; loginUrl?: string; username?: string } | null;
}

const VALID = { email: 'owner@example.invalid', password: 'Passw0rdy' };

describe('the setup page appears exactly while it is needed', () => {
    it('is served at the root of an unclaimed deployment', async () => {
        const response = await get('/');

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toContain('text/html');
        expect(await response.text()).toContain('setup');
    });

    it('carries the security header set, like every other page', async () => {
        const response = await get('/');

        expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
        expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
        expect(response.headers.get('Cache-Control')).toBe('no-store');
    });

    it('does not appear once a password exists', async () => {
        kv = createKvStub({ pwd: 'already-set' });
        const response = await get('/');

        // Whatever the unmatched-path fallback does, it is not the setup page.
        expect(response.status).not.toBe(200);
    });

    it('does not appear on a deployment whose identity is embedded in the script', async () => {
        // A packaged deployment's operator already knows their panel URL, and showing
        // a setup page on a path meant to look uninteresting would be a fingerprint.
        (globalThis as Record<string, unknown>).EMBEDED_SETTINGS = embedded;
        invalidateIdentityCache();

        const response = await get('/');
        expect(response.status).not.toBe(200);
    });

    it('claiming is refused once the deployment is claimed', async () => {
        kv = createKvStub({ pwd: 'already-set' });
        const response = await claim(VALID);

        // The route stops existing, so this is the fallback's answer rather than a
        // 403: a claimed deployment must not confirm that a setup route ever existed.
        expect(response.status).not.toBe(200);
    });
});

describe('claiming a deployment', () => {
    it('sets the password, records the email and reveals the panel URL', async () => {
        const response = await claim(VALID);
        const payload = (await response.json()) as ClaimResult;

        expect(response.status).toBe(200);
        expect(payload.success).toBe(true);
        expect(payload.body?.username).toBe(VALID.email);

        // The revealed URL is the only copy of the secret path anyone will ever see.
        const path = JSON.parse(kv.store.get(IDENTITY_KV_KEY) ?? '{}').securePath as string;
        expect(payload.body?.panelUrl).toBe(`https://${HOST}/${path}/panel`);
        expect(payload.body?.loginUrl).toBe(`https://${HOST}/${path}/login`);

        expect((await verifyPassword(VALID.password, kv.store.get('pwd') ?? null)).valid).toBe(true);
    });

    it('keeps the claim route and origin stable while another request runs during KV I/O', async () => {
        const base = createKvStub();
        kv = base;

        let releasePasswordRead!: () => void;
        let markPasswordReadStarted!: () => void;
        const passwordReadStarted = new Promise<void>(resolve => { markPasswordReadStarted = resolve; });
        const passwordReadRelease = new Promise<void>(resolve => { releasePasswordRead = resolve; });
        let blocked = false;

        const namespace = {
            ...base.namespace,
            async get(key: string, options?: { type?: string } | string) {
                if (key === 'pwd' && !blocked) {
                    blocked = true;
                    markPasswordReadStarted();
                    await passwordReadRelease;
                }
                return base.namespace.get(key, options);
            }
        } as unknown as KVNamespace;
        const env = createEnv(namespace);
        const worker = await router();

        const claimPromise = worker.fetch(
            new Request(`https://${HOST}/setup/claim`, {
                method: 'POST',
                body: JSON.stringify(VALID)
            }),
            env
        );

        await passwordReadStarted;

        // This is the browser's ordinary parallel page traffic. Before the fix it
        // overwrote the module-level pathname and origin while the claim awaited KV,
        // causing the POST to return the setup HTML with status 200.
        const parallel = await worker.fetch(new Request('https://other-host.example/'), env);
        expect(parallel.headers.get('Content-Type')).toContain('text/html');

        releasePasswordRead();
        const response = await claimPromise;
        const payload = (await response.json()) as ClaimResult;

        expect(response.headers.get('Content-Type')).toContain('application/json');
        expect(payload.success).toBe(true);
        expect(payload.body?.panelUrl).toMatch(new RegExp(`^https://${HOST}/`));
        expect(payload.body?.panelUrl).not.toContain('other-host.example');
    });

    it('the revealed panel URL actually serves the panel', async () => {
        // The end-to-end property the whole flow exists for. A URL that 404s would
        // leave the operator with a deployment they cannot reach and no way back.
        const payload = (await (await claim(VALID)).json()) as ClaimResult;
        const path = new URL(payload.body!.panelUrl!).pathname;

        const response = await get(path);
        expect([200, 302]).toContain(response.status);
    });

    it('a second claim is refused, so the first person keeps the deployment', async () => {
        await claim(VALID);

        const second = await claim({ email: 'attacker@example.invalid', password: 'Attack3rPass' });
        expect(second.status).not.toBe(200);
        const verifier = kv.store.get('pwd') ?? null;
        expect((await verifyPassword(VALID.password, verifier)).valid).toBe(true);
        expect((await verifyPassword('Attack3rPass', verifier)).valid).toBe(false);
    });

    it('rejects a password that fails the documented rule', async () => {
        for (const password of ['short1A', 'nocapital1', 'NoDigitsHere']) {
            const payload = (await (await claim({ ...VALID, password })).json()) as ClaimResult;
            expect(payload.success, password).toBe(false);
            expect(kv.store.has('pwd'), password).toBe(false);
        }
    });

    it('rejects a malformed email', async () => {
        const payload = (await (await claim({ ...VALID, email: 'not-an-email' })).json()) as ClaimResult;

        expect(payload.success).toBe(false);
        expect(kv.store.has('pwd')).toBe(false);
    });

    it('rejects a body that is not JSON', async () => {
        const worker = await router();
        const response = await worker.fetch(
            new Request(`https://${HOST}/setup/claim`, { method: 'POST', body: '{not json' }),
            createEnv(kv.namespace)
        );

        expect(response.status).toBe(400);
    });

    it('rejects a GET on the claim route', async () => {
        expect((await get('/setup/claim')).status).toBe(405);
    });

    it('rejects an oversized body without parsing it', async () => {
        const worker = await router();
        const response = await worker.fetch(
            new Request(`https://${HOST}/setup/claim`, {
                method: 'POST',
                body: JSON.stringify({ ...VALID, filler: 'x'.repeat(8 * 1024) })
            }),
            createEnv(kv.namespace)
        );

        expect(response.status).toBe(413);
    });
});

describe('first-run ownership constraints', () => {
    it('RAYZEN_ADMIN_EMAIL pins the account, so another address cannot claim it', async () => {
        const env = createEnv(kv.namespace, { RAYZEN_ADMIN_EMAIL: 'Owner@Example.invalid' } as never);
        const payload = (await (await claim({ email: 'attacker@example.invalid', password: 'Attack3rPass' }, env)).json()) as ClaimResult;
        expect(payload.success).toBe(true);
        expect(payload.body?.username).toBe('owner@example.invalid');
    });

    it('the setup page shows the pinned address rather than an empty field', async () => {
        const env = createEnv(kv.namespace, { RAYZEN_ADMIN_EMAIL: 'owner@example.invalid' } as never);
        const html = await (await get('/', env)).text();
        expect(html).toContain('data-email-fixed=true');
        expect(html).toContain('owner@example.invalid');
    });

    it('does not expose or require the retired setup-token capability', async () => {
        const env = createEnv(kv.namespace, { RAYZEN_SETUP_TOKEN: 'obsolete-and-ignored' } as never);
        const html = await (await get('/', env)).text();
        expect(html).not.toContain('data-token-required');
        const payload = (await (await claim(VALID, env)).json()) as ClaimResult;
        expect(payload.success).toBe(true);
    });

    it('a whitespace-only administrator email counts as unset', async () => {
        const env = createEnv(kv.namespace, { RAYZEN_ADMIN_EMAIL: '   ' } as never);
        const html = await (await get('/', env)).text();
        expect(html).toContain('data-email-fixed=false');
        const payload = (await (await claim(VALID, env)).json()) as ClaimResult;
        expect(payload.success).toBe(true);
        expect(payload.body?.username).toBe(VALID.email.toLowerCase());
    });
});
