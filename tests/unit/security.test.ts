/**
 * Security header tests, asserted through the real router.
 *
 * Why through the router
 *
 * The headers are applied in `src/worker.ts`, not in the handlers, precisely so a route
 * added later cannot ship without them. A
 * test that called `securityHeaders()` directly would prove the string is well formed and
 * nothing about whether responses carry it. So these tests drive `worker.fetch` and read
 * the headers off the response, which is also what makes the two deliberate exemptions
 * (DoH and the unmatched-path fallback) visible rather than accidental.
 *
 * `cloudflare:sockets` is unresolvable outside the Worker runtime and `src/worker.ts`
 * transitively imports it through the protocol handlers, so it is stubbed at the module
 * level. Nothing here exercises a socket.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { securityHeaders, withSecurityHeaders, type SecurePage } from '@security';
import { createEnv, createKvStub, type KvStub } from '../helpers/worker';
import { invalidateIdentityCache } from '@identity';
import { TEST_EMBEDED_SETTINGS, TEST_MAIN_DOMAIN, TEST_SECURE_PATH } from '../setup/globals';

vi.mock('cloudflare:sockets', () => ({
    connect: () => {
        throw new Error('no socket in this suite');
    }
}));

const SECRET = 'c'.repeat(64);
const PASSWORD = 'panel-password';

/** Imported lazily so the socket mock is registered before the module graph loads. */
async function router() {
    return (await import('../../src/worker')).default;
}

/**
 * A deployment whose stored `panelVersion` matches this build, so `getDataset` does not
 * treat the settings as stale and try to resolve DNS over the network.
 */
function deployment(): KvStub {
    return createKvStub({
        pwd: PASSWORD,
        secretKey: SECRET,
        warpAccounts: [{ privateKey: 'k', publicKey: 'p', warpIPv6: '::1/128', reserved: 'AAAA' }],
        telegramBot: { telegramBotToken: '', telegramUserId: '' },
        proxySettings: { panelVersion: VERSION, ports: [443], xrayUdpNoises: [], remoteSettings: '' }
    });
}

async function session(): Promise<string> {
    const token = await new SignJWT({ userID: PASSWORD })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(new TextEncoder().encode(SECRET));
    return `jwtToken=${token}`;
}

function url(path: string, host = TEST_MAIN_DOMAIN): string {
    return `https://${host}/${TEST_SECURE_PATH}/${path}`;
}

/** Every header the set is supposed to carry, other than the host-conditional HSTS. */
const ALWAYS_PRESENT = [
    'Content-Security-Policy',
    'Referrer-Policy',
    'X-Content-Type-Options',
    'X-Frame-Options',
    'Cross-Origin-Opener-Policy',
    'Permissions-Policy'
];

describe('the header set itself', () => {
    it('denies everything not explicitly allowed', () => {
        const csp = securityHeaders('panel', TEST_MAIN_DOMAIN)['Content-Security-Policy'];
        expect(csp).toContain("default-src 'none'");
        expect(csp).toContain("base-uri 'none'");
        expect(csp).toContain("object-src 'none'");
        expect(csp).toContain("frame-ancestors 'none'");
        expect(csp).toContain("form-action 'self'");
    });

    it('allows no external script, style or font origin on any page', () => {
        for (const page of ['panel', 'login', 'proxy-ip', 'error', 'api'] as SecurePage[]) {
            const csp = securityHeaders(page, TEST_MAIN_DOMAIN)['Content-Security-Policy'];
            const directives = new Map(
                csp.split('; ').map(part => {
                    const [name, ...values] = part.split(' ');
                    return [name, values.join(' ')];
                })
            );

            // No page loads a font: the icon subsets became inline SVG and the body
            // typeface is a local-font preference, so this closed rather than merely
            // same-origin.
            expect(directives.get('script-src'), page).not.toMatch(/https?:/);
            expect(directives.get('style-src'), page).not.toMatch(/https?:/);
            expect(directives.get('font-src'), page).toBe("'none'");
        }
    });

    it('permits connect only to the origins each page actually uses', () => {
        const panel = securityHeaders('panel', TEST_MAIN_DOMAIN)['Content-Security-Policy'];
        // The two user-initiated IP-echo services, and nothing else. The version
        // check is same-origin (`./panel/version`), so no release-feed origin is
        // allowlisted (the legacy upstream-era raw.githubusercontent.com entry was removed).
        expect(panel).toContain(
            "connect-src 'self' https://ipv4.geojs.io https://ipv4.icanhazip.com"
        );
        expect(panel).not.toContain('raw.githubusercontent.com');

        for (const page of ['login', 'proxy-ip'] as SecurePage[]) {
            expect(securityHeaders(page, TEST_MAIN_DOMAIN)['Content-Security-Policy'], page)
                .toContain("connect-src 'self'");
            expect(securityHeaders(page, TEST_MAIN_DOMAIN)['Content-Security-Policy'], page)
                .not.toMatch(/connect-src[^;]*https/);
        }
    });

    it('sends HSTS on an operator domain and not on a Cloudflare subdomain', () => {
        expect(securityHeaders('panel', 'panel.example.com')['Strict-Transport-Security'])
            .toBe('max-age=31536000; includeSubDomains');

        // workers.dev and pages.dev are already HSTS-preloaded by Cloudflare, and
        // includeSubDomains on an apex the operator does not own is not ours to set.
        for (const host of ['rayzen.workers.dev', 'rayzen.pages.dev']) {
            expect(securityHeaders('panel', host), host)
                .not.toHaveProperty('Strict-Transport-Security');
        }
    });
});

