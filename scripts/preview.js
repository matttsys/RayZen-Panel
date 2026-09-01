/**
 * Local UI preview server.
 *
 * Serves the **real** `dist/worker.js` on `http://127.0.0.1:8787` so the application, login and
 * proxy-IP pages can be inspected in a browser without deploying to Cloudflare. There is
 * miniflare is not a dependency of this repository, and adding one for a preview script
 * is not a trade worth making, so this uses Node's own `http` module and an in-memory KV
 * stub.
 *
 * Usage:
 *   npm run build && npm run preview
 *   open http://127.0.0.1:8787/  (redirects to the application with a generated secret path)
 *
 *   npm run build && npm run preview:setup
 *   open http://127.0.0.1:8787/  (the first-run setup page of a brand-new deployment)
 *
 * What is real and what is not
 *
 * Real: every byte of `dist/worker.js`. The router, the auth path, the page HTML, the
 * embedded CSS and JavaScript, the icon font, the security headers, the settings
 * validators, the subscription and config generators, and the KV read/write shapes.
 *
 * Stubbed, and visible in the response when you hit it:
 *
 *  - `cloudflare:sockets` (see `scripts/preview-loader.mjs`). Worker-side socket probes raise an error rather than pretending to connect.
 *    The browser-owned device scanner still runs in a real browser.
 *  - The Cloudflare API. `panel/usage` and the WARP account fetch call
 *    `api.cloudflare.com` with the deployment's own token; there is no token here, so those
 *    calls fail exactly as they would on a misconfigured deploy. That is the honest
 *    behaviour, and it is what the dashboard's error state looks like.
 *  - KV is a `Map` in this process. Restarting the server resets the settings.
 *
 * Security
 *
 * Binds to 127.0.0.1 only, and the password is printed to the terminal rather than left
 * blank, because the panel's own bootstrap treats "no password set" as an invitation to
 * set one without authenticating. Do not expose this port.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const green = '\x1b[32m';
const yellow = '\x1b[33m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';

const HOST = process.env.PREVIEW_HOST ?? '127.0.0.1';
const PORT = Number(process.env.PREVIEW_PORT ?? 8787);

/** Values the artifact expects `Object.assign(globalThis, ...)` to have supplied. */
const SECURE_PATH = process.env.PREVIEW_SECURE_PATH ?? randomBytes(12).toString('base64url');
const PASSWORD = process.env.PREVIEW_PASSWORD ?? 'preview';
const UUID = '00000000-0000-4000-8000-000000000001';

/**
 * `PREVIEW_SETUP=1` previews a brand-new deployment instead of a configured one.
 *
 * No identity block is assigned and no password is seeded, so the Worker resolves its
 * own identity into the in-memory KV and serves the first-run setup page at `/`, exactly
 * as it does on a Deploy to Cloudflare deployment. That page is rendered once per
 * deployment in real life, which makes it the hardest thing in the project to look at;
 * this is how you look at it.
 */
const SETUP_MODE = process.env.PREVIEW_SETUP === '1';

/**
 * An in-memory KVNamespace.
 *
 * Only the four methods the Worker uses are implemented, with the same `type: 'json'`
 * behaviour, because `src/storage/storage.ts` relies on it.
 */
