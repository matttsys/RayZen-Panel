/**
 * Regression coverage for Cloudflare Workers' PBKDF2 iteration ceiling.
 *
 * The test wraps WebCrypto so any request above 100,000 throws the same class of
 * failure seen on the edge. It then drives the shipped Worker artifact through:
 * fresh setup, plaintext migration, lower-cost PBKDF2 migration, current verifier
 * login, and recovery of an unsupported 120,000 verifier with an existing session.
 */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const artifact = join(root, process.env.RAYZEN_ARTIFACT ?? 'dist/worker.js');
if (!existsSync(artifact)) throw new Error(`${artifact} not found`);

const MAX_ITERATIONS = 100_000;
const EMAIL = 'owner@example.invalid';
const PASSWORD = 'ValidPass1';
const SECRET = 'a'.repeat(64);
const encoder = new TextEncoder();

const originalDeriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);
crypto.subtle.deriveBits = (algorithm, baseKey, length) => {
    if (algorithm?.name === 'PBKDF2' && Number(algorithm.iterations) > MAX_ITERATIONS) {
        throw new Error(`Pbkdf2 failed: iteration counts above ${MAX_ITERATIONS} are not supported`);
    }
    return originalDeriveBits(algorithm, baseKey, length);
};

let passed = 0;
function check(name, condition, detail = '') {
    if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
    passed++;
    console.log(`  ✔ ${name}`);
}

function createKv(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        store,
        namespace: {
            async get(key, options) {
                const raw = store.get(key);
                if (raw === undefined) return null;
                const type = typeof options === 'string' ? options : options?.type;
                return type === 'json' ? JSON.parse(raw) : raw;
            },
            async put(key, value) { store.set(key, typeof value === 'string' ? value : JSON.stringify(value)); },
            async delete(key) { store.delete(key); },
            async list() { return { keys: [...store.keys()].map(name => ({ name })), list_complete: true }; }
        }
    };
}

function base64Url(value) {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

async function makeVerifier(password, iterations) {
    const salt = new Uint8Array(16);
    salt.fill(7);
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256
    );
    return `pbkdf2-sha256$${iterations}$${base64Url(salt)}$${base64Url(new Uint8Array(bits))}`;
}

async function jwt(subject, secret) {
    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64Url(JSON.stringify({ id: subject, iat: now, exp: now + 3600 }));
    const signingInput = `${header}.${payload}`;
    const key = await crypto.subtle.importKey(
        'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput)));
    return `${signingInput}.${base64Url(signature)}`;
}

const identity = securePath => JSON.stringify({
    accEmail: EMAIL,
    securePath,
    vlUUID: '00000000-0000-4000-8000-000000000001',
    trPass: 'T'.repeat(32),
    proxyIpMode: 'proxyip',
    proxyIPs: [],
    prefixes: [],
    fallback: '',
    dohUrl: '',
    createdAt: '2026-08-06T00:00:00.000Z'
});

async function load(caseName, initial) {
    const worker = (await import(`${artifact}?pbkdf2=${caseName}`)).default;
    const kv = createKv(initial);
    const env = { CF_PAGES: '0', kv: kv.namespace };
    const call = (path, body, cookie = '') => worker.fetch(new Request(`https://rayzen-test.example${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(cookie ? { Cookie: cookie } : {})
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), env);
    return { kv, call };
}

console.log('\n1. Fresh deployment at the Workers PBKDF2 ceiling');
{
    const { kv, call } = await load('fresh', {});
    await call('/');
    const response = await call('/setup/claim', { email: EMAIL, password: PASSWORD });
    check('setup succeeds while >100,000 operations are rejected', response.status === 200, `status ${response.status}`);
    check('fresh setup stores exactly 100,000 iterations', (kv.store.get('pwd') ?? '').startsWith('pbkdf2-sha256$100000$'));
}

console.log('\n2. Existing password migration');
{
    const path = 'PlaintextMigration123456';
    const { kv, call } = await load('plaintext', {
        'rz:identity': identity(path), pwd: PASSWORD, secretKey: SECRET
    });
    const response = await call(`/${path}/login/authenticate`, { username: EMAIL, password: PASSWORD });
    check('legacy plaintext login succeeds', response.status === 200, `status ${response.status}`);
    check('legacy plaintext is rehashed to 100,000', (kv.store.get('pwd') ?? '').startsWith('pbkdf2-sha256$100000$'));
}

{
    const path = 'LowerCostMigration12345';
    const lower = await makeVerifier(PASSWORD, 10_000);
    const { kv, call } = await load('lower', {
        'rz:identity': identity(path), pwd: lower, secretKey: SECRET
    });
    const response = await call(`/${path}/login/authenticate`, { username: EMAIL, password: PASSWORD });
    check('lower-cost PBKDF2 login succeeds', response.status === 200, `status ${response.status}`);
    check('lower-cost PBKDF2 is upgraded to 100,000', (kv.store.get('pwd') ?? '').startsWith('pbkdf2-sha256$100000$'));
}

{
    const path = 'CurrentCostVerifier12345';
    const current = await makeVerifier(PASSWORD, 100_000);
    const { kv, call } = await load('current', {
        'rz:identity': identity(path), pwd: current, secretKey: SECRET
    });
    const response = await call(`/${path}/login/authenticate`, { username: EMAIL, password: PASSWORD });
    check('current 100,000 verifier login succeeds', response.status === 200, `status ${response.status}`);
    check('current verifier is not rewritten', kv.store.get('pwd') === current);
}

console.log('\n3. Unsupported historical verifier recovery');
{
    const path = 'UnsupportedVerifier1234';
    const unsupported = `pbkdf2-sha256$120000$${'A'.repeat(22)}$${'A'.repeat(43)}`;
    const { kv, call } = await load('unsupported', {
        'rz:identity': identity(path), pwd: unsupported, secretKey: SECRET
    });
    const login = await call(`/${path}/login/authenticate`, { username: EMAIL, password: PASSWORD });
    const payload = await login.json();
    check('unsupported verifier returns an explicit conflict', login.status === 409, `status ${login.status}`);
    check('recovery response names the PBKDF2 limit', String(payload.message).includes('PBKDF2 limit'));
    check('unsupported verifier is not silently overwritten', kv.store.get('pwd') === unsupported);

    const token = await jwt(EMAIL, SECRET);
    const reset = await call(`/${path}/panel/reset-password`, { password: 'RecoveredPass1' }, `jwtToken=${token}`);
    check('an existing signed-in session can rotate the password', reset.status === 200, `status ${reset.status}`);
    check('session recovery writes a 100,000 verifier', (kv.store.get('pwd') ?? '').startsWith('pbkdf2-sha256$100000$'));

    const relogin = await call(`/${path}/login/authenticate`, { username: EMAIL, password: 'RecoveredPass1' });
    check('the recovered password signs in normally', relogin.status === 200, `status ${relogin.status}`);
}

console.log(`\n✔ ${passed} PBKDF2 compatibility and migration checks passed`);
