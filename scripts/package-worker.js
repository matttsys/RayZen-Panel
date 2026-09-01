/**
 * Packages the built Worker into a self-contained artifact with its identity baked in.
 *
 * When you need this
 *
 * Most people do not. A deployment made with the Deploy to Cloudflare button, or by a
 * plain `wrangler deploy`, resolves its identity at runtime and stores it in KV
 * (src/settings/identity.ts). `dist/worker.js` is directly deployable.
 *
 * This script exists for the cases where runtime resolution is the wrong shape:
 *
 *   - Reproducing an existing deployment's exact identity, for a migration or a
 *     rollback, without touching its KV.
 *   - Deploying an air-gapped copy where the first-run setup page cannot be reached.
 *   - Pinning an identity in CI so an automated deploy needs no interactive step.
 *
 * What it does
 *
 * It prepends `Object.assign(globalThis, { EMBEDED_SETTINGS: {...} })` to the bundle,
 * in the same shape `buildScript` (src/settings/main.ts) produces for a self-redeploy,
 * and writes `dist/worker.deploy.js`. It does not modify the bundle itself, so
 * `dist/worker.js` keeps its exact contract: the panel's self-update path reads
 * `SOURCE_CONTENT` out of it.
 *
 * A deployment carrying this block reads it instead of KV, so the panel's settings
 * writes then require a redeploy. Cloudflare API access remains environment-only: bind
 * `RAYZEN_CF_API_TOKEN` with `wrangler secret put`; it is never embedded in this file.
 *
 * USAGE
 *
 *   npm run build
 *   RAYZEN_MAIN_DOMAIN=my-panel.example.workers.dev \
 *   RAYZEN_ACC_EMAIL=me@example.com \
 *   npm run package
 *
 * Everything else is optional and generated when absent. Generated credentials are
 * printed once, because they cannot be recovered from the artifact afterwards without
 * reading it.
 *
 * Recognised variables:
 *
 *   RAYZEN_MAIN_DOMAIN  required. The hostname the Worker answers on. Subscription
 *                       links and generated configs use it, so a wrong value produces
 *                       configs that point at the wrong host.
 *   RAYZEN_ACC_EMAIL    required. The panel login username.
 *   RAYZEN_CF_ACCOUNT_ID Cloudflare account id. Needed for usage stats, self-update
 *                       and custom-domain setup.
 *   RAYZEN_CF_API_TOKEN is intentionally ignored here. Bind it after deployment with
 *                       `wrangler secret put RAYZEN_CF_API_TOKEN`.
 *   RAYZEN_SECURE_PATH  panel/subscription path prefix. Generated when absent.
 *   RAYZEN_VL_UUID      VLESS UUID. Generated when absent.
 *   RAYZEN_TR_PASS      Trojan password. Generated when absent.
 *   RAYZEN_PROXY_IPS    comma-separated proxy IPs or domains.
 *   RAYZEN_PREFIXES     comma-separated NAT64 prefixes, each in [IPv6] form.
 *   RAYZEN_FALLBACK     fallback domain for unmatched paths.
 *   RAYZEN_DOH_URL      upstream DoH endpoint.
 *   RAYZEN_PROXY_IP_MODE  'proxyip' (default) or 'nat64'.
 *   RAYZEN_PAD          '1' to add the signature-resistance padding that a
 *                       self-deploy adds. Off by default so the artifact is
 *                       reproducible.
 *   RAYZEN_OUT          output path. Defaults to dist/worker.deploy.js.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const green = '\x1b[32m';
const yellow = '\x1b[33m';
const red = '\x1b[31m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';

const BUILD = join(root, 'dist', 'worker.js');
const OUT = process.env.RAYZEN_OUT
    ? join(root, process.env.RAYZEN_OUT)
    : join(root, 'dist', 'worker.deploy.js');

/**
 * The charset `validatePath` and `validateTrPass` accept
 * (`src/settings/validators.ts`), narrowed to the alphanumeric subset so nothing needs
 * URL-escaping in a subscription link.
 */
const SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomToken(length) {
    const bytes = randomBytes(length);
    let out = '';
    for (const byte of bytes) out += SAFE[byte % SAFE.length];
    return out;
}

function list(value) {
    if (!value) return [];
    return value.split(',').map(entry => entry.trim()).filter(Boolean);
}

function fail(message) {
    console.error(`${red}✗${reset} ${message}`);
    process.exit(1);
}

if (!existsSync(BUILD)) {
    fail('dist/worker.js not found. Run `npm run build` first.');
}

const bundle = readFileSync(BUILD, 'utf8');

// The release bundle is identified by its own prelude. Packaging something else, such
// as an already-packaged file, would produce a script with two conflicting identity
// blocks where the later one silently wins.
const PRELUDE = 'Object.assign(globalThis, {"SOURCE_CONTENT"';
if (!bundle.startsWith(PRELUDE)) {
    fail(
        'dist/worker.js does not look like a `npm run build` artifact ' +
        '(no SOURCE_CONTENT prelude). Rebuild before packaging.'
    );
}

/**
 * The prelude keys, read by scanning to the matching brace.
 *
 * A substring search for `EMBEDED_SETTINGS` would be wrong: the bundled source
 * contains that identifier because the panel builds the block for its own self-update.
 * Only the prelude's own keys say whether the file is packaged.
 */
