/**
 * End-to-end test of the one-click deployment flow, against the real build artifact.
 *
 * This is the counterpart to scripts/flow-test.js. That one drives
 * `dist/worker.deploy.js`, the artifact with a fixed identity baked in. This one drives
 * `dist/worker.js` exactly as Cloudflare deploys it from the Deploy to Cloudflare
 * button: no identity block, nothing configured, an empty KV namespace.
 *
 * It exists because that path has a property no unit test can assert on its own: a
 * brand-new deployment must be *reachable*. The panel lives under a random
 * 24-character path that only the Worker knows, so if the setup page did not appear, or
 * appeared and handed out a URL that did not work, the deployment would be a Worker
 * nobody could ever sign in to. The interesting failure is not an exception, it is a
 * dead end.
 *
 * The flow, in the order a real user meets it:
 *
 *   1. the artifact evaluates and carries no identity block
 *   2. the first request bootstraps an identity into KV and serves the setup page
 *   3. a weak password and a bad email are refused
 *   4. a valid claim sets the password and reveals the panel URL
 *   5. the revealed URL serves the login page, and the credentials work
 *   6. the panel renders, and subscriptions generate against the request hostname
 *   7. the setup page is gone, and a second claim cannot take the deployment
 *   8. the identity survives a cold start, so links stay valid
 *
 * What is stubbed, and why this is still a real test
 *
 * KV is an in-memory Map with the four methods `src/storage/storage.ts` uses.
 * `cloudflare:sockets` is unavailable outside the Workers runtime, so the loader hook
 * in scripts/preview-loader.mjs substitutes a stub that throws on connect. Outbound
 * `fetch` is intercepted, so the run touches no network. Everything else, the router,
 * identity resolution, setup, auth, JWT, CSP, validators and config generators, is the
 * shipped code.
 *
 * Usage:
 *   npm run build
 *   npm run test:deploy-flow
 */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const green = '\x1b[32m';
const red = '\x1b[31m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';

const ARTIFACT = join(root, process.env.RAYZEN_ARTIFACT ?? 'dist/worker.js');

/** The hostname a Worker named `rayzen-edge` gets on a fresh account. */
const HOST = 'rayzen-edge.example-account.workers.dev';
const EMAIL = 'owner@example.invalid';
const PASSWORD = 'DeployFlow1';

if (!existsSync(ARTIFACT)) {
    console.error(`${red}✗${reset} ${ARTIFACT} not found. Run \`npm run build\` first.`);
    process.exit(1);
}

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
    if (condition) {
        passed++;
        console.log(`  ${green}✔${reset} ${name}`);
    } else {
        failed++;
        failures.push(name);
        console.log(`  ${red}✗${reset} ${name}${detail ? `  ${dim}${detail}${reset}` : ''}`);
    }
}

function step(number, title) {
    console.log(`\n${number}. ${title}`);
}

function createKv() {
    const store = new Map();
    return {
        store,
        namespace: {
            async get(key, options) {
                const raw = store.get(key);
                if (raw === undefined) return null;
                const type = typeof options === 'string' ? options : options?.type;
                return type === 'json' ? JSON.parse(raw) : raw;
            },
            async put(key, value) {
                store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
            },
            async delete(key) { store.delete(key); },
            async list() {
                return { keys: [...store.keys()].map(name => ({ name })), list_complete: true, cacheStatus: null };
            }
        }
    };
}

