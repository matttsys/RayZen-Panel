/**
 * End-to-end user-flow test against a real packaged artifact.
 *
 * This is not a unit test and it does not import `src/`. It loads
 * `dist/worker.deploy.js`, the file a user uploads to Cloudflare, and drives the
 * promised user flows, in order, through the Worker's own `fetch` handler:
 *
 *   1. the Worker module evaluates and exports a fetch handler
 *   2. an unauthenticated panel request redirects to login once a password is set
 *   3. the login page renders
 *   4. wrong credentials are rejected, correct ones return a session cookie
 *   5. the panel renders for a session
 *   6. settings read, validate-reject and save all behave
 *   7. subscriptions generate for xray, sing-box and clash
 *   8. diagnostics, health center and deployment preflight answer
 *   9. scanner history and schedule answer, and the scan route rejects a bad body
 *  10. recommendations answer
 *  11. backup export round-trips through validate and plan
 *  12. logout clears the cookie
 *
 * What is stubbed, and why this is still a real test
 *
 * KV is an in-memory Map with the four methods `src/storage/storage.ts` uses.
 * `cloudflare:sockets` is unavailable outside the Workers runtime, so the loader
 * hook in `scripts/preview-loader.mjs` substitutes a stub that throws on connect:
 * the scanner's *probe* therefore cannot run here, and the test asserts the route's
 * validation and error behaviour rather than pretending a TCP connection happened.
 * Outbound `fetch` is intercepted so the run makes no network requests; each
 * interception is named in the output.
 *
 * Everything else, the router, auth, JWT, CSP, validators, config generators,
 * diagnostics, health, backup, and the embedded page bytes, is the shipped code.
 *
 * Usage:
 *   npm run build
 *   RAYZEN_MAIN_DOMAIN=... RAYZEN_ACC_EMAIL=... npm run package
 *   node --import ./scripts/preview-register.mjs scripts/flow-test.js
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const green = '\x1b[32m';
const red = '\x1b[31m';
const yellow = '\x1b[33m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';

const ARTIFACT = join(root, process.env.RAYZEN_ARTIFACT ?? 'dist/worker.deploy.js');
const PASSWORD = 'FlowTestPass123';

if (!existsSync(ARTIFACT)) {
    console.error(`${red}✗${reset} ${ARTIFACT} not found. Run \`npm run build\` then \`npm run package\`.`);
    process.exit(1);
}

/**
 * Refuse to verify an artifact older than the build it came from.
 *
 * `npm run package` is a separate step, so `dist/worker.deploy.js` can be older than
 * `dist/worker.js`. This test then reports that the *previous* release passes 118 checks,
 * which is worse than reporting nothing: it is a green gate on code that is not there. It
 * happened, and the shared-subscription-link step is what caught it, by 404-ing on routes
 * that exist in the source.
 */
const BUILD = join(root, 'dist', 'worker.js');
if (existsSync(BUILD) && statSync(BUILD).mtimeMs > statSync(ARTIFACT).mtimeMs) {
    const age = Math.round((statSync(BUILD).mtimeMs - statSync(ARTIFACT).mtimeMs) / 1000);
    console.error(
        `${red}✗${reset} ${ARTIFACT} is ${age}s older than dist/worker.js, so this run would ` +
        'verify a previous build. Re-run `npm run package`.'
    );
    process.exit(1);
}

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

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

/**
 * Intercepts outbound fetch.
 *
 * A Worker under test must not reach the network: `getDataset` resolves DNS for a
 * DoH host, `fetchWarpAccounts` registers WARP accounts, `panel/my-ip` calls an IP
 * echo service, and the fallback proxies an upstream site. Each is answered with a
 * shaped response so the flow proceeds deterministically, and every intercepted
 * host is reported so a silent new dependency is visible.
 */