function preludeKeys(text) {
    const start = text.indexOf('{');
    let depth = 0;
    let inString = false;

    for (let i = start; i < text.length; i++) {
        const character = text[i];
        if (inString) {
            if (character === '\\') i++;
            else if (character === '"') inString = false;
            continue;
        }
        if (character === '"') { inString = true; continue; }
        if (character === '{') depth++;
        else if (character === '}' && --depth === 0) {
            return Object.keys(JSON.parse(text.slice(start, i + 1)));
        }
    }

    fail('dist/worker.js prelude is not a complete object. Rebuild before packaging.');
}

if (preludeKeys(bundle).includes('EMBEDED_SETTINGS')) {
    fail('dist/worker.js already carries EMBEDED_SETTINGS. It is already packaged.');
}

const mainDomain = (process.env.RAYZEN_MAIN_DOMAIN ?? '').trim().replace(/^https?:\/\//u, '').replace(/\/.*$/u, '');
const accEmail = (process.env.RAYZEN_ACC_EMAIL ?? '').trim();

if (!mainDomain) {
    fail(
        'RAYZEN_MAIN_DOMAIN is required. It is the hostname the Worker answers on, ' +
        'for example rayzen-edge.example.workers.dev. Generated subscription links and ' +
        'configs are built from it.\n' +
        '  To deploy without pinning a hostname, skip packaging: deploy dist/worker.js ' +
        'and let the panel resolve its own identity on first run.'
    );
}
if (!accEmail) {
    fail('RAYZEN_ACC_EMAIL is required. It is the panel login username.');
}

const generated = [];
const take = (variable, generate) => {
    const supplied = (process.env[variable] ?? '').trim();
    if (supplied) return supplied;
    const value = generate();
    generated.push([variable, value]);
    return value;
};

const securePath = take('RAYZEN_SECURE_PATH', () => randomToken(24));
const vlUUID = take('RAYZEN_VL_UUID', () => randomUUID());
const trPass = take('RAYZEN_TR_PASS', () => randomToken(32));

/**
 * The identity block, field for field as `buildScript` assembles it
 * (`src/settings/main.ts`). Order is irrelevant to the runtime but is kept identical
 * so the two are diffable.
 *
 * `proxyIPs` and `prefixes` are left empty when unset rather than filled in here: the
 * runtime substitutes its own documented defaults for an empty array, and duplicating
 * those defaults in a second place is how they drift apart.
 */
const embededSettings = {
    accID: (process.env.RAYZEN_CF_ACCOUNT_ID ?? '').trim(),
    accEmail: accEmail.toLowerCase(),
    vlUUID,
    trPass,
    securePath,
    proxyIpMode: (process.env.RAYZEN_PROXY_IP_MODE ?? 'proxyip').trim(),
    proxyIPs: list(process.env.RAYZEN_PROXY_IPS),
    prefixes: list(process.env.RAYZEN_PREFIXES),
    fallback: (process.env.RAYZEN_FALLBACK ?? '').trim(),
    dohUrl: (process.env.RAYZEN_DOH_URL ?? '').trim(),
    mainDomain
};

/** Mirrors the padding a self-deploy adds. Opt-in; see the header. */
function padCode() {
    const count = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const vars = Array.from({ length: count(50, 500) }, (_, i) =>
        `let __padd_${randomToken(8)}_${i} = ${count(0, 99999)};`
    ).join('\n');
    const funcs = Array.from({ length: count(50, 500) }, (_, i) =>
        `function __paddFunc_${randomToken(8)}_${i}() { return ${count(0, 999)}; }`
    ).join('\n');
    return `${vars}\n${funcs}\n`;
}

const padding = process.env.RAYZEN_PAD === '1' ? padCode() : '';
const artifact = [
    `// RayZen Panel deployable artifact`,
    `// Packaged: ${new Date().toISOString()}`,
    '// @ts-nocheck',
    `${padding}Object.assign(globalThis, ${JSON.stringify({ EMBEDED_SETTINGS: embededSettings })});`,
    bundle
].join('\n');

writeFileSync(OUT, artifact, 'utf8');

const bytes = Buffer.byteLength(artifact);
const out = relative(root, OUT);

console.log(`${green}✔${reset} Packaged ${out}  ${bytes} B`);
console.log(`  panel        https://${mainDomain}/${securePath}/panel`);
console.log(`  login        https://${mainDomain}/${securePath}/login`);
console.log(`  username     ${embededSettings.accEmail}`);
console.log(`  deploy       npx wrangler deploy ${out}`);

if (!embededSettings.accID) {
    console.log(
        `${yellow}!${reset} No Cloudflare account id supplied. The application runs, but account-level ` +
        'usage, self-redeploy and custom-domain actions will remain unavailable.'
    );
}

console.log(
    `${dim}  Cloudflare API tokens are never packaged. For optional account actions, run:\n` +
    `  npx wrangler secret put RAYZEN_CF_API_TOKEN${reset}`
);

if (generated.length > 0) {
    console.log(`${yellow}!${reset} Generated values, shown once. Store them now:`);
    for (const [variable, value] of generated) console.log(`    ${variable}=${value}`);
}

console.log(
    `${dim}  This file contains connection credentials and the administrator email. Do not commit it or publish it.\n` +
    `  Bind a KV namespace to the variable name \`kv\` before the panel can save.${reset}`
);