const intercepted = new Map();
globalThis.fetch = async input => {
    const url = typeof input === 'string' ? input : input.url;
    const { hostname } = new URL(url);
    intercepted.set(hostname, (intercepted.get(hostname) ?? 0) + 1);

    if (url.includes('/dns-query')) {
        return new Response(JSON.stringify({ Answer: [{ type: 1, data: '8.8.8.8' }] }), {
            status: 200, headers: { 'Content-Type': 'application/dns-json' }
        });
    }
    if (hostname === 'api.cloudflareclient.com') {
        return new Response(JSON.stringify({
            config: {
                interface: { addresses: { v6: '2606:4700:110:0:0:0:0:1' } },
                peers: [{ public_key: 'ZGVwbG95LWZsb3ctdGVzdC1wZWVyLXB1YmxpYy1rZXk=' }],
                client_id: 'AAAA'
            }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    // A deployment made with the button has no Cloudflare token, so the honest answer
    // from the account API is a refusal.
    if (hostname === 'api.cloudflare.com') {
        return new Response(JSON.stringify({ success: false, errors: [{ message: 'no token' }], result: null }), {
            status: 403, headers: { 'Content-Type': 'application/json' }
        });
    }
    return new Response('<html><body>upstream</body></html>', {
        status: 200, headers: { 'Content-Type': 'text/html' }
    });
};

/* ------------------------------------------------------------------ *
 * 1. The artifact as Cloudflare deploys it
 * ------------------------------------------------------------------ */

step(1, 'The build artifact, deployed as-is');

const module = await import(ARTIFACT);
const worker = module.default;

check('the artifact exports a fetch handler', typeof worker?.fetch === 'function');
check('it carries no identity block, so nothing is baked in',
    typeof globalThis.EMBEDED_SETTINGS === 'undefined');
check('the embedded setup page is present', typeof globalThis.SETUP_HTML_CONTENT === 'string');

const kv = createKv();
const env = { CF_PAGES: '0', kv: kv.namespace };

let cookie = '';
const call = async (path, options = {}) => {
    const headers = new Headers(options.headers ?? {});
    if (cookie) headers.set('Cookie', cookie);
    if (options.json !== undefined) headers.set('Content-Type', 'application/json');

    const request = new Request(`https://${options.host ?? HOST}${path}`, {
        method: options.method ?? 'GET',
        headers,
        ...(options.json === undefined ? {} : { body: JSON.stringify(options.json) }),
        redirect: 'manual'
    });
    return worker.fetch(request, env);
};

const json = async response => {
    const text = await response.text();
    try { return JSON.parse(text); } catch { return { __unparsed: text.slice(0, 200) }; }
};

/* ------------------------------------------------------------------ *
 * 2. First request
 * ------------------------------------------------------------------ */

step(2, 'First request bootstraps the deployment');

const first = await call('/');
const firstHtml = await first.text();

check('the root serves the setup page', first.status === 200, `status ${first.status}`);
check('it is a complete HTML document', firstHtml.startsWith('<!DOCTYPE html>'));
check('the icon placeholder was substituted', !firstHtml.includes('__ICON__'));
check('the version placeholder was substituted', !firstHtml.includes('__VERSION__'));
check('every setup placeholder was substituted',
    !firstHtml.includes('__EMAIL_FIXED__') &&
    !firstHtml.includes('__TOKEN_REQUIRED__') &&
    !firstHtml.includes('__EMAIL_VALUE__'));
check('it carries a content security policy',
    (first.headers.get('Content-Security-Policy') ?? '').includes("default-src 'none'"));
check('it is not cached, because it reveals a secret path once',
    first.headers.get('Cache-Control') === 'no-store');
check('search engines are asked not to index it', firstHtml.includes('noindex'));

const identity = JSON.parse(kv.store.get('rz:identity') ?? '{}');
check('an identity was written to KV', typeof identity.securePath === 'string');
check('the generated panel path is 24 URL-safe characters',
    /^[A-Za-z0-9]{24}$/.test(identity.securePath ?? ''), identity.securePath);
check('a VLESS UUID was generated',
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(identity.vlUUID ?? ''));
check('a Trojan password was generated', /^[A-Za-z0-9]{32}$/.test(identity.trPass ?? ''));
check('no account is claimed yet', !identity.accEmail);
check('no Cloudflare credential was persisted',
    !(kv.store.get('rz:identity') ?? '').includes('apiToken'));

/* ------------------------------------------------------------------ *
 * 3. Refusals
 * ------------------------------------------------------------------ */

step(3, 'Setup refuses what it should');

const weak = await json(await call('/setup/claim', { method: 'POST', json: { email: EMAIL, password: 'short1' } }));
check('a password below the documented rule is refused', weak.success === false, weak.message ?? '');
check('nothing was written by the refusal', !kv.store.has('pwd'));

const badEmail = await json(await call('/setup/claim', { method: 'POST', json: { email: 'nope', password: PASSWORD } }));
check('a malformed email is refused', badEmail.success === false, badEmail.message ?? '');

const getClaim = await call('/setup/claim');
check('the claim route refuses GET', getClaim.status === 405, `status ${getClaim.status}`);

/* ------------------------------------------------------------------ *
 * 4. The claim
 * ------------------------------------------------------------------ */

step(4, 'Claiming the deployment');

const claimed = await json(await call('/setup/claim', {
    method: 'POST',
    json: { email: EMAIL.toUpperCase(), password: PASSWORD }
}));

check('the claim succeeds', claimed.success === true, claimed.message ?? '');
const storedPasswordVerifier = kv.store.get('pwd') ?? '';
check('a salted password verifier reached storage',
    storedPasswordVerifier.startsWith('pbkdf2-sha256$100000$') && !storedPasswordVerifier.includes(PASSWORD));
check('the email was recorded in lower case',
    JSON.parse(kv.store.get('rz:identity') ?? '{}').accEmail === EMAIL);
check('the username reported back is the sign-in address', claimed.body?.username === EMAIL);

const panelUrl = claimed.body?.panelUrl ?? '';
const loginUrl = claimed.body?.loginUrl ?? '';
check('a panel URL was revealed', panelUrl.startsWith(`https://${HOST}/`), panelUrl);
check('the revealed URL carries the generated secret path',
    panelUrl.includes(identity.securePath), panelUrl);
check('a login URL was revealed too', loginUrl.endsWith('/login'), loginUrl);

/* ------------------------------------------------------------------ *
 * 5. The revealed URL works
 * ------------------------------------------------------------------ */

step(5, 'The revealed URL is usable');

const panelPath = new URL(panelUrl).pathname;
const loginPath = new URL(loginUrl).pathname;

const anonymous = await call(panelPath);
check('the panel now redirects an anonymous visitor', anonymous.status === 302,
    `status ${anonymous.status}`);
check('the redirect goes to the login page',
    (anonymous.headers.get('Location') ?? '').endsWith(loginPath),
    anonymous.headers.get('Location') ?? '');

const loginPage = await call(loginPath);
check('the login page renders', loginPage.status === 200, `status ${loginPage.status}`);

const wrong = await call(`${loginPath}/authenticate`, {
    method: 'POST',
    json: { username: EMAIL, password: 'not-the-password' }
});
check('wrong credentials are rejected', wrong.status === 401, `status ${wrong.status}`);

const signIn = await call(`${loginPath}/authenticate`, {
    method: 'POST',
    json: { username: EMAIL, password: PASSWORD }
});
const setCookie = signIn.headers.get('Set-Cookie') ?? '';
check('the credentials chosen at setup work', signIn.status === 200, `status ${signIn.status}`);
check('a hardened session cookie is issued',
    setCookie.includes('jwtToken=') && setCookie.includes('HttpOnly') &&
    setCookie.includes('Secure') && setCookie.includes('SameSite=Strict'));

cookie = /jwtToken=[^;]*/.exec(setCookie)?.[0] ?? '';

/* ------------------------------------------------------------------ *
 * 6. The panel and its output
 * ------------------------------------------------------------------ */

step(6, 'The panel works and generates configs');

const panel = await call(panelPath);
const panelHtml = await panel.text();
check('the panel renders for the session', panel.status === 200, `status ${panel.status}`);
check('the RayZen shell is present', panelHtml.includes('data-rz-view'));

const settings = await json(await call(`${panelPath}/settings`));
check('settings load', settings.success === true, settings.message ?? '');
check('the panel reports the generated identity, not a placeholder',
    settings.body?.proxySettings?.securePath === identity.securePath);
check('the panel knows the deployment is claimed', settings.body?.isPassSet === true);

const subscription = await call(`/${identity.securePath}/sub/normal?app=xray`);
const configText = await subscription.text();
check('a subscription generates', subscription.status === 200, `status ${subscription.status}`);
check('the config names this deployment\'s hostname', configText.includes(HOST));
check('the config carries the generated UUID', configText.includes(identity.vlUUID));

// The hostname is resolved per request, so the same deployment answering on a custom
// domain must generate configs for that domain rather than for its workers.dev address.
const customDomain = 'panel.example.com';
const viaCustom = await call(`/${identity.securePath}/sub/normal?app=xray`, { host: customDomain });
const customText = await viaCustom.text();
check('a request on a custom domain generates configs for that domain',
    customText.includes(customDomain) && !customText.includes(HOST));

/* ------------------------------------------------------------------ *
 * 7. Setup is gone
 * ------------------------------------------------------------------ */

step(7, 'Setup closes behind itself');

const rootAfter = await call('/');
check('the root no longer serves the setup page', rootAfter.status !== 200 ||
    !(await rootAfter.clone().text()).includes('Set up your panel'),
    `status ${rootAfter.status}`);
check('the root carries none of the panel\'s distinctive headers, like any unmatched path',
    rootAfter.headers.get('Content-Security-Policy') === null);

const secondClaim = await call('/setup/claim', {
    method: 'POST',
    json: { email: 'attacker@example.invalid', password: 'Attack3rPass' }
});
check('a second claim cannot take the deployment', secondClaim.status !== 200,
    `status ${secondClaim.status}`);
check('the original password verifier is untouched', kv.store.get('pwd') === storedPasswordVerifier);
check('the original email is untouched',
    JSON.parse(kv.store.get('rz:identity') ?? '{}').accEmail === EMAIL);

/* ------------------------------------------------------------------ *
 * 8. Cold start
 * ------------------------------------------------------------------ */

step(8, 'The identity survives a cold start');

// A fresh module instance is a fresh isolate: the in-memory identity cache is empty,
// so this is the path every cold start takes. If it regenerated, every subscription
// link already handed out would break.
const secondIsolate = (await import(`${ARTIFACT}?isolate=2`)).default;
const afterRestart = await secondIsolate.fetch(
    new Request(`https://${HOST}/${identity.securePath}/sub/normal?app=xray`),
    env
);
const afterText = await afterRestart.text();

check('subscriptions still generate after a restart', afterRestart.status === 200,
    `status ${afterRestart.status}`);
check('the same UUID is served, so existing links keep working',
    afterText.includes(identity.vlUUID));
check('no second identity was written',
    JSON.parse(kv.store.get('rz:identity') ?? '{}').securePath === identity.securePath);

/* ------------------------------------------------------------------ *
 * Result
 * ------------------------------------------------------------------ */

console.log(`\n${dim}Outbound fetch intercepted (no request left this process):${reset}`);
for (const [host, count] of [...intercepted].sort()) {
    console.log(`  ${dim}${host}  ×${count}${reset}`);
}

console.log('');
if (failed > 0) {
    console.error(`${red}${failed} failed${reset}, ${passed} passed of ${passed + failed} checks`);
    for (const name of failures) console.error(`  ${red}✗${reset} ${name}`);
    process.exit(1);
}

console.log(`${green}${passed} passed, 0 failed${reset} ${dim}of ${passed} checks${reset}`);
console.log(`${green}✔${reset} One-click deployment flow verified against ${process.env.RAYZEN_ARTIFACT ?? 'dist/worker.js'}`);
