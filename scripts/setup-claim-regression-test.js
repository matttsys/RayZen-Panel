/**
 * Regression checks for the first-run setup claim response.
 *
 * Covers the production failure where an internal HTML error response was returned
 * as HTTP 200 and the setup page then misreported the JSON parse failure as a network
 * problem. Also verifies request-local URL data survives concurrent Worker requests.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const worker = (await import(join(root, 'dist/worker.js'))).default;
const PASSWORD = 'SetupFix1';
const EMAIL = 'owner@example.invalid';

let passed = 0;
function check(name, condition, detail = '') {
    if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
    passed++;
    console.log(`  ✔ ${name}`);
}

function createKv({ blockSecondPasswordRead = false, failPasswordWrite = false } = {}) {
    const store = new Map();
    let pwdReads = 0;
    let release;
    let markBlocked;
    const blocked = new Promise(resolve => { markBlocked = resolve; });
    const gate = new Promise(resolve => { release = resolve; });

    return {
        store,
        blocked,
        release,
        namespace: {
            async get(key, options) {
                if (key === 'pwd') {
                    pwdReads++;
                    if (blockSecondPasswordRead && pwdReads === 2) {
                        markBlocked();
                        await gate;
                    }
                }
                const raw = store.get(key);
                if (raw === undefined) return null;
                const type = typeof options === 'string' ? options : options?.type;
                return type === 'json' ? JSON.parse(raw) : raw;
            },
            async put(key, value) {
                if (failPasswordWrite && key === 'pwd') throw new Error('simulated KV password write failure');
                store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
            },
            async delete(key) { store.delete(key); },
            async list() { return { keys: [...store.keys()].map(name => ({ name })), list_complete: true, cacheStatus: null }; }
        }
    };
}

const envFor = kv => ({ CF_PAGES: '0', kv: kv.namespace });
const request = (host, path, json) => new Request(`https://${host}${path}`, {
    method: json === undefined ? 'GET' : 'POST',
    headers: json === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: json === undefined ? undefined : JSON.stringify(json)
});

console.log('\n1. Concurrent requests cannot corrupt the claim URL');
{
    const kv = createKv({ blockSecondPasswordRead: true });
    const env = envFor(kv);
    await worker.fetch(request('claim-host.example', '/'), env);

    const claimPromise = worker.fetch(request('claim-host.example', '/setup/claim', {
        email: EMAIL,
        password: PASSWORD
    }), env);
    await kv.blocked;

    const parallel = await worker.fetch(request('other-host.example', '/unrelated'), env);
    check('parallel request completes while claim is waiting', parallel instanceof Response);
    kv.release();

    const response = await claimPromise;
    const payload = await response.json();
    check('claim remains a JSON success', response.status === 200 && payload.success === true,
        `status=${response.status}`);
    check('panel URL uses the claim request origin',
        payload.body.panelUrl.startsWith('https://claim-host.example/'), payload.body.panelUrl);
    check('panel URL does not leak the concurrent request origin',
        !payload.body.panelUrl.includes('other-host.example'), payload.body.panelUrl);
}

console.log('\n2. Claim storage failures are structured and actionable');
{
    const kv = createKv({ failPasswordWrite: true });
    const env = envFor(kv);
    await worker.fetch(request('failure.example', '/'), env);
    const response = await worker.fetch(request('failure.example', '/setup/claim', {
        email: EMAIL,
        password: PASSWORD
    }), env);
    const contentType = response.headers.get('Content-Type') ?? '';
    const payload = await response.json();
    check('claim failure returns HTTP 500', response.status === 500, `status=${response.status}`);
    check('claim failure remains JSON', contentType.includes('application/json'), contentType);
    check('claim failure exposes the real server reason',
        payload.success === false && payload.message.includes('simulated KV password write failure'), payload.message);
}

console.log('\n3. Unhandled Worker exceptions are not reported as HTTP 200');
{
    const brokenKv = {
        async get() { throw new Error('simulated bootstrap failure'); },
        async put() {}, async delete() {}, async list() { return { keys: [], list_complete: true, cacheStatus: null }; }
    };
    const response = await worker.fetch(request('error.example', '/'), { CF_PAGES: '0', kv: brokenKv });
    const html = await response.text();
    check('error document returns HTTP 500', response.status === 500, `status=${response.status}`);
    check('error document remains HTML', (response.headers.get('Content-Type') ?? '').includes('text/html'));
    check('error document contains an actionable server error', html.includes('could not read its identity from KV'));
}

console.log(`\n✔ ${passed} setup-claim regression checks passed`);
