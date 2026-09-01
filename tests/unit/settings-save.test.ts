/**
 * Saving settings on a deployment whose identity lives in KV.
 *
 * This is the write path the Deploy to Cloudflare flow depends on, and it is the one
 * place where "which source did the identity come from" changes behaviour rather than
 * only bookkeeping:
 *
 *   - A KV-sourced deployment writes the changed fields to KV. One `kv.put`, no upload,
 *     no Cloudflare API token. That is what lets a one-click deployment change its
 *     panel path with no credentials at all.
 *   - A deployment with an embedded identity block has those values inside the running
 *     script, so changing them means rebuilding and re-uploading it, which needs a
 *     token. Without one, the honest answer is an error that says so.
 *
 * The regression at the bottom is the one that mattered in practice: rotating the panel
 * path on a deployment with no Telegram bot answered 500. `getDataset` writes an empty
 * bot record on first read, so every deployment has one and almost none has a bot, and
 * the code re-registered the webhook whenever the record existed rather than whenever a
 * token did. Rotating the path is the most ordinary thing an operator does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEnv, createKvStub, initRequestGlobals, validSettingsForm, type KvStub } from '../helpers/worker';
import { invalidateIdentityCache, IDENTITY_KV_KEY } from '@identity';
import { TEST_EMBEDED_SETTINGS, TEST_MAIN_DOMAIN } from '../setup/globals';

vi.mock('cloudflare:sockets', () => ({
    connect: () => {
        throw new Error('no socket in this suite');
    }
}));

const HOST = 'my-panel.workers.dev';

async function router() {
    return (await import('../../src/worker')).default;
}

/** A claimed KV-sourced deployment: password set, settings present, no bot. */
function claimedDeployment(overrides: Record<string, unknown> = {}): KvStub {
    return createKvStub({
        pwd: 'panel-password',
        secretKey: 'b'.repeat(64),
        proxySettings: { ...validSettingsForm(), panelVersion: VERSION },
        warpAccounts: [{ privateKey: 'k', publicKey: 'p', warpIPv6: '::1/128', reserved: 'AAAA' }],
        [IDENTITY_KV_KEY]: {
            accEmail: 'owner@example.invalid',
            securePath: 'currentSecretPath',
            vlUUID: '00000000-0000-4000-8000-0000000000aa',
            trPass: 'currentTrojanPassword',
            proxyIpMode: 'proxyip',
            proxyIPs: [],
            prefixes: [],
            fallback: '',
            dohUrl: '',
            createdAt: '2026-01-01T00:00:00.000Z'
        },
        ...overrides
    });
}

let embedded: unknown;

beforeEach(() => {
    embedded = (globalThis as Record<string, unknown>).EMBEDED_SETTINGS;
    delete (globalThis as Record<string, unknown>).EMBEDED_SETTINGS;
    invalidateIdentityCache();
});

afterEach(() => {
    (globalThis as Record<string, unknown>).EMBEDED_SETTINGS = embedded;
    invalidateIdentityCache();
});

async function session(kv: KvStub): Promise<string> {
    const worker = await router();
    const response = await worker.fetch(
        new Request(`https://${HOST}/currentSecretPath/login/authenticate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'owner@example.invalid', password: 'panel-password' })
        }),
        createEnv(kv.namespace)
    );

    const cookie = response.headers.get('Set-Cookie') ?? '';
    return /jwtToken=[^;]*/.exec(cookie)?.[0] ?? '';
}

async function save(kv: KvStub, changes: Record<string, unknown>): Promise<Response> {
    const worker = await router();
    const cookie = await session(kv);
    const current = { ...validSettingsForm(), securePath: 'currentSecretPath', ...changes };

    return worker.fetch(
        new Request(`https://${HOST}/currentSecretPath/panel/update-settings`, {
            method: 'PUT',
            headers: { Cookie: cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify(current)
        }),
        createEnv(kv.namespace)
    );
}

describe('a KV-sourced deployment saves without any Cloudflare credential', () => {
    it('writes a rotated panel path to KV', async () => {
        const kv = claimedDeployment();

        const response = await save(kv, { securePath: 'rotatedSecretPath' });
        expect(response.status).toBe(200);

        const stored = JSON.parse(kv.store.get(IDENTITY_KV_KEY) ?? '{}');
        expect(stored.securePath).toBe('rotatedSecretPath');
    });

    it('serves the panel on the new path and not the old one', async () => {
        const kv = claimedDeployment();
        // Taken before the rotation, because the login route moves with the path. The
        // session itself survives: it is signed with the deployment's key, not with the
        // path, so an operator who rotates the path is not logged out.
        const cookie = await session(kv);
        await save(kv, { securePath: 'rotatedSecretPath' });

        const worker = await router();

        // A fresh isolate, because the identity is cached for the life of one.
        invalidateIdentityCache();

        const onNew = await worker.fetch(
            new Request(`https://${HOST}/rotatedSecretPath/panel`, { headers: { Cookie: cookie } }),
            createEnv(kv.namespace)
        );
        const onOld = await worker.fetch(
            new Request(`https://${HOST}/currentSecretPath/panel`, { headers: { Cookie: cookie } }),
            createEnv(kv.namespace)
        );

        expect(onNew.status).toBe(200);
        // The old path is not a route any more, so it reaches the fallback.
        expect(onOld.status).not.toBe(200);
    });

    it('writes the rotated protocol credentials too', async () => {
        const kv = claimedDeployment();

        await save(kv, {
            vlUUID: '00000000-0000-4000-8000-0000000000bb',
            trPass: 'rotatedTrojanPassword'
        });

        const stored = JSON.parse(kv.store.get(IDENTITY_KV_KEY) ?? '{}');
        expect(stored.vlUUID).toBe('00000000-0000-4000-8000-0000000000bb');
        expect(stored.trPass).toBe('rotatedTrojanPassword');
    });

    it('performs no Cloudflare API call, because there is nothing to upload', async () => {
        const kv = claimedDeployment();
        const calls: string[] = [];
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            calls.push(String(input instanceof Request ? input.url : input));
            return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
        }));

        try {
            await save(kv, { securePath: 'rotatedSecretPath' });
        } finally {
            vi.unstubAllGlobals();
        }

        expect(calls.filter(url => url.includes('api.cloudflare.com'))).toEqual([]);
    });
});

