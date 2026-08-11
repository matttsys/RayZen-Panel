/**
 * The self-deploy path: what `panel/update-panel` and a settings write actually
 * upload to Cloudflare.
 *
 * Why this file exists
 *
 * `buildScript(true)` used to fetch `${_repo_}/releases/latest/download/worker.js`
 * and upload the response. `_repo_` is the upstream legacy upstream repository, so pressing
 * Update in the RayZen panel replaced the operator's RayZen deployment with a legacy upstream
 * build. Confirmed against a live Worker: one POST to `panel/update-panel` and the
 * panel served `<title>legacy upstream Panel v5.1.1</title>` with no RayZen string anywhere,
 * taking every `panel/platform/*` route with it. Recovery required a `wrangler
 * deploy`, which a panel-only operator does not have.
 *
 * It was also an unsigned, unpinned, unhashed script from a third-party origin,
 * uploaded with the deployment's own API token.
 *
 * These tests assert the two properties that make it safe: the payload is this
 * build's own embedded source, and nothing on the deploy path reaches the network
 * except the Cloudflare upload itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { initRequestGlobals } from '../helpers/worker';
import { TEST_ACCOUNT_ID, TEST_EMAIL, TEST_MAIN_DOMAIN } from '../setup/globals';

vi.mock('cloudflare:sockets', () => ({
    connect: () => {
        throw new Error('no socket in this suite');
    }
}));

/**
 * Extracts the JSON argument of the prelude's `Object.assign(globalThis, {...})`.
 *
 * Scanned brace-by-brace rather than sliced from the first `{`: the prelude is
 * preceded by `padCode()`, which emits hundreds of `let`/`function` declarations
 * containing braces of their own.
 */
function identityJson(script: string): string {
    const marker = 'Object.assign(globalThis, ';
    const start = script.indexOf('{', script.indexOf(marker) + marker.length);
    let depth = 0;
    let inString = false;

    for (let index = start; index < script.length; index++) {
        const character = script[index];
        if (inString) {
            if (character === '\\') index++;
            else if (character === '"') inString = false;
            continue;
        }
        if (character === '"') inString = true;
        else if (character === '{') depth++;
        else if (character === '}' && --depth === 0) return script.slice(start, index + 1);
    }

    throw new Error('no complete identity block in the built script');
}