const intercepted = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const { hostname } = new URL(url);
    intercepted.set(hostname, (intercepted.get(hostname) ?? 0) + 1);

    // DoH resolution, used by `getDnsParams` when the remote DNS is a domain.
    if (url.includes('/dns-query')) {
        return new Response(JSON.stringify({ Answer: [{ type: 1, data: '8.8.8.8' }] }), {
            status: 200, headers: { 'Content-Type': 'application/dns-json' }
        });
    }
    // WARP registration. Answered with a well-shaped account so the settings path
    // does not fall back to the two built-in accounts silently.
    if (hostname === 'api.cloudflareclient.com') {
        return new Response(JSON.stringify({
            config: {
                interface: { addresses: { v6: '2606:4700:110:0:0:0:0:1' } },
                peers: [{ public_key: 'YmV0YS1mbG93LXRlc3QtcGVlci1wdWJsaWMta2V5' }],
                client_id: 'AAAA'
            }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (hostname === 'ip-api.com') {
        return new Response(JSON.stringify({ country: 'Testland', query: '203.0.113.7' }), {
            status: 200, headers: { 'Content-Type': 'application/json' }
        });
    }
    // Cloudflare account API. There is no token in this run, so the honest answer
    // is the failure a tokenless deployment gets.
    if (hostname === 'api.cloudflare.com') {
        return new Response(JSON.stringify({ success: false, errors: [{ message: 'no token' }], result: null }), {
            status: 403, headers: { 'Content-Type': 'application/json' }
        });
    }
    // The unmatched-path fallback proxies an unrelated upstream.
    return new Response('<html><body>upstream</body></html>', {
        status: 200, headers: { 'Content-Type': 'text/html' }
    });
};

/* ------------------------------------------------------------------ *
 * 1. Worker starts
 * ------------------------------------------------------------------ */

step(1, 'Worker module evaluates');

const module = await import(ARTIFACT);
const worker = module.default;
check('the artifact exports a default object', typeof worker === 'object' && worker !== null);
check('the export has a fetch handler', typeof worker?.fetch === 'function');
check('the identity block is present', typeof globalThis.EMBEDED_SETTINGS === 'object');
check('the embedded panel page is present', typeof globalThis.PANEL_HTML_CONTENT === 'string');

const { securePath, accEmail, mainDomain, vlUUID } = globalThis.EMBEDED_SETTINGS;
const origin = `https://${mainDomain}`;
const kv = createKv();
const env = { CF_PAGES: '0', kv: kv.namespace };

let cookie = '';
const call = async (path, options = {}) => {
    const headers = new Headers(options.headers ?? {});
    if (cookie) headers.set('Cookie', cookie);
    if (options.json !== undefined) {
        headers.set('Content-Type', 'application/json');
    }
    const request = new Request(`${origin}${path}`, {
        method: options.method ?? 'GET',
        headers,
        ...(options.json === undefined ? {} : { body: JSON.stringify(options.json) }),
        ...(options.body === undefined ? {} : { body: options.body }),
        redirect: 'manual'
    });
    return worker.fetch(request, env);
};

const json = async response => {
    const text = await response.text();
    try { return JSON.parse(text); } catch { return { __unparsed: text.slice(0, 200) }; }
};

/* ------------------------------------------------------------------ *
 * 2. First contact and password bootstrap
 * ------------------------------------------------------------------ */

step(2, 'First launch and password bootstrap');

const bootstrapPanel = await call(`/${securePath}/panel`);
check('a fresh deployment serves the panel so a password can be set', bootstrapPanel.status === 200,
    `status ${bootstrapPanel.status}`);

const setPassword = await call(`/${securePath}/panel/reset-password`, {
    method: 'POST',
    // Shape taken from `openResetPass` in src/assets/panel/script.js: a JSON body
    // carrying username and password. `resetPassword` requires the username when
    // there is no session, which is exactly the first-run case.
    json: { username: accEmail, password: PASSWORD }
});
check('the first password is accepted without a session', setPassword.status === 200,
    `status ${setPassword.status} ${(await setPassword.clone().text()).slice(0, 120)}`);
const storedPasswordVerifier = kv.store.get('pwd') ?? '';
check('a salted password verifier reached storage',
    storedPasswordVerifier.startsWith('pbkdf2-sha256$') && !storedPasswordVerifier.includes(PASSWORD));

const guarded = await call(`/${securePath}/panel`);
check('the panel now redirects an anonymous visitor to login', guarded.status === 302,
    `status ${guarded.status}`);
check('the redirect target is the login page',
    (guarded.headers.get('Location') ?? '').endsWith(`/${securePath}/login`),
    guarded.headers.get('Location') ?? '');

/* ------------------------------------------------------------------ *
 * 3. Website loads: the login page
 * ------------------------------------------------------------------ */

step(3, 'Login page');

const loginPage = await call(`/${securePath}/login`);
const loginHtml = await loginPage.text();
check('the login page renders', loginPage.status === 200, `status ${loginPage.status}`);
check('it is a complete HTML document', loginHtml.startsWith('<!DOCTYPE html>'));
check('the icon placeholder was substituted', !loginHtml.includes('__ICON__'));
check('the version placeholder was substituted', !loginHtml.includes('__VERSION__'));
check('it carries a content security policy',
    (loginPage.headers.get('Content-Security-Policy') ?? '').includes("default-src 'none'"));
// The login page uses inline SVG icons (no Material Symbols font), so it must
// neither fetch nor embed a font: system fonts plus currentColor SVG icons.
check('the login page loads no external font', !loginHtml.includes('fonts.gstatic.com'));
check('the login page embeds no icon font', !loginHtml.includes('data:font/woff2'));

/* ------------------------------------------------------------------ *
 * 4. Login
 * ------------------------------------------------------------------ */

step(4, 'Authentication');

const badLogin = await call(`/${securePath}/login/authenticate`, {
    method: 'POST',
    json: { username: accEmail, password: 'wrong-password' }
});
check('wrong credentials are rejected with 401', badLogin.status === 401, `status ${badLogin.status}`);
check('a rejected login sets no cookie', !badLogin.headers.get('Set-Cookie'));

const goodLogin = await call(`/${securePath}/login/authenticate`, {
    method: 'POST',
    json: { username: accEmail.toUpperCase(), password: PASSWORD }
});
const setCookie = goodLogin.headers.get('Set-Cookie') ?? '';
check('correct credentials are accepted', goodLogin.status === 200, `status ${goodLogin.status}`);
check('a session cookie is issued', setCookie.includes('jwtToken='));
check('the cookie is HttpOnly, Secure and SameSite=Strict',
    setCookie.includes('HttpOnly') && setCookie.includes('Secure') && setCookie.includes('SameSite=Strict'));
check('a signing secret was generated and stored', typeof kv.store.get('secretKey') === 'string');

cookie = /jwtToken=[^;]*/.exec(setCookie)?.[0] ?? '';

/* ------------------------------------------------------------------ *
 * 5. Dashboard
 * ------------------------------------------------------------------ */

step(5, 'Dashboard');

const panel = await call(`/${securePath}/panel`);
const panelHtml = await panel.text();
check('the panel renders for a session', panel.status === 200, `status ${panel.status}`);
check('the RayZen shell is present', panelHtml.includes('data-rz-view'));
// The view sections are constructed by `buildRayZenViews` at load time rather than
// being present as markup, so the shipped evidence is the definition list inside
// the inlined script.
check('every panel view is defined in the shipped script',
    ['overview', 'configuration', 'smart', 'diagnostics', 'intelligence', 'analytics', 'settings']
        .every(view => panelHtml.includes(`"${view}"`) || panelHtml.includes(`'${view}'`)));
check('the page script is inlined', panelHtml.includes('<script>') && !panelHtml.includes('src="script.js"'));
check('the CSP hash covers the inlined script',
    (panel.headers.get('Content-Security-Policy') ?? '').includes('sha256-'));

/* ------------------------------------------------------------------ *
 * 6. Configuration
 * ------------------------------------------------------------------ */

step(6, 'Configuration read, validation and save');

const settingsRes = await call(`/${securePath}/panel/settings`);
const settingsBody = await json(settingsRes);
check('settings load', settingsRes.status === 200, `status ${settingsRes.status}`);
check('the response reports the password as set', settingsBody.body?.isPassSet === true);
check('proxy settings are returned', typeof settingsBody.body?.proxySettings === 'object');
check('the subscription catalogue is returned',
    typeof settingsBody.body?.subscriptions?.normal === 'object');
check('the settings carry a panel version',
    typeof settingsBody.body?.proxySettings?.panelVersion === 'string' &&
    settingsBody.body.proxySettings.panelVersion.length > 0,
    String(settingsBody.body?.proxySettings?.panelVersion));

const current = settingsBody.body?.proxySettings;
if (!current) {
    console.log(`${red}✗${reset} settings did not load; the remaining steps cannot run`);
    process.exit(1);
}

const rejected = await call(`/${securePath}/panel/update-settings`, {
    method: 'PUT',
    json: { ...current, vlUUID: 'not-a-uuid' }
});
const rejectedBody = await json(rejected);
check('an invalid UUID is rejected with 400', rejected.status === 400, `status ${rejected.status}`);
check('the rejection names the offending field',
    Array.isArray(rejectedBody.body) && rejectedBody.body.some(issue => /UUID/i.test(issue.field)));

const saved = await call(`/${securePath}/panel/update-settings`, {
    method: 'PUT',
    json: { ...current, vlUUID, localDNS: '1.1.1.1', blockAds: true }
});
check('a valid save is accepted', saved.status === 200, `status ${saved.status}`);
const afterSave = JSON.parse(kv.store.get('proxySettings'));
check('the saved value is in storage', afterSave.localDNS === '1.1.1.1' && afterSave.blockAds === true,
    `localDNS ${afterSave.localDNS}`);

/* ------------------------------------------------------------------ *
 * 7. Subscription / config generation
 * ------------------------------------------------------------------ */

step(7, 'Subscription and configuration generation');

const subscription = async (kind, client) => {
    const response = await call(`/${securePath}/sub/${kind}/${vlUUID}?app=${client}`);
    return { response, text: await response.text() };
};

const xray = await subscription('normal', 'xray');
check('xray normal subscription returns 200', xray.response.status === 200, `status ${xray.response.status}`);
const xrayConfig = (() => { try { return JSON.parse(xray.text); } catch { return null; } })();
check('the xray payload is JSON', xrayConfig !== null);
check('it contains outbounds carrying this deployment UUID',
    xray.text.includes(vlUUID), 'UUID absent from generated config');
check('it routes through this deployment hostname', xray.text.includes(mainDomain));

const singbox = await subscription('normal', 'sing-box');
check('sing-box normal subscription returns 200', singbox.response.status === 200,
    `status ${singbox.response.status}`);
check('the sing-box payload declares outbounds', singbox.text.includes('outbounds'));

const clash = await subscription('normal', 'clash');
check('clash normal subscription returns 200', clash.response.status === 200,
    `status ${clash.response.status}`);
// The clash core emits JSON, not YAML: `getClNormalConfig` in
// src/cores/clash/configs.ts responds with `JSON.stringify(config, null, 4)` and
// `Content-Type: application/json`. Clash Meta, Verge, FlClash and Stash all accept
// it, so the assertion is on the structure the clients need.
const clashConfig = (() => { try { return JSON.parse(clash.text); } catch { return null; } })();
check('the clash payload is a parseable config document', clashConfig !== null);
check('it declares proxies and proxy groups',
    Array.isArray(clashConfig?.proxies) && clashConfig.proxies.length > 0 &&
    Array.isArray(clashConfig?.['proxy-groups']),
    `proxies ${clashConfig?.proxies?.length}`);
check('the clash proxies carry this deployment UUID', clash.text.includes(vlUUID));

const fragment = await subscription('fragment', 'xray');
check('xray fragment subscription returns 200', fragment.response.status === 200,
    `status ${fragment.response.status}`);
check('the fragment payload configures fragmentation',
    fragment.text.includes('fragment'), 'no fragment settings in payload');

const raw = await subscription('raw', 'xray');
check('the raw subscription returns 200', raw.response.status === 200, `status ${raw.response.status}`);
const rawText = raw.text;
const rawDecoded = (() => {
    try { return Buffer.from(rawText, 'base64').toString('utf8'); } catch { return rawText; }
})();
check('the raw subscription carries importable URIs',
    /(vless|trojan):\/\//.test(rawDecoded) || /(vless|trojan):\/\//.test(rawText),
    'no vless:// or trojan:// URI found');

const warp = await subscription('warp', 'xray');
check('the warp subscription returns 200', warp.response.status === 200, `status ${warp.response.status}`);

// The panel calls this route with POST and a `data` parameter carrying the full
// subscription URL (`generateQRCode` in src/assets/panel/script.js). A `data` value
// whose origin is not this deployment's is sent to the fallback, so the URL must be
// a real subscription link for the route to produce an image.
const subUrl = `${origin}/${securePath}/sub/normal/${vlUUID}?app=xray`;
const qr = await call(`/${securePath}/qrcode?data=${encodeURIComponent(subUrl)}`, { method: 'POST' });
const qrBytes = Buffer.from(await qr.arrayBuffer());
check('QR generation returns an image', qr.status === 200 &&
    (qr.headers.get('Content-Type') ?? '').includes('image/png'),
    `${qr.status} ${qr.headers.get('Content-Type')}`);
check('the response is a valid PNG',
    qrBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    `first bytes ${[...qrBytes.subarray(0, 8)].join(',')}`);

// The "foreign" origin is derived from this deployment's own hostname rather than
// hardcoded. A literal such as `https://example.invalid/whatever` is same-origin
// whenever the artifact was packaged with `RAYZEN_MAIN_DOMAIN=example.invalid`, and
// the check then fails for a reason that has nothing to do with the route.
const foreignHost = `not-${mainDomain.replace(/:.*$/, '')}.invalid`;
const foreignQr = await call(
    `/${securePath}/qrcode?data=${encodeURIComponent(`https://${foreignHost}/whatever`)}`,
    { method: 'POST' }
);
check('a QR request for a foreign origin is refused', foreignQr.status !== 200 ||
    !(foreignQr.headers.get('Content-Type') ?? '').includes('image/png'),
    `status ${foreignQr.status}`);

/* ------------------------------------------------------------------ *
 * 8. Shared subscription links
 * ------------------------------------------------------------------ */

step(8, 'Shared subscription links');

/**
 * What is worth proving on the built artifact is that a shared link and the operator's own
 * link are the same subscription behind different authorisation, and that revoking one does
 * not touch the other.
 *
 * The unit tests cover the routes and a browser run covers the screen. Neither runs against
 * `dist/worker.deploy.js`, which is the file an operator actually deploys.
 */
const createdLink = await call(`/${securePath}/panel/platform/links/create`, {
    method: 'POST',
    json: { name: 'Flow test device', days: 30 }
});
const createdBody = await json(createdLink);
check('a shared link can be created',
    createdLink.status === 200 && typeof createdBody.body?.token === 'string',
    `status ${createdLink.status}`);

const linkToken = createdBody.body?.token ?? '';
check('the token is URL-safe and long enough to be unguessable',
    /^[A-Za-z0-9_-]{16,64}$/.test(linkToken), `token ${linkToken}`);

const linkList = await json(await call(`/${securePath}/panel/platform/links`));
check('the created link is readable back from storage',
    Boolean(linkList.body?.profiles?.some(profile => profile.token === linkToken)),
    `${linkList.body?.profiles?.length ?? 0} stored`);
check('the list reports the cap, so the panel need not hardcode it',
    typeof linkList.body?.max === 'number' && linkList.body.max > 0);

const viaLink = await call(`/${securePath}/p/${linkToken}/sub/normal?app=xray`);
const viaLinkText = await viaLink.text();
check('the shared link serves a subscription',
    viaLink.status === 200 && viaLinkText.length > 500,
    `status ${viaLink.status}, ${viaLinkText.length} bytes`);
check('it carries this deployment UUID, so it is the same subscription',
    viaLinkText.includes(vlUUID));
check('the token does not appear in what it serves', !viaLinkText.includes(linkToken));

const linkHistory = await json(await call(`/${securePath}/panel/platform/history?limit=20`));
const linkEntry = (linkHistory.body ?? []).find(entry => entry.kind === 'links.changed');
check('the change is recorded in history', Boolean(linkEntry), 'no links.changed entry');
check('history names the link but never its token',
    Boolean(linkEntry?.summary.includes('Flow test device')) &&
    !JSON.stringify(linkHistory.body).includes(linkToken));

const revoke = await call(`/${securePath}/panel/platform/links/update`, {
    method: 'POST',
    json: { token: linkToken, action: 'disable' }
});
check('a link can be revoked', revoke.status === 200, `status ${revoke.status}`);

const afterRevoke = await call(`/${securePath}/p/${linkToken}/sub/normal?app=xray`);
const afterRevokeText = await afterRevoke.text();
check('a revoked link stops serving', afterRevoke.status !== 200, `status ${afterRevoke.status}`);
check('the refusal does not say why, so it cannot confirm the token was real',
    !/revok|expir/i.test(afterRevokeText) && !afterRevokeText.includes('RayZen'));

const ownAfterRevoke = await call(`/${securePath}/sub/normal/${vlUUID}?app=xray`);
check("revoking a shared link leaves the operator's own link working",
    ownAfterRevoke.status === 200, `status ${ownAfterRevoke.status}`);

const unknownToken = await call(`/${securePath}/p/${'z'.repeat(22)}/sub/normal?app=xray`);
check('an unknown token answers exactly as a revoked one does',
    unknownToken.status === afterRevoke.status,
    `${unknownToken.status} vs ${afterRevoke.status}`);

const deleted = await call(`/${securePath}/panel/platform/links/update`, {
    method: 'POST',
    json: { token: linkToken, action: 'delete' }
});
const afterDelete = await json(await call(`/${securePath}/panel/platform/links`));
check('a link can be deleted',
    deleted.status === 200 &&
    !afterDelete.body?.profiles?.some(profile => profile.token === linkToken),
    `status ${deleted.status}`);

/* ------------------------------------------------------------------ *
 * 9. Diagnostics and health
 * ------------------------------------------------------------------ */

step(9, 'Diagnostics, health and deployment checks');

const health = await call(`/${securePath}/panel/platform/health`);
const healthBody = await json(health);
check('diagnostics answer', health.status === 200, `status ${health.status}`);
// `run` in src/features/diagnostics/service.ts returns
// `{ score, grade, findings, tally, at }`.
check('the report contains findings',
    Array.isArray(healthBody.body?.findings) && healthBody.body.findings.length > 0,
    `keys ${Object.keys(healthBody.body ?? {}).join(',')}`);
check('each finding carries an id, status and weight',
    (healthBody.body?.findings ?? []).every(entry =>
        typeof entry.id === 'string' && typeof entry.status === 'string' && typeof entry.weight === 'number'));
check('the report carries a weighted score and grade',
    typeof healthBody.body?.score === 'number' && typeof healthBody.body?.grade === 'string',
    `${healthBody.body?.score} ${healthBody.body?.grade}`);
check('the bound KV namespace is detected as a pass',
    (healthBody.body?.findings ?? []).some(entry => entry.id === 'platform.kv-bound' && entry.status === 'pass'));
// Asserted against what this artifact actually carries rather than assuming a
// tokenless build. Both directions matter: a packaged artifact with no token must
// say so rather than hide it, and one with a token must not warn about a problem
// that does not exist. Hardcoding either turns a correct deployment into a failure.
const updateCheck = (healthBody.body?.findings ?? []).find(entry => entry.id === 'platform.update-capability');
const hasToken = Boolean(process.env.RAYZEN_CF_API_TOKEN);
check('the self-update capability check is present', Boolean(updateCheck));
check(
    hasToken
        ? 'a configured API token is reported as a pass'
        : 'an absent API token is reported honestly rather than hidden',
    hasToken ? updateCheck?.status === 'pass' : updateCheck?.status !== 'pass',
    `token ${hasToken ? 'present' : 'absent'}, status ${updateCheck?.status}`);

const center = await call(`/${securePath}/panel/platform/health/center`);
const centerBody = await json(center);
check('the health center answers', center.status === 200, `status ${center.status}`);
check('it reduces to one status', typeof centerBody.body?.status === 'string');
check('it returns per-area sections', Array.isArray(centerBody.body?.sections) && centerBody.body.sections.length > 0);

const preflight = await call(`/${securePath}/panel/platform/deployment/preflight`);
const preflightBody = await json(preflight);
check('deployment preflight answers', preflight.status === 200, `status ${preflight.status}`);
check('it reports readiness', typeof preflightBody.body?.ready === 'boolean');
check('it detects the bound KV namespace',
    JSON.stringify(preflightBody.body ?? {}).includes('"pass"') ||
    preflightBody.body?.ready === true);

const features = await call(`/${securePath}/panel/platform/features`);
check('the capability matrix answers', features.status === 200, `status ${features.status}`);

const advanced = await call(`/${securePath}/panel/platform/advanced/diagnostics`);
check('advanced diagnostics answer', advanced.status === 200, `status ${advanced.status}`);

const metrics = await call(`/${securePath}/panel/platform/metrics`);
const metricsBody = await json(metrics);
check('analytics answer', metrics.status === 200, `status ${metrics.status}`);
check('a login was counted', JSON.stringify(metricsBody.body ?? {}).includes('auth'));

const historyRes = await call(`/${securePath}/panel/platform/history?limit=10`);
const historyBody = await json(historyRes);
check('history answers', historyRes.status === 200, `status ${historyRes.status}`);
check('the settings save was recorded', Array.isArray(historyBody.body) && historyBody.body.length > 0);

/* ------------------------------------------------------------------ *
 * 10. Scanner intelligence
 * ------------------------------------------------------------------ */

step(10, 'Clean IP / scanner intelligence');

const scannerHistory = await call(`/${securePath}/panel/platform/scanner/history?kind=clean-ip`);
const scannerBody = await json(scannerHistory);
check('scanner history answers', scannerHistory.status === 200, `status ${scannerHistory.status}`);
check('it returns runs and an intelligence summary',
    Array.isArray(scannerBody.body?.runs) && 'intelligence' in (scannerBody.body ?? {}));

const schedule = await call(`/${securePath}/panel/platform/scanner/schedule?kind=clean-ip`);
const scheduleBody = await json(schedule);
check('the scan schedule answers', schedule.status === 200, `status ${schedule.status}`);
check('it says whether a scan is due', typeof scheduleBody.body?.due === 'boolean' ||
    typeof scheduleBody.body?.shouldRun === 'boolean' ||
    Object.keys(scheduleBody.body ?? {}).length > 1);

const scanGet = await call(`/${securePath}/panel/platform/scanner/run`);
check('the scan route rejects GET with 405', scanGet.status === 405, `status ${scanGet.status}`);

const scanEmpty = await call(`/${securePath}/panel/platform/scanner/run`, {
    method: 'POST',
    json: { kind: 'clean-ip', addresses: [] }
});
check('a scan with no addresses is rejected with 400', scanEmpty.status === 400, `status ${scanEmpty.status}`);

const scanBadKind = await call(`/${securePath}/panel/platform/scanner/run`, {
    method: 'POST',
    json: { kind: 'nonsense', addresses: ['203.0.113.1:443'] }
});
check('an unknown scan kind is rejected with 400', scanBadKind.status === 400, `status ${scanBadKind.status}`);

const scanReal = await call(`/${securePath}/panel/platform/scanner/run`, {
    method: 'POST',
    json: { kind: 'clean-ip', addresses: ['203.0.113.1:443'], attempts: 1 }
});
const scanRealBody = await json(scanReal);
// `cloudflare:sockets` is stubbed to throw here, so the honest expectation is a
// completed run whose single target failed, not a successful probe.
check('a scan request completes rather than throwing', scanReal.status === 200,
    `status ${scanReal.status}`);
check('the unreachable target is reported as dead, not as reachable',
    scanReal.status === 200 &&
    (scanRealBody.body?.dead?.length > 0 ||
     (scanRealBody.body?.ranked ?? []).every(entry => entry.verdict !== 'good')),
    JSON.stringify(scanRealBody.body ?? {}).slice(0, 160));

const lifecycle = await call(`/${securePath}/panel/platform/scanner/lifecycle`);
check('endpoint lifecycle answers', lifecycle.status === 200, `status ${lifecycle.status}`);

const effectiveness = await call(`/${securePath}/panel/platform/analytics/effectiveness`);
check('analytics effectiveness answers', effectiveness.status === 200, `status ${effectiveness.status}`);

/* ------------------------------------------------------------------ *
 * 11. Recommendations
 * ------------------------------------------------------------------ */

step(11, 'Recommendations');

const recommendations = await call(`/${securePath}/panel/platform/recommendations`);
const recommendationBody = await json(recommendations);
check('recommendations answer', recommendations.status === 200, `status ${recommendations.status}`);
check('the response is a list', Array.isArray(recommendationBody.body));
check('each recommendation explains itself',
    (recommendationBody.body ?? []).every(entry => typeof entry.title === 'string' || typeof entry.id === 'string'));

const outcome = await call(`/${securePath}/panel/platform/recommendations/outcome`, {
    method: 'POST',
    json: { outcome: 'dismissed' }
});
check('a recommendation outcome is recorded', outcome.status === 200, `status ${outcome.status}`);

const badOutcome = await call(`/${securePath}/panel/platform/recommendations/outcome`, {
    method: 'POST',
    json: { outcome: 'whatever' }
});
check('an unknown outcome is rejected with 400', badOutcome.status === 400, `status ${badOutcome.status}`);

const presets = await call(`/${securePath}/panel/platform/presets`);
const presetBody = await json(presets);
check('presets answer', presets.status === 200, `status ${presets.status}`);
check('at least one preset is offered', Array.isArray(presetBody.body) && presetBody.body.length > 0);

const firstPreset = presetBody.body?.[0]?.id;
if (firstPreset) {
    const preview = await call(`/${securePath}/panel/platform/presets/preview`, {
        method: 'POST',
        json: { id: firstPreset }
    });
    const previewBody = await json(preview);
    check('a preset preview answers', preview.status === 200, `status ${preview.status}`);
    check('the preview reports what would change', Array.isArray(previewBody.body?.changed));
    check('the preview did not write settings',
        JSON.parse(kv.store.get('proxySettings')).localDNS === '1.1.1.1');
}

const profiles = await call(`/${securePath}/panel/platform/profiles`);
check('optimization profiles answer', profiles.status === 200, `status ${profiles.status}`);

/* ------------------------------------------------------------------ *
 * 12. Backup and restore
 * ------------------------------------------------------------------ */

step(12, 'Backup, validate and restore plan');

const backup = await call(`/${securePath}/panel/platform/backup/export`);
const backupBody = await json(backup);
check('a backup exports', backup.status === 200, `status ${backup.status}`);
check('the envelope is versioned and checksummed',
    typeof backupBody.body?.format === 'number' &&
    typeof backupBody.body?.checksum === 'string' &&
    typeof backupBody.body?.panelVersion === 'string',
    `keys ${Object.keys(backupBody.body ?? {}).join(',')}`);
check('the envelope records what it redacted', Array.isArray(backupBody.body?.redactedKeys));

const serialized = JSON.stringify(backupBody.body ?? {});
check('the backup withholds the Trojan password', !serialized.includes(globalThis.EMBEDED_SETTINGS.trPass));
check('the backup withholds the panel path', !serialized.includes(securePath));
check('the backup withholds the VLESS UUID', !serialized.includes(vlUUID));

const validate = await call(`/${securePath}/panel/platform/backup/validate`, {
    method: 'POST',
    json: backupBody.body
});
const validateBody = await json(validate);
check('the exported backup validates', validate.status === 200, `status ${validate.status}`);
check('validation reports it as acceptable', validateBody.body?.ok === true,
    JSON.stringify(validateBody.body?.issues ?? []).slice(0, 160));

const plan = await call(`/${securePath}/panel/platform/backup/plan`, {
    method: 'POST',
    json: backupBody.body
});
const planBody = await json(plan);
check('a restore plan is produced', plan.status === 200, `status ${plan.status}`);
check('the plan is a preview, not a write', Array.isArray(planBody.body?.plan?.changes));
// Restoring the backup that was just exported must be a no-op: the envelope and the
// live settings are the same document. A non-empty change list here means something
// non-configuration leaked into the exported payload.
check('re-restoring a fresh export proposes no change',
    planBody.body?.plan?.changes?.length === 0 && planBody.body?.plan?.requiresConfirmation === false,
    JSON.stringify(planBody.body?.plan?.changes ?? []).slice(0, 200));
check('the plan refuses nothing and knows every key',
    (planBody.body?.plan?.refusedKeys ?? []).length === 0 &&
    (planBody.body?.plan?.unknownKeys ?? []).length === 0,
    `refused ${JSON.stringify(planBody.body?.plan?.refusedKeys)} unknown ${JSON.stringify(planBody.body?.plan?.unknownKeys)}`);

const garbage = await call(`/${securePath}/panel/platform/backup/plan`, {
    method: 'POST',
    json: { nonsense: true }
});
check('a malformed backup is refused', garbage.status === 400, `status ${garbage.status}`);

const compare = await call(`/${securePath}/panel/platform/config/compare`, {
    method: 'POST',
    json: { settings: JSON.parse(kv.store.get('proxySettings')) }
});
check('configuration comparison answers', compare.status === 200 || compare.status === 400,
    `status ${compare.status}`);

const configHistory = await call(`/${securePath}/panel/platform/config/history`);
check('configuration history answers', configHistory.status === 200, `status ${configHistory.status}`);

const migration = await call(`/${securePath}/panel/platform/migration/status`);
check('migration status answers', migration.status === 200, `status ${migration.status}`);

/* ------------------------------------------------------------------ *
 * 13. Authorisation boundary and logout
 * ------------------------------------------------------------------ */

step(13, 'Authorisation boundary and logout');

const savedCookie = cookie;
cookie = '';
const anonymousHealth = await call(`/${securePath}/panel/platform/health`);
check('platform routes reject an anonymous caller with 401', anonymousHealth.status === 401,
    `status ${anonymousHealth.status}`);
const anonymousSettings = await call(`/${securePath}/panel/settings`);
check('settings reject an anonymous caller with 401', anonymousSettings.status === 401,
    `status ${anonymousSettings.status}`);

cookie = 'jwtToken=not.a.real.token';
const forged = await call(`/${securePath}/panel/platform/health`);
check('a forged session token is rejected', forged.status === 401, `status ${forged.status}`);

cookie = savedCookie;
const logout = await call(`/${securePath}/panel/logout`);
check('logout succeeds', logout.status === 200, `status ${logout.status}`);
check('logout clears the cookie', (logout.headers.get('Set-Cookie') ?? '').includes('Max-Age=0'));

const unknown = await call('/some/unrelated/path');
const unknownText = await unknown.text();
// `fallback` in src/handlers/utils.ts proxies an upstream only when a fallback
// domain is configured, and returns a bare 404 otherwise. This artifact was
// packaged without one, so 404 is the correct behaviour; the property that matters
// either way is that the response carries no RayZen branding for a path scanner.
check('an unknown path answers without RayZen branding',
    (unknown.status === 404 || unknown.status === 200) && !unknownText.includes('RayZen'),
    `status ${unknown.status}`);
check('an unknown path serves no HTML panel shell', !unknownText.includes('data-rz-view'));

/* ------------------------------------------------------------------ *
 * Result
 * ------------------------------------------------------------------ */

globalThis.fetch = realFetch;

console.log(`\n${dim}Outbound fetch intercepted (no request left this process):${reset}`);
for (const [host, count] of [...intercepted].sort()) {
    console.log(`  ${dim}${host}  ×${count}${reset}`);
}

console.log(
    `\n${failed === 0 ? green : red}${passed} passed, ${failed} failed${reset}` +
    ` ${dim}of ${passed + failed} checks${reset}`
);

if (failed > 0) {
    console.log(`${yellow}Failing checks:${reset}`);
    for (const name of failures) console.log(`  - ${name}`);
    process.exit(1);
}

console.log(`${green}✔${reset} User flow verified against ${process.env.RAYZEN_ARTIFACT ?? 'dist/worker.deploy.js'}`);