describe('rotating the panel path with no Telegram bot', () => {
    it('succeeds, rather than answering 500', async () => {
        // `getDataset` writes `{ telegramBotToken: '' }` on first read, so the record
        // exists on every deployment. Re-registering a webhook with an empty token asks
        // Telegram for `/bot/setWebhook`, which 404s.
        const kv = claimedDeployment({ telegramBot: { telegramBotToken: '', telegramUserId: '' } });

        const response = await save(kv, { securePath: 'rotatedSecretPath' });

        expect(response.status).toBe(200);
        expect(JSON.parse(kv.store.get(IDENTITY_KV_KEY) ?? '{}').securePath).toBe('rotatedSecretPath');
    });

    it('does not call Telegram at all', async () => {
        const kv = claimedDeployment({ telegramBot: { telegramBotToken: '', telegramUserId: '' } });
        const calls: string[] = [];
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            calls.push(String(input instanceof Request ? input.url : input));
            return new Response(JSON.stringify({ ok: true }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }));

        try {
            await save(kv, { securePath: 'rotatedSecretPath' });
        } finally {
            vi.unstubAllGlobals();
        }

        expect(calls.filter(url => url.includes('api.telegram.org'))).toEqual([]);
    });

    it('reports a webhook failure as a warning, keeping the save', async () => {
        // With a real token, a failed webhook move must not fail the save: the settings
        // are already written and the path has already moved, so a 500 would tell the
        // operator their save failed while their panel had moved out from under them.
        const kv = claimedDeployment({
            telegramBot: { telegramBotToken: 'a-real-looking-token', telegramUserId: '1' }
        });

        vi.stubGlobal('fetch', vi.fn(async () => new Response(
            JSON.stringify({ ok: false, description: 'Not Found' }),
            { status: 404, headers: { 'Content-Type': 'application/json' } }
        )));

        let payload: { success: boolean; message: string | null };
        try {
            payload = await (await save(kv, { securePath: 'rotatedSecretPath' })).json();
        } finally {
            vi.unstubAllGlobals();
        }

        expect(payload.success).toBe(true);
        expect(payload.message).toContain('Telegram');
        expect(JSON.parse(kv.store.get(IDENTITY_KV_KEY) ?? '{}').securePath).toBe('rotatedSecretPath');
    });
});

describe('an embedded identity needs a redeploy, and says so', () => {
    it('refuses the save when there is no Cloudflare token to redeploy with', async () => {
        (globalThis as Record<string, unknown>).EMBEDED_SETTINGS = {
            ...TEST_EMBEDED_SETTINGS,
            accID: '',
        };
        invalidateIdentityCache();
        await initRequestGlobals();

        const { updateMainSettings } = await import('@main');
        const kv = createKvStub();

        await expect(
            updateMainSettings(createEnv(kv.namespace), {
                ...validSettingsForm(),
                securePath: 'rotatedSecretPath'
            } as never)
        ).rejects.toThrow(/Deploy to Cloudflare|RAYZEN_CF_API_TOKEN/);
    });

    it('leaves KV untouched when it refuses, so nothing is half-applied', async () => {
        (globalThis as Record<string, unknown>).EMBEDED_SETTINGS = {
            ...TEST_EMBEDED_SETTINGS,
            accID: '',
        };
        invalidateIdentityCache();
        await initRequestGlobals();

        const { updateMainSettings } = await import('@main');
        const kv = createKvStub();

        await updateMainSettings(createEnv(kv.namespace), {
            ...validSettingsForm(),
            securePath: 'rotatedSecretPath'
        } as never).catch(() => undefined);

        expect(kv.store.has(IDENTITY_KV_KEY)).toBe(false);
    });

    it('does not disturb an unchanged save', async () => {
        // An identical form is a no-op on either source, so it must not demand a token.
        (globalThis as Record<string, unknown>).EMBEDED_SETTINGS = TEST_EMBEDED_SETTINGS;
        invalidateIdentityCache();
        await initRequestGlobals();

        const { updateMainSettings } = await import('@main');
        const kv = createKvStub();

        await expect(
            updateMainSettings(createEnv(kv.namespace), {
                ...validSettingsForm(),
                vlUUID: TEST_EMBEDED_SETTINGS.vlUUID,
                trPass: TEST_EMBEDED_SETTINGS.trPass,
                securePath: TEST_EMBEDED_SETTINGS.securePath,
                proxyIpMode: 'proxyip',
                proxyIPs: [],
                prefixes: [],
                fallback: '',
                dohUrl: ''
            } as never)
        ).resolves.toEqual({});
    });
});

describe('the hostname is never persisted', () => {
    it('a save on one hostname does not pin it for another', async () => {
        const kv = claimedDeployment();
        await save(kv, { securePath: 'rotatedSecretPath' });

        expect(kv.store.get(IDENTITY_KV_KEY)).not.toContain(HOST);
        expect(kv.store.get(IDENTITY_KV_KEY)).not.toContain(TEST_MAIN_DOMAIN);
    });
});