function createKv() {
    const store = new Map();
    return {
        async get(key, options) {
            const raw = store.get(key);
            if (raw === undefined) return null;
            const type = typeof options === 'string' ? options : options?.type;
            return type === 'json' ? JSON.parse(raw) : raw;
        },
        async put(key, value) {
            store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
        },
        async delete(key) {
            store.delete(key);
        },
        async list() {
            return { keys: [...store.keys()].map(name => ({ name })), list_complete: true, cacheStatus: null };
        }
    };
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/**
 * Settings the panel needs before it will render.
 *
 * `panelVersion` matches this build deliberately: a mismatch sends `getDataset` into
 * `updateDataset`, which resolves DNS over the network and makes a first page load hang.
 * Everything else is the shipped default set, so what the preview shows is what a fresh
 * deployment shows.
 */
function seedSettings() {
    return {
        localDNS: '8.8.8.8',
        antiSanctionDNS: '178.22.122.100',
        fakeDNS: false,
        enableIPv6: true,
        allowLANConnection: false,
        logLevel: 'warning',
        clientCompat: 'universal',
        customDomain: '',
        protocols: [globalThis._VL_, globalThis._TR_].join(','),
        remoteDNS: 'https://8.8.8.8/dns-query',
        remoteDnsHost: { isDomain: false, host: '8.8.8.8', ipv4: [], ipv6: [] },
        upstreamProxy: '',
        upstreamParams: {},
        chainProxy: '',
        chainProxyParams: {},
        cleanIPs: [],
        ports: [443],
        fingerprint: 'chrome',
        bestPingInterval: 30,
        enableTFO: true,
        enableECH: false,
        echServerName: '',
        customCdnAddrs: [],
        customCdnHost: '',
        customCdnSni: '',
        fragmentMode: 'custom',
        fragmentPackets: 'tlshello',
        fragmentLengthMin: 100,
        fragmentLengthMax: 200,
        fragmentDelayMin: 1,
        fragmentDelayMax: 1,
        fragmentMaxSplitMin: 0,
        fragmentMaxSplitMax: 0,
        customSubs: [],
        customConfigs: [],
        warpRemoteDNS: '1.1.1.1',
        warpEndpoints: ['engage.cloudflareclient.com:2408'],
        warpBestPingInterval: 30,
        warpReservedBytes: true,
        xrayUdpNoises: [{ type: 'rand', packet: '50-100', delay: '1-5', count: 5 }],
        knockerNoiseMode: 'quic',
        knockerNoiseCountMin: 10,
        knockerNoiseCountMax: 15,
        knockerNoiseSizeMin: 5,
        knockerNoiseSizeMax: 10,
        knockerNoiseDelayMin: 1,
        knockerNoiseDelayMax: 1,
        amneziaNoiseCount: 5,
        amneziaNoiseSizeMin: 50,
        amneziaNoiseSizeMax: 100,
        bypassIran: false,
        bypassChina: false,
        bypassRussia: false,
        bypassOpenAi: false,
        bypassGoogleAi: false,
        bypassMicrosoft: false,
        bypassOracle: false,
        bypassDocker: false,
        bypassAdobe: false,
        bypassEpicGames: false,
        bypassIntel: false,
        bypassAmd: false,
        bypassNvidia: false,
        bypassAsus: false,
        bypassHp: false,
        bypassLenovo: false,
        blockAds: false,
        blockPorn: false,
        blockUDP443: false,
        blockMalware: false,
        blockPhishing: false,
        blockCryptominers: false,
        customBypassRules: [],
        customBlockRules: [],
        customBypassSanctionRules: [],
        remoteSettings: '',
        panelVersion: pkg.version
    };
}

// The artifact's own prelude assigns the embedded page blobs, so importing it must come
// first. `EMBEDED_SETTINGS` is assigned before the import because `src/settings/settings.ts`
// reads it inside `init()`, not at module scope, but the ordering is cheap to guarantee.
if (!SETUP_MODE) {
    globalThis.EMBEDED_SETTINGS = {
        accID: 'preview-account',
        accEmail: 'preview@example.invalid',
        vlUUID: UUID,
        trPass: 'preview-trojan-password',
        securePath: SECURE_PATH,
        proxyIpMode: 'proxyip',
        proxyIPs: [],
        prefixes: [],
        mainDomain: `${HOST}:${PORT}`,
        fallback: '',
        dohUrl: ''
    };
}

const worker = (await import(join(root, 'dist', 'worker.js'))).default;

const kv = createKv();

// Setup mode seeds nothing: an unclaimed deployment has no password, no settings and no
// identity, and seeding any of them is what would hide the page being previewed.
if (!SETUP_MODE) {
    await kv.put('pwd', PASSWORD);
    await kv.put('secretKey', randomBytes(32).toString('hex'));
    await kv.put('proxySettings', JSON.stringify(seedSettings()));
    await kv.put('telegramBot', JSON.stringify({ telegramBotToken: '', telegramUserId: '' }));
    await kv.put('warpAccounts', JSON.stringify([
        {
            privateKey: 'cHJldmlldy1wcml2YXRlLWtleS1wbGFjZWhvbGRlcg==',
            publicKey: 'cHJldmlldy1wdWJsaWMta2V5LXBsYWNlaG9sZGVy',
            warpIPv6: '2606:4700:110:0:0:0:0:1/128',
            reserved: 'AAAA'
        }
    ]));
}

/**
 * The Worker's `env`.
 *
 * Every `RAYZEN_*` variable in this process's environment is forwarded, because that is
 * exactly what Cloudflare does with a Worker's configured variables and secrets: they
 * arrive as properties of `env`. Forwarding them keeps local preview behavior aligned
 * with a deployed Worker for optional identity and platform configuration.
 */
const env = { CF_PAGES: '0', kv };
for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith('RAYZEN_') && value) env[name] = value;
}

