/**
 * Subscription routing: which client values each kind serves, and what happens to
 * the ones it does not.
 *
 * Why this file exists
 *
 * `handleSubscriptions` is a switch on the path segment containing a nested switch
 * on the `?app=` client. The inner switches ended in `default: break`, so an
 * unrecognised client fell through to the *next* subscription kind. Two consequences,
 * both found on a live deployment and neither visible to any existing test:
 *
 *   1. `sub/raw?app=clash` was served by the `warp` case, so a user asking for raw
 *      URIs received a WARP Clash configuration.
 *   2. Any unmatched client on any kind walked the whole switch and reached
 *      `share-settings`, exporting the deployment's settings document to an
 *      unauthenticated caller. It only ever surfaced as a 500 because `btoa` threw
 *      on the default `remarkSuffix` glyph; with an ASCII suffix it would have
 *      returned the document.
 *
 * Driven through `worker.fetch` rather than by calling the handler, because the
 * fallthrough is a property of the routing, and a direct call would let the test
 * assert the shape it already assumed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRuntimeDeps, seededRandom, setRuntimeDeps } from '@runtime';
import { getKvSettings } from '@settings';
import { createEnv, createKvStub, type KvStub } from '../helpers/worker';
import { TEST_MAIN_DOMAIN, TEST_SECURE_PATH, TEST_UUID } from '../setup/globals';

vi.mock('cloudflare:sockets', () => ({
    connect: () => {
        throw new Error('no socket in this suite');
    }
}));

async function router() {
    return (await import('../../src/worker')).default;
}

/**
 * The `normal` and `fragment` kinds resolve the DNS host of the configured
 * resolver while building a config, so without a stub those cases reach the
 * network and time out. Fixed addresses, because nothing here asserts on them.
 */
const stubResolver = async (_domain: string, onlyIPv4 = false) => ({
    ipv4: ['203.0.113.10', '203.0.113.11'],
    ipv6: onlyIPv4 ? [] : ['2001:db8::10']
});

function deployment(): KvStub {
    return createKvStub({
        pwd: 'panel-password',
        secretKey: 'c'.repeat(64),
        warpAccounts: [{ privateKey: 'k', publicKey: 'p', warpIPv6: '::1/128', reserved: 'AAAA' }],
        telegramBot: { telegramBotToken: '', telegramUserId: '' },
        // The stored document is the full default set, not a handful of keys: a
        // deployment whose `panelVersion` matches the build is read back as-is,
        // so a sparse stub would silently drop `remarkSuffix` and make the
        // non-Latin1 encoding assertion below vacuous.
        //
        // `fallback` is empty, so an unroutable request is a 404 rather than a
        // proxied upstream fetch. That is what makes "did not route" observable.
        proxySettings: { ...getKvSettings(), panelVersion: VERSION, remoteSettings: '' }
    });
}

async function get(path: string, kv: KvStub): Promise<Response> {
    const worker = await router();
    return worker.fetch(
        new Request(`https://${TEST_MAIN_DOMAIN}/${TEST_SECURE_PATH}/${path}`),
        createEnv(kv.namespace)
    );
}

/** The client values each kind actually implements, from src/handlers/subscription.ts. */
const SUPPORTED: Record<string, string[]> = {
    normal: ['xray', 'sing-box', 'clash'],
    raw: ['xray', 'sing-box'],
    fragment: ['xray', 'sing-box'],
    warp: ['xray', 'sing-box', 'clash', 'wireguard'],
    'warp-pro': ['xray', 'xray-knocker', 'clash', 'amnezia']
};

describe('subscription client routing', () => {
    let kv: KvStub;

    beforeEach(() => {
        setRuntimeDeps({ random: seededRandom(1), resolveDNS: stubResolver });
        kv = deployment();
    });

    afterEach(() => {
        resetRuntimeDeps();
    });

    for (const [kind, clients] of Object.entries(SUPPORTED)) {
        for (const client of clients) {
            it(`serves ${kind} for ${client}`, async () => {
                const response = await get(`sub/${kind}/${TEST_UUID}?app=${client}`, kv);
                expect(response.status).toBe(200);
                expect((await response.text()).length).toBeGreaterThan(0);
            });
        }

        it(`does not serve ${kind} to an unsupported client`, async () => {
            const response = await get(`sub/${kind}/${TEST_UUID}?app=not-a-client`, kv);
            expect(response.status).toBe(404);
        });

        it(`does not serve ${kind} with no client at all`, async () => {
            const response = await get(`sub/${kind}/${TEST_UUID}`, kv);
            expect(response.status).toBe(404);
        });
    }

    it('never reaches share-settings by falling through a client switch', async () => {
        // The settings document is recognisable by its keys. Any 200 whose body
        // decodes to an object carrying them means the fallthrough is back.
        for (const kind of Object.keys(SUPPORTED)) {
            const response = await get(`sub/${kind}/${TEST_UUID}?app=not-a-client`, kv);
            if (response.status !== 200) continue;

            const body = await response.text();
            let decoded = '';
            try {
                decoded = Buffer.from(body, 'base64').toString('utf8');
            } catch {
                /* not base64, so not the settings export */
            }
            expect(decoded, `${kind} leaked the settings document`).not.toContain('proxyIpMode');
        }
    });

    it('serves raw URIs for raw, not a WARP configuration', async () => {
        // The specific mis-routing that existed: `raw` has no clash branch, and the
        // next case with one is `warp`.
        const response = await get(`sub/raw/${TEST_UUID}?app=clash`, kv);
        expect(response.status).toBe(404);
    });
});

describe('share-settings export', () => {
    beforeEach(() => {
        setRuntimeDeps({ random: seededRandom(1), resolveDNS: stubResolver });
    });

    afterEach(() => {
        resetRuntimeDeps();
    });

    it('encodes a payload containing non-Latin1 characters', async () => {
        // `remarkSuffix` defaults to a glyph outside Latin1, so a `btoa` of the
        // JSON throws. This route is how the panel's "share settings" button and
        // remote-import both work, so the failure took both out on a default
        // deployment.
        const kv = deployment();
        const response = await get('sub/share-settings', kv);

        expect(response.status).toBe(200);
        const decoded = Buffer.from(await response.text(), 'base64').toString('utf8');
        const settings = JSON.parse(decoded) as Record<string, unknown>;

        expect(settings).toHaveProperty('remarkSuffix');
        expect(settings).toHaveProperty('proxyIpMode');
        // Still redacted: see getSharedSettings in src/settings/settings.ts.
        for (const secret of ['vlUUID', 'trPass', 'apiToken', 'securePath', 'accEmail']) {
            expect(settings).not.toHaveProperty(secret);
        }
    });

    it('round-trips through the decoder the panel importer uses', async () => {
        // The panel reads this with `atob` + `JSON.parse` (importFileSettings /
        // fetchSettings in src/assets/panel/script.js), so the encoder has to be
        // byte-compatible with that, not merely valid base64.
        const kv = deployment();
        const body = await (await get('sub/share-settings', kv)).text();

        const bytes = Uint8Array.from(atob(body), character => character.charCodeAt(0));
        const settings = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;

        expect(typeof settings.remarkSuffix).toBe('string');
    });
});