describe('buildScript assembles the deployable artifact', () => {
    let fetches: string[];

    beforeEach(async () => {
        await initRequestGlobals();
        fetches = [];
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            fetches.push(String(input instanceof Request ? input.url : input));
            throw new Error('no network on the deploy path');
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('uses this build\'s own embedded source, not a remote release', async () => {
        const { buildScript } = await import('@main');
        const script = await buildScript(true);

        expect(script).toContain(gunzipSync(Buffer.from(SOURCE_CONTENT, 'base64')).toString('utf8'));
    });

    it('makes no network request while building the script', async () => {
        // The whole defect was one fetch. Asserting zero is the regression guard:
        // any reintroduced remote source fails here rather than in production.
        const { buildScript } = await import('@main');
        await buildScript(true);

        expect(fetches).toEqual([]);
    });

    /**
     * Every page the router can serve has to be in the redeploy payload.
     *
     * This is the test that was missing. `PROBE_HTML_CONTENT` was added for the
     * measurement frame and left out of `buildScript`'s embedded-contents list, which
     * compiles, passes every other test, and produces a redeployed Worker whose scanner
     * route serves `undefined`. The failure appears only after an operator presses the
     * panel's own repair button, which is the worst possible time to find it.
     *
     * Derived from the globals the build defines rather than from a hardcoded list, so a
     * page added tomorrow is covered without anyone remembering to add it here.
     */
    it('embeds every page asset the build defines', async () => {
        const { buildScript } = await import('@main');
        // `false` is the settings-write path, which embeds the assets. `true` is the
        // repair path, which reuses the running script's own prelude.
        const script = await buildScript(false);

        const assetGlobals = Object.keys(globalThis).filter(
            name => name.endsWith('_HTML_CONTENT') || name === 'ICON_CONTENT' || name === 'SOURCE_CONTENT'
        );

        // Sanity: the suite defines a realistic set, so this cannot pass vacuously.
        expect(assetGlobals.length).toBeGreaterThanOrEqual(7);

        const missing = assetGlobals.filter(name => !script.includes(`"${name}"`));
        expect(
            missing,
            'these assets are defined by the build but not embedded by buildScript, so a '
            + 'redeployed Worker would serve undefined on their routes'
        ).toEqual([]);
    });

    it('never references the upstream legacy upstream repository', async () => {
        const { buildScript } = await import('@main');
        const script = await buildScript(true);

        for (const marker of ['legacy-upstream-owner', 'legacy-upstream-project', 'releases/latest/download']) {
            expect(script, `payload references ${marker}`).not.toContain(marker);
        }
    });

    it('prepends the identity block the runtime requires', async () => {
        const { buildScript } = await import('@main');
        const script = await buildScript(true);

        // `init()` throws without this, which is what produced the "missing identity
        // block" error page when a raw dist/worker.js was uploaded by hand.
        expect(script).toContain('"EMBEDED_SETTINGS"');

        const block = JSON.parse(identityJson(script)) as {
            EMBEDED_SETTINGS: Record<string, unknown>;
        };

        expect(block.EMBEDED_SETTINGS).toMatchObject({
            accID: TEST_ACCOUNT_ID,
            accEmail: TEST_EMAIL,
            mainDomain: TEST_MAIN_DOMAIN
        });
        expect(block.EMBEDED_SETTINGS).not.toHaveProperty('apiToken');
    });

    it('sends assets only on a full deploy, not on an identity-only update', async () => {
        // `upgradePanel` is the "assets already deployed" case: the smaller upload.
        // A settings write is the full one, because it may be the first deploy.
        const { buildScript } = await import('@main');

        const identityOnly = await buildScript(true);
        expect(identityOnly).not.toContain('"PANEL_HTML_CONTENT"');

        // MainSettings deliberately omits the account fields: `buildScript` reads
        // those from `getGlobals()`, so a caller cannot substitute another account.
        const full = await buildScript(false, {
            vlUUID: '00000000-0000-4000-8000-000000000002',
            trPass: 'trojan-password-for-this-test',
            securePath: 'another-secure-path',
            proxyIpMode: 'proxyip',
            proxyIPs: [],
            prefixes: [],
            fallback: '',
            dohUrl: ''
        });

        expect(full).toContain('"PANEL_HTML_CONTENT"');
        expect(full).toContain('"SOURCE_CONTENT"');
    });

    it('carries the supplied settings rather than the running ones', async () => {
        const { buildScript } = await import('@main');
        const script = await buildScript(false, {
            vlUUID: '00000000-0000-4000-8000-000000000003',
            trPass: 'rotated-trojan-password',
            securePath: 'rotated-secure-path',
            proxyIpMode: 'nat64',
            proxyIPs: ['203.0.113.7'],
            prefixes: ['[2001:db8::]'],
            fallback: 'fallback.example',
            dohUrl: 'https://doh.example/dns-query'
        });

        expect(script).toContain('rotated-secure-path');
        expect(script).toContain('nat64');
    });
});

describe('the unresolvable-identity guard', () => {
    it('names the KV binding to create, and no third-party tool', async () => {
        const { init } = await import('@settings');
        const { invalidateIdentityCache } = await import('@identity');
        const saved = (globalThis as Record<string, unknown>).EMBEDED_SETTINGS;

        try {
            delete (globalThis as Record<string, unknown>).EMBEDED_SETTINGS;
            invalidateIdentityCache();

            let message = '';
            try {
                // No embedded identity and no KV namespace: the one configuration
                // RayZen cannot resolve an identity from.
                await init(new Request(`https://${TEST_MAIN_DOMAIN}/`), {} as Env);
            } catch (error) {
                message = (error as Error).message;
            }

            expect(message).toContain('kv');
            expect(message).toContain('Deploy to Cloudflare');
            // Rendered as HTML by renderError, so it must not smuggle markup, and it
            // must not send a RayZen operator to a different project.
            expect(message).not.toContain('<a ');
            expect(message).not.toContain('legacy upstream');
            expect(message).not.toContain('legacy-upstream-owner');
        } finally {
            (globalThis as Record<string, unknown>).EMBEDED_SETTINGS = saved;
            invalidateIdentityCache();
        }
    });
});