/**
 * `Request` requires an absolute URL, and Node gives the server a path. The scheme is
 * declared as `https` because `init()` derives `origin` from it and the panel builds
 * subscription URLs from that origin; over plain http the displayed URLs would carry the
 * wrong scheme, which is a preview artefact rather than a real difference.
 *
 * `PREVIEW_SCHEME=http` overrides that, for the one case where the default gets in the
 * way: a browser driving the first-run setup page follows the panel URL that page
 * reveals, and an `https` URL against this plain-http server fails to connect. Use it
 * when you are clicking through, and leave it alone when you are reading URLs.
 */
const SCHEME = process.env.PREVIEW_SCHEME === 'http' ? 'http' : 'https';

function toRequest(req, body) {
    const url = `${SCHEME}://${HOST}:${PORT}${req.url}`;
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) value.forEach(v => headers.append(name, v));
        else if (value !== undefined) headers.set(name, value);
    }

    const method = req.method ?? 'GET';
    const hasBody = method !== 'GET' && method !== 'HEAD' && body.length > 0;
    return new Request(url, { method, headers, body: hasBody ? body : undefined });
}

const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
        // A bare `/` is not a route the Worker knows: everything lives under the secret
        // path. Redirecting is friendlier than the 404 the fallback would produce. In
        // setup mode `/` is a real route, so it is left alone.
        if (!SETUP_MODE && (req.url === '/' || req.url === '')) {
            res.writeHead(302, { Location: '/__preview/sign-in' });
            res.end();
            return;
        }

        /**
         * Preview-only convenience: sign in and land on the panel.
         *
         * This does not bypass authentication. It posts the printed credentials to the
         * Worker's own `login/authenticate` route and forwards whatever `Set-Cookie` that
         * route returns, so a wrong password here fails exactly as it would in a browser.
         * It exists because the session cookie is `HttpOnly`, which no amount of
         * command-line flags will let a headless browser set by hand.
         *
         * `?next=` chooses where to land, restricted to a path under the secret prefix so
         * this cannot be turned into an open redirect even in a preview.
         */
        if (req.url?.startsWith('/__preview/sign-in')) {
            const requested = new URL(req.url, `http://${HOST}:${PORT}`).searchParams.get('next');
            const next = requested?.startsWith(`/${SECURE_PATH}/`)
                ? requested
                : `/${SECURE_PATH}/panel`;

            const login = await worker.fetch(
                new Request(`https://${HOST}:${PORT}/${SECURE_PATH}/login/authenticate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: globalThis.EMBEDED_SETTINGS.accEmail,
                        password: PASSWORD
                    })
                }),
                env
            );

            const cookie = login.headers.get('set-cookie');
            if (!cookie) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`Preview sign-in failed: ${await login.text()}`);
                return;
            }

            // `Secure` is kept, because Chrome and Firefox both accept Secure cookies from
            // http://127.0.0.1. Stripping it would diverge from the real cookie.
            res.writeHead(302, { 'Set-Cookie': cookie, Location: next });
            res.end();
            return;
        }

        /**
         * Preview-only: seed the appearance keys, then continue to `?next=`.
         *
         * Theme, light/dark and language are stored in `localStorage` (`rz-theme`,
         * `rz-mode`, `rz-lang`) and read by the panel on load, so there is no URL or
         * cookie that selects them and a headless screenshot always captures the
         * defaults. Chrome cannot be given a localStorage value on the command line
         * either, and the panel's CSP forbids injecting an inline script into its own
         * response, so the value has to be written by a page on the same origin. This is
         * that page. It serves no purpose in a deployment and exists only here.
         */
        if (req.url?.startsWith('/__preview/appearance')) {
            const query = new URL(req.url, `http://${HOST}:${PORT}`).searchParams;
            const requested = query.get('next');
            const next = requested?.startsWith('/') && !requested.startsWith('//')
                ? requested
                : `/${SECURE_PATH}/panel`;

            // Allowlisted keys and values: this writes to the same storage the panel
            // trusts, so it does not take arbitrary input even in a preview.
            // `rayzen-onboarding-v1` is included because the welcome modal covers
            // the dashboard on a first visit, so every screenshot of a fresh profile
            // photographs the modal rather than the layout being reviewed.
            const allowed = {
                'rz-theme': ['ocean', 'aurora', 'forest', 'tropical', 'lavender', 'sunset', 'midnight'],
                'rz-mode': ['dark', 'light'],
                'rz-lang': ['fa'],
                'rayzen-onboarding-v1': ['complete']
            };

            const writes = Object.entries(allowed)
                .map(([key, values]) => [key, query.get(key)])
                .filter(([key, value]) => value !== null && allowed[key].includes(value))
                .map(([key, value]) => `localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(value)});`)
                .join('');

            const clears = Object.keys(allowed)
                .filter(key => query.get(key) === '')
                .map(key => `localStorage.removeItem(${JSON.stringify(key)});`)
                .join('');

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(
                '<!DOCTYPE html><meta charset="utf-8"><title>preview appearance</title>' +
                `<script>${clears}${writes}location.replace(${JSON.stringify(next)});</script>`
            );
            return;
        }

        try {
            const response = await worker.fetch(toRequest(req, Buffer.concat(chunks)), env);
            const headers = {};
            response.headers.forEach((value, name) => {
                headers[name] = value;
            });

            let buffer = Buffer.from(await response.arrayBuffer());

            /**
             * `?__preview_expand` opens every `<details>` in the response.
             *
             * The panel keeps eleven of its twelve screens inside collapsed accordions, so
             * a screenshot of the default state shows headers and nothing else. This is the
             * only place the preview alters a response body, it is opt-in per request, and
             * it adds one attribute that a click would set anyway.
             */
            if (req.url?.includes('__preview_expand') && headers['content-type']?.includes('text/html')) {
                buffer = Buffer.from(
                    buffer.toString('utf8').replaceAll('<details', '<details open')
                );
                headers['content-length'] = String(buffer.length);
            }

            res.writeHead(response.status, headers);
            res.end(buffer);

            const marker = response.status >= 400 ? yellow : dim;
            console.log(`${marker}${req.method} ${req.url} -> ${response.status}${reset}`);
        } catch (error) {
            // A throw here is a preview-environment limit, not necessarily a panel bug, so
            // it is reported in full rather than swallowed into a 500 page.
            console.error(`${yellow}${req.method} ${req.url} threw${reset}`);
            console.error(error);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end(`Preview error: ${error?.message ?? error}\n\n${error?.stack ?? ''}`);
        }
    });
});