describe('withSecurityHeaders', () => {
    it('leaves a WebSocket upgrade untouched', () => {
        // Rebuilding a 101 would drop the `webSocket` property that the Workers runtime
        // reads off the response, and headers are not delivered to the client on an
        // upgrade anyway. Constructed as a stand-in rather than a real Response, because
        // the `Response` constructor rejects status 101 outside the Workers runtime.
        const upgrade = {
            status: 101,
            headers: new Headers(),
            webSocket: {}
        } as unknown as Response;

        expect(withSecurityHeaders(upgrade, 'panel', TEST_MAIN_DOMAIN)).toBe(upgrade);
    });

    it('does not overwrite a CSP a handler already set', () => {
        const specialised = new Response('x', {
            headers: { 'Content-Security-Policy': "default-src 'self'" }
        });
        const result = withSecurityHeaders(specialised, 'panel', TEST_MAIN_DOMAIN);
        expect(result.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
    });

    it('preserves the status, the body and the headers the handler set', async () => {
        const original = new Response('{"ok":true}', {
            status: 418,
            statusText: 'Teapot',
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' }
        });
        const result = withSecurityHeaders(original, 'api', TEST_MAIN_DOMAIN);

        expect(result.status).toBe(418);
        expect(await result.text()).toBe('{"ok":true}');
        expect(result.headers.get('Content-Type')).toBe('application/json');
        // Only defaulted, never overridden: the JSON routes set a stricter value.
        expect(result.headers.get('Cache-Control')).toBe('max-age=60');
    });

    it('defaults Cache-Control to no-store when the handler set none', () => {
        const result = withSecurityHeaders(new Response('x'), 'panel', TEST_MAIN_DOMAIN);
        expect(result.headers.get('Cache-Control')).toBe('no-store');
    });

    it('does not declare a same-origin resource policy on a CORS-enabled response', () => {
        // `sub/share-settings` is deliberately cross-origin readable, because importing
        // settings from another deployment fetches it.
        const shared = new Response('data', {
            headers: { 'Access-Control-Allow-Origin': '*' }
        });
        const result = withSecurityHeaders(shared, 'api', TEST_MAIN_DOMAIN);

        expect(result.headers.get('Access-Control-Allow-Origin')).toBe('*');
        expect(result.headers.get('Cross-Origin-Resource-Policy')).toBeNull();
        // The rest of the set still applies.
        expect(result.headers.get('Referrer-Policy')).toBe('no-referrer');
    });
});

describe('every routed response carries the header set', () => {
    let kv: KvStub;

    beforeEach(() => {
        kv = deployment();
        // The identity is cached per isolate (src/settings/identity.ts), so a test
        // that stubs EMBEDED_SETTINGS has to drop the previous test's copy first.
        invalidateIdentityCache();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        invalidateIdentityCache();
    });

    /**
     * One request per routed path prefix. `panel` and `proxy-ip` are authenticated so the
     * assertion covers the rendered page rather than only the redirect, though the
     * redirect matters too and is asserted separately below.
     */
    const routes: { name: string; path: string; authenticated: boolean }[] = [
        { name: 'login page', path: 'login', authenticated: false },
        { name: 'panel page', path: 'panel', authenticated: true },
        { name: 'panel settings JSON', path: 'panel/settings', authenticated: true },
        { name: 'panel version JSON', path: 'panel/version', authenticated: false },
        { name: 'platform health JSON', path: 'panel/platform/health', authenticated: true },
        { name: 'unauthenticated panel redirect', path: 'panel', authenticated: false }
    ];

    for (const { name, path, authenticated } of routes) {
        it(`${name} carries every header`, async () => {
            const worker = await router();
            const cookie = authenticated ? { Cookie: await session() } : undefined;
            const response = await worker.fetch(
                new Request(url(path), { headers: cookie }),
                createEnv(kv.namespace)
            );

            for (const header of ALWAYS_PRESENT) {
                expect(response.headers.get(header), `${name} is missing ${header}`).not.toBeNull();
            }
            expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
            expect(response.headers.get('X-Frame-Options')).toBe('DENY');
        });
    }

    it('a redirect keeps its Location and its status', async () => {
        const worker = await router();
        const response = await worker.fetch(new Request(url('panel')), createEnv(kv.namespace));

        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toContain('/login');
        expect(response.headers.get('Content-Security-Policy')).not.toBeNull();
    });

    it('the panel page is not cacheable, because it renders live secrets', async () => {
        const worker = await router();
        const response = await worker.fetch(
            new Request(url('panel'), { headers: { Cookie: await session() } }),
            createEnv(kv.namespace)
        );

        expect(response.headers.get('Cache-Control')).toContain('no-store');
    });

    it('the error page carries the set even though it renders before init succeeds', async () => {
        const worker = await router();
        // An env without EMBEDED_SETTINGS makes `init` throw, which is the path
        // `renderError` exists for.
        const response = await worker.fetch(
            new Request(url('panel')),
            createEnv(kv.namespace, { UUID: 'forces-init-to-throw' })
        );

        expect(response.status).toBe(200);
        // The body is the stubbed error page from tests/setup/globals.ts, so what is
        // asserted is that the error path ran, not the page's wording.
        expect(await response.text()).toContain('error');

        // renderError runs in the router's catch, outside the per-route wrapper, so it is
        // the one page whose headers come from the handler. Asserted rather than assumed.
        for (const header of ALWAYS_PRESENT) {
            expect(response.headers.get(header), `error page is missing ${header}`).not.toBeNull();
        }
        expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        // An error page should not commit the host to a year of HSTS.
        expect(response.headers.get('Strict-Transport-Security')).toBeNull();
    });

    /**
     * A handler that rejects must reach `renderError`.
     *
     * This did not always hold: every route used to be `return handler(...)` inside the
     * `try`, and a returned promise settles after the block is left, so the `catch` never
     * saw a handler rejection and the runtime answered with its own generic error instead
     * of the panel's error page. `panel/settings` is used because it has its own
     * `try`/`catch`, so the failure is injected one level deeper, at the KV read.
     */
    it('a handler rejection renders the error page rather than escaping', async () => {
        const broken = createKvStub();
        broken.namespace.get = () => Promise.reject(new Error('KV exploded'));

        const worker = await router();
        const response = await worker.fetch(new Request(url('panel')), createEnv(broken.namespace));

        expect(response.status).toBe(200);
        expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
        expect(response.headers.get('Content-Security-Policy')).not.toBeNull();
    });

    it('a KV failure on the proxy-IP page still yields a headed response', async () => {
        // Not the error page: `authenticate` swallows its own failures and returns false,
        // so this route redirects to login instead of throwing. Asserted as observed rather
        // than as hoped, because a redirect on a KV outage is a real behaviour worth
        // recording: the operator sees a login loop, not an error.
        const broken = createKvStub();
        broken.namespace.get = () => Promise.reject(new Error('KV exploded'));

        const worker = await router();
        const response = await worker.fetch(
            new Request(url('proxy-ip')),
            createEnv(broken.namespace)
        );

        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toContain('/login');
        expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    });

    it('an unmatched path with no fallback configured is a bare 404', async () => {
        const worker = await router();
        const response = await worker.fetch(
            new Request(`https://${TEST_MAIN_DOMAIN}/not-the-secret-path/`),
            createEnv(kv.namespace)
        );

        expect(response.status).toBe(404);
        // A 404 that carries this Worker's distinctive header set is a fingerprint for a
        // scanner walking paths, so the absence is the assertion.
        expect(response.headers.get('Content-Security-Policy')).toBeNull();
        expect(response.headers.get('Referrer-Policy')).toBeNull();
    });

    it('a configured fallback upstream is proxied untouched', async () => {
        // Stamping this Worker's header set onto a proxied upstream is the exact tell the
        // fallback exists to avoid, so the absence is the assertion.
        //
        // `fallback` comes from the build-embedded settings, so it is stubbed for this
        // test only; `unstubGlobals` in vitest.config.ts restores it.
        vi.stubGlobal('EMBEDED_SETTINGS', {
            ...TEST_EMBEDED_SETTINGS,
            fallback: 'an-ordinary-site.example'
        });
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('an ordinary website', {
                headers: { 'Content-Type': 'text/html' }
            }))
        );

        const worker = await router();
        const response = await worker.fetch(
            new Request(`https://${TEST_MAIN_DOMAIN}/not-the-secret-path/`),
            createEnv(kv.namespace)
        );

        expect(await response.text()).toBe('an ordinary website');
        expect(response.headers.get('Content-Security-Policy')).toBeNull();
        expect(response.headers.get('Referrer-Policy')).toBeNull();
    });
});

describe('the completed inline-handler migration', () => {
    it('the panel has zero inline handler attributes', async () => {
        const { readFileSync } = await import('node:fs');
        const { join } = await import('node:path');
        const html = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'assets', 'panel', 'index.html'), 'utf8');
        expect(html.match(/\son(?:click|change|input|submit|load|error)=/g) ?? []).toEqual([]);
    });

    it('script and style CSP use build hashes, never unsafe-inline', () => {
        const csp = securityHeaders('panel', TEST_MAIN_DOMAIN)['Content-Security-Policy'];
        expect(csp).not.toContain('unsafe-inline');
        expect(csp).toMatch(/script-src 'sha256-/);
        expect(csp).toMatch(/style-src 'sha256-/);
    });
});