server.listen(PORT, HOST, () => {
    console.log(`${green}RayZen preview${reset}  v${pkg.version}`);

    if (SETUP_MODE) {
        console.log(`  ${green}first-run setup${reset}  http://${HOST}:${PORT}/`);
        console.log(
            `${dim}  A brand-new deployment: no identity, no password, empty KV. Complete the\n` +
            `  form and it hands you the panel URL it generated, exactly as it would on\n` +
            `  Cloudflare. Restart to start over.${reset}`
        );
        return;
    }

    console.log(`  panel     http://${HOST}:${PORT}/${SECURE_PATH}/panel`);
    console.log(`  login     http://${HOST}:${PORT}/${SECURE_PATH}/login`);
    console.log(`  proxy-ip  http://${HOST}:${PORT}/${SECURE_PATH}/proxy-ip`);
    console.log(`  password  ${PASSWORD}  ${dim}(username ${globalThis.EMBEDED_SETTINGS.accEmail})${reset}`);
    console.log(`  ${green}sign in and open the panel:${reset} http://${HOST}:${PORT}/`);
    console.log(
        `${dim}  KV is in-memory. The Cloudflare API and cloudflare:sockets are unavailable,\n` +
        `  so account usage, WARP renewal and Worker-side socket probes are unavailable.
  The browser-owned device scanner remains testable.${reset}`
    );
});
