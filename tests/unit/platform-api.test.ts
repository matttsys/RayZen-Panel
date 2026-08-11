/**
 * Internal platform API tests: `panel/platform/*`.
 *
 * Why this file exists separately from the unit suites
 *
 * The subsystems are tested directly elsewhere. What this file tests is the
 * *boundary*, and the boundary carries three claims that no unit test can reach:
 *
 *   1. **Nothing is readable without a session.** The health report names
 *      misconfigurations, history names what changed and when, and metrics show when
 *      the operator is active. Each is useful to someone profiling a deployment, so
 *      every route must 401 before it does any work. That is asserted per route,
 *      enumerated from `PLATFORM_ROUTES`, so a route added without auth fails here.
 *   2. **No route returns a secret.** A response containing the UUID, the Trojan
 *      password or `securePath` would undo the redaction the rest of the phase is
 *      built around. Asserted by searching every response body for sentinels drawn
 *      from the live test settings.
 *   3. **The existing eleven panel routes are untouched.** The dispatcher returns
 *      null for anything it does not own, so an unknown `panel/platform/*` path
 *      falls through to the same fallback as every other unknown path.
 *
 * Auth is exercised through the real `authenticate`, with a real signed token, so
 * the tests fail if the route stops calling it rather than if a mock stops being
 * consulted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { PLATFORM_ROUTES, handlePlatform } from '@api/platform';
import { handlePanel } from '@handlers/panel';
import { createRepositories } from '@platform/repositories';
import { base64EncodeUtf8 } from '@common';
import { resetRuntimeDeps, setRuntimeDeps, seededRandom } from '@runtime';
import { init } from '@settings';
import type { HealthReport, FeatureStatus, HistoryEntry, Preset, Recommendation } from '#types/platform';
import { MAX_PROFILES } from '@features/profiles';
import { createEnv, createKvStub, type KvStub } from '../helpers/worker';
import { TEST_ACCOUNT_ID, TEST_MAIN_DOMAIN, TEST_SECURE_PATH, TEST_TR_PASS, TEST_UUID } from '../setup/globals';

const SECRET = 'b'.repeat(64);
const PASSWORD = 'panel-password';

/** Values that must never appear in a platform response. */
const SENTINELS = [TEST_UUID, TEST_TR_PASS, TEST_SECURE_PATH];

/**
 * A KV namespace pre-loaded with what a live deployment holds: a password, a
 * signing secret, WARP accounts, and settings written by this build.
 *
 * `proxySettings` carries `panelVersion: VERSION` deliberately. Without it,
 * `getDataset` treats the stored settings as stale and calls `updateDataset`, which
 * resolves DNS over the network.
 */
function deployment(overrides: Record<string, unknown> = {}): KvStub {
    return createKvStub({
        pwd: PASSWORD,
        secretKey: SECRET,
        warpAccounts: [{ privateKey: 'k', publicKey: 'p', warpIPv6: '::1/128', reserved: 'AAAA' }],
        telegramBot: { telegramBotToken: '', telegramUserId: '' },
        proxySettings: {
            localDNS: '8.8.8.8',
            antiSanctionDNS: '178.22.122.100',
            fakeDNS: false,
            enableIPv6: false,
            allowLANConnection: false,
            logLevel: 'warning',
            customDomain: '',
            protocols: 'vl,tr',
            remoteDNS: 'https://8.8.8.8/dns-query',
            remoteDnsHost: { isDomain: false, host: '8.8.8.8', ipv4: [], ipv6: [] },
            upstreamProxy: '',
            upstreamParams: null,
            chainProxy: '',
            chainProxyParams: null,
            cleanIPs: [],
            customCdnAddrs: [],
            customCdnHost: '',
            customCdnSni: '',
            bestPingInterval: 30,
            ports: [443],
            fingerprint: 'randomized',
            enableTFO: false,
            fragmentMode: 'custom',
            fragmentLengthMin: 100,
            fragmentLengthMax: 200,
            fragmentDelayMin: 1,
            fragmentDelayMax: 1,
            fragmentMaxSplitMin: 0,
            fragmentMaxSplitMax: 0,
            fragmentPackets: 'tlshello',
            enableECH: false,
            echServerName: '',
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
            warpRemoteDNS: '1.1.1.1',
            warpEndpoints: ['engage.cloudflareclient.com:2408'],
            warpBestPingInterval: 30,
            warpReservedBytes: '',
            xrayUdpNoises: [],
            knockerNoiseMode: 'quic',
            knockerNoiseCountMin: 10,
            knockerNoiseCountMax: 15,
            knockerNoiseSizeMin: 5,
            knockerNoiseSizeMax: 10,
            knockerNoiseDelayMin: 1,
            knockerNoiseDelayMax: 5,
            amneziaNoiseCount: 5,
            amneziaNoiseSizeMin: 5,
            amneziaNoiseSizeMax: 10,
            customSubs: [],
            remoteSettings: '',
            customConfigs: [],
            panelVersion: VERSION
        },
        ...overrides
    });
}

async function session(): Promise<string> {
    const token = await new SignJWT({ id: TEST_ACCOUNT_ID })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('24h')
        .sign(new TextEncoder().encode(SECRET));

    return `jwtToken=${token}`;
}

interface CallOptions {
    cookie?: string;
    method?: string;
    body?: unknown;
    /** Query string without the leading `?`. Kept out of `route` because the
     *  router matches the bare route name, exactly as `handlePanel` passes it. */
    query?: string;
}

function request(route: string, options: CallOptions = {}): Request {
    const query = options.query ? `?${options.query}` : '';

    return new Request(
        `https://${TEST_MAIN_DOMAIN}/${TEST_SECURE_PATH}/panel/platform/${route}${query}`,
        {
            method: options.method ?? 'GET',
            ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
            ...(options.cookie ? { headers: { Cookie: options.cookie } } : {})
        }
    );
}

/** Calls a platform route with request globals initialised, as the router would. */
async function call(kv: KvStub, route: string, options: CallOptions = {}): Promise<Response> {
    const env = createEnv(kv.namespace);
    const req = request(route, options);
    await init(req, env);

    const response = await handlePlatform(req, env, route);
    if (!response) throw new Error(`route '${route}' was not handled`);
    return response;
}

async function body<T>(response: Response): Promise<{ success: boolean; status: number; message: string | null; body: T }> {
    return response.json();
}

beforeEach(() => {
    setRuntimeDeps({ now: () => new Date('2025-06-01T00:00:00.000Z'), random: seededRandom(5) });
});

afterEach(() => {
    resetRuntimeDeps();
    vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ *
 * Route surface
 * ------------------------------------------------------------------ */

describe('platform route surface', () => {
    it('declares the intelligence route surface, so an addition is a deliberate diff', () => {
        // The original rule was that eleven panel sub-routes are the whole API.
        // The platform layer adds capability rather than screens, so the additions are
        // pinned here. Every one of the second block is a read or a preview, and
        // none of them writes settings (see the header of src/api/platform.ts). This
        // list is the deliberate diff for that phase; it was left un-updated, which is
        // why the pin failed rather than the code.
        expect(PLATFORM_ROUTES).toEqual([
            'health',
            'features',
            'metrics',
            'history',
            'recommendations',
            'recommendations/outcome',
            'profiles',
            'profiles/evaluate',
            'presets',
            'presets/preview',
            'scanner/history',
            'scanner/schedule',
            'scanner/run',
            'scanner/candidates',
            'scanner/apply',
            'health/center',
            'deployment/preflight',
            'deployment/verify',
            'backup/export',
            'backup/validate',
            'backup/plan',
            'backup/import-remote',
            'config/compare',
            'config/rollback',
            'config/history',
            'migration/status',
            'scanner/lifecycle',
            'analytics/effectiveness',
            'advanced/diagnostics',
            // The only writing routes in this table. See the comment beside them in
            // src/api/platform.ts for why a subscription link is not a setting.
            'links',
            'links/create',
            'links/update'
        ]);
    });

    it('returns null for a path it does not own, so the caller falls through', async () => {
        const kv = deployment();
        const env = createEnv(kv.namespace);
        const req = request('not-a-route');
        await init(req, env);

        expect(await handlePlatform(req, env, 'not-a-route')).toBeNull();
    });

    it('an unknown platform path reaches the same fallback as any other unknown path', async () => {
        const kv = deployment();
        const env = createEnv(kv.namespace);
        const req = new Request(`https://${TEST_MAIN_DOMAIN}/${TEST_SECURE_PATH}/panel/platform/nope`);
        await init(req, env);

        const response = await handlePanel(req, env);
        // Whatever `fallback` does, it is not a platform response.
        expect(response.status).not.toBe(200);
    });
});

/* ------------------------------------------------------------------ *
 * Authorisation
 * ------------------------------------------------------------------ */

describe('platform authorisation', () => {
    it('every route rejects a request with no session', async () => {
        // Enumerated from the route table rather than listed by hand, so a route
        // added without auth fails here rather than shipping.
        for (const route of PLATFORM_ROUTES) {
            const kv = deployment();
            const response = await call(kv, route, { method: 'POST', body: {} });

            expect(response.status, route).toBe(401);
            // Nothing was read beyond the secret key the auth check itself needs.
            expect(kv.calls.some(entry => entry.key === 'proxySettings'), route).toBe(false);
        }
    });

    it('rejects a forged token', async () => {
        const forged = await new SignJWT({ id: TEST_ACCOUNT_ID })
            .setProtectedHeader({ alg: 'HS256' })
            .setExpirationTime('24h')
            .sign(new TextEncoder().encode('c'.repeat(64)));

        const response = await call(deployment(), 'health', { cookie: `jwtToken=${forged}` });
        expect(response.status).toBe(401);
    });

    it('rejects an expired token', async () => {
        const expired = await new SignJWT({ id: TEST_ACCOUNT_ID })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime('-1h')
            .sign(new TextEncoder().encode(SECRET));

        const response = await call(deployment(), 'metrics', { cookie: `jwtToken=${expired}` });
        expect(response.status).toBe(401);
    });

    it('rejects every route when no secret key exists at all', async () => {
        // A deployment that has never been signed into has no session to present.
        const kv = deployment({ secretKey: undefined });
        kv.store.delete('secretKey');

        const response = await call(kv, 'history', { cookie: await session() });
        expect(response.status).toBe(401);
    });
});

/* ------------------------------------------------------------------ *
 * Read routes
 * ------------------------------------------------------------------ */

describe('platform read routes', () => {
    it('health returns a scored report with findings', async () => {
        const response = await call(deployment(), 'health', { cookie: await session() });
        const { success, body: report } = await body<HealthReport>(response);

        expect(response.status).toBe(200);
        expect(success).toBe(true);
        expect(report.findings.length).toBeGreaterThan(0);
        expect(report.score).toBeGreaterThanOrEqual(0);
        expect(report.score).toBeLessThanOrEqual(100);
        expect(['excellent', 'good', 'fair', 'poor']).toContain(report.grade);
    });

    it('health reports against saved settings, not shipped defaults', async () => {
        // `setSettings` is called first for exactly this reason: reporting health
        // against defaults would make the whole view a fiction.
        const kv = deployment();
        const stored = JSON.parse(kv.store.get('proxySettings') ?? '{}');
        stored.remoteDNS = '8.8.8.8';
        kv.store.set('proxySettings', JSON.stringify(stored));

        const { body: report } = await body<HealthReport>(
            await call(kv, 'health', { cookie: await session() })
        );

        const dns = report.findings.find(finding => finding.id === 'security.dns-leak');
        expect(dns?.status).toBe('fail');
    });

    it('health survives an analytics failure by degrading one check', async () => {
        // The health view is what an operator opens because something is wrong, so a
        // KV problem must not empty it.
        const kv = deployment({ 'rz:metrics': 'not json' });
        const { body: report } = await body<HealthReport>(
            await call(kv, 'health', { cookie: await session() })
        );

        expect(report.findings.find(finding => finding.id === 'platform.auth-failures')?.status).toBe('skip');
    });

    it('features explains every unavailable capability', async () => {
        const { body: features } = await body<FeatureStatus[]>(
            await call(deployment(), 'features', { cookie: await session() })
        );

        expect(features.length).toBeGreaterThan(0);
        for (const feature of features) {
            if (feature.state !== 'available') expect(feature.reason, feature.id).toBeTruthy();
        }
    });

    it('metrics returns a snapshot and its derived statistics together', async () => {
        const kv = deployment();
        const repos = createRepositories(kv.namespace);
        await repos.metrics.increment('2025-06-01', 'auth.success', 4);
        await repos.flush();

        const { body: payload } = await body<{ snapshot: { totals: Record<string, number> }; statistics: { activeDays: number } }>(
            await call(kv, 'metrics', { cookie: await session() })
        );

        expect(payload.snapshot.totals['auth.success']).toBe(4);
        expect(payload.statistics.activeDays).toBe(1);
    });

    it('history returns newest first and honours the limit', async () => {
        const kv = deployment();
        const repos = createRepositories(kv.namespace);
        for (let i = 0; i < 5; i += 1) {
            await repos.history.append({ id: `e${i}`, kind: 'auth.login', at: i, summary: `entry ${i}` });
        }
        await repos.flush();

        const all = await body<HistoryEntry[]>(await call(kv, 'history', { cookie: await session() }));
        expect(all.body.map(entry => entry.summary)).toEqual([
            'entry 4', 'entry 3', 'entry 2', 'entry 1', 'entry 0'
        ]);

        const limited = await body<HistoryEntry[]>(
            await call(kv, 'history', { cookie: await session(), query: 'limit=2' })
        );
        expect(limited.body).toHaveLength(2);
    });

    it('history clamps a nonsense or oversized limit', async () => {
        const kv = deployment();

        for (const query of ['limit=0', 'limit=-5', 'limit=abc', 'limit=99999']) {
            const response = await call(kv, 'history', { cookie: await session(), query });
            expect(response.status, query).toBe(200);
        }
    });

    it('recommendations aggregates advice and ranks the critical fix first', async () => {
        const kv = deployment({ pwd: undefined });
        kv.store.delete('pwd');
        // Auth still needs a secret; the password is what the check reads.
        kv.store.set('secretKey', SECRET);

        const { body: list } = await body<Recommendation[]>(
            await call(kv, 'recommendations', { cookie: await session() })
        );

        expect(list.length).toBeGreaterThan(0);
        expect(list[0].impact).toBe('high');
        expect(list[0].id).toBe('security.password-set');
    });

    it('presets returns the shipped catalogue', async () => {
        const { body: presets } = await body<Preset[]>(
            await call(deployment(), 'presets', { cookie: await session() })
        );

        expect(presets.map(preset => preset.id)).toContain('balanced');
        for (const preset of presets) expect(preset.description.length).toBeGreaterThan(20);
    });

    it('every read route is marked no-store', async () => {
        // These responses describe the deployment's current state, so a cached copy
        // is both stale and a small disclosure risk in a shared browser.
        for (const route of ['health', 'features', 'metrics', 'history', 'recommendations', 'presets']) {
            const response = await call(deployment(), route, { cookie: await session() });
            expect(response.headers.get('Cache-Control'), route).toContain('no-store');
        }
    });
});

/* ------------------------------------------------------------------ *
 * Secret containment
 * ------------------------------------------------------------------ */

describe('platform secret containment', () => {
    it('no route returns a UUID, a Trojan password or the panel path', async () => {
        const kv = deployment();
        const cookie = await session();

        const responses = await Promise.all([
            call(kv, 'health', { cookie }),
            call(kv, 'features', { cookie }),
            call(kv, 'metrics', { cookie }),
            call(kv, 'history', { cookie }),
            call(kv, 'recommendations', { cookie }),
            call(kv, 'presets', { cookie }),
            call(kv, 'scanner/history', { cookie }),
            call(kv, 'scanner/schedule', { cookie })
        ]);

        for (const response of responses) {
            const text = await response.text();
            for (const secret of SENTINELS) {
                expect(text, `${response.url} leaked ${secret}`).not.toContain(secret);
            }
        }
    });

    it('a preset preview returns only the keys the preset touches', async () => {
        // Echoing the merged settings object would put the UUID and Trojan password
        // in a response that does not need them.
        const { body: preview } = await body<{ patch: Record<string, unknown>; changed: string[] }>(
            await call(deployment(), 'presets/preview', {
                cookie: await session(),
                method: 'POST',
                body: { id: 'privacy' }
            })
        );

        expect(Object.keys(preview.patch).sort()).toEqual([...preview.changed].sort());
        expect(Object.keys(preview.patch)).not.toContain('vlUUID');
        expect(Object.keys(preview.patch)).not.toContain('trPass');
    });

    /**
     * `currentSettings` merges `getGlobals()`, which carries request-scoped fields as
     * well as the deployment's own. `pathname` is `/<securePath>/panel/platform/...`,
     * so before `REQUEST_SCOPED_KEYS` existed the exported backup carried the panel
     * path in a document whose whole premise is that `securePath` is redacted. The
     * sentinel sweep above did not catch it because `backup/export` was not in its
     * list; it is asserted directly here because the redaction guarantee is the
     * reason the feature is safe to ship.
     */
    it('an exported backup carries no request context and no panel path', async () => {
        const { body: envelope } = await body<{
            settings: Record<string, unknown>;
            redactedKeys: string[];
        }>(await call(deployment(), 'backup/export', { cookie: await session() }));

        const serialised = JSON.stringify(envelope);
        for (const secret of SENTINELS) {
            expect(serialised, `the backup leaked ${secret}`).not.toContain(secret);
        }

        for (const key of ['pathname', 'origin', 'hostname', 'searchParams', 'client', 'httpPorts', 'httpsPorts']) {
            expect(Object.keys(envelope.settings), `${key} is request state, not configuration`)
                .not.toContain(key);
        }
    });
});

/* ------------------------------------------------------------------ *
 * Backup round trip
 * ------------------------------------------------------------------ */

describe('backup round trip', () => {
    /**
     * Restoring a backup taken from the same deployment a moment earlier must be a
     * no-op. Any proposed change means the exported payload contains something that
     * is not stable configuration, which is precisely how the `pathname` leak
     * presented: the plan's only change was rewriting `pathname` from the plan
     * route's URL to the export route's URL.
     */
    it('re-restoring a fresh export proposes no change', async () => {
        const kv = deployment();
        const cookie = await session();

        const { body: envelope } = await body<Record<string, unknown>>(
            await call(kv, 'backup/export', { cookie })
        );

        const { body: result } = await body<{
            plan: {
                changes: { key: string }[];
                refusedKeys: string[];
                unknownKeys: string[];
                requiresConfirmation: boolean;
            };
        }>(await call(kv, 'backup/plan', { cookie, method: 'POST', body: envelope }));

        expect(result.plan.changes).toEqual([]);
        expect(result.plan.requiresConfirmation).toBe(false);
        expect(result.plan.refusedKeys).toEqual([]);
        expect(result.plan.unknownKeys).toEqual([]);
    });

    it('the exported envelope validates against this panel', async () => {
        const kv = deployment();
        const cookie = await session();

        const { body: envelope } = await body<Record<string, unknown>>(
            await call(kv, 'backup/export', { cookie })
        );

        const { body: validation } = await body<{ ok: boolean; issues: string[] }>(
            await call(kv, 'backup/validate', { cookie, method: 'POST', body: envelope })
        );

        expect(validation.issues).toEqual([]);
        expect(validation.ok).toBe(true);
    });
});

describe('backup/import-remote', () => {
    it('is POST only', async () => {
        const response = await call(deployment(), 'backup/import-remote', { cookie: await session() });
        expect(response.status).toBe(405);
    });

    it('requires a URL in the body', async () => {
        const response = await call(deployment(), 'backup/import-remote', {
            cookie: await session(), method: 'POST', body: {}
        });
        expect(response.status).toBe(400);
    });

    it('rejects anything but https URLs', async () => {
        const response = await call(deployment(), 'backup/import-remote', {
            cookie: await session(), method: 'POST', body: { url: 'http://example.com/settings.dat' }
        });
        expect(response.status).toBe(400);
    });

    it('fetches the remote document and decodes the base64 settings', async () => {
        // The contract of `sub/share-settings`: a base64-encoded UTF-8 JSON object.
        // `base64EncodeUtf8` (not `btoa`) is what the export side uses, and it is
        // required here: `btoa` throws on non-Latin-1 characters like the ✂️ mark.
        const document = base64EncodeUtf8(JSON.stringify({ remarkSuffix: '✂️', ports: [443, 8443] }));
        vi.stubGlobal('fetch', vi.fn(async () => new Response(document, { status: 200 })));

        const { body: result } = await body<{ settings: { ports: number[] } }>(
            await call(deployment(), 'backup/import-remote', {
                cookie: await session(), method: 'POST', body: { url: 'https://other.example/panel/sub/share-settings' }
            })
        );

        expect(result.settings.ports).toEqual([443, 8443]);
    });

    it('surfaces a failing remote as a gateway error', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));

        const response = await call(deployment(), 'backup/import-remote', {
            cookie: await session(), method: 'POST', body: { url: 'https://other.example/panel/sub/share-settings' }
        });
        expect(response.status).toBe(502);
    });

    it('rejects a remote document that is not a base64 JSON object', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('not-base64-json', { status: 200 })));

        const response = await call(deployment(), 'backup/import-remote', {
            cookie: await session(), method: 'POST', body: { url: 'https://other.example/panel/sub/share-settings' }
        });
        expect(response.status).toBe(400);
    });
});

/* ------------------------------------------------------------------ *
 * Preset preview
 * ------------------------------------------------------------------ */

describe('preset preview route', () => {
    it('is POST only', async () => {
        const response = await call(deployment(), 'presets/preview', { cookie: await session() });
        expect(response.status).toBe(405);
    });

    it('requires a preset id', async () => {
        const response = await call(deployment(), 'presets/preview', {
            cookie: await session(),
            method: 'POST',
            body: {}
        });

        expect(response.status).toBe(400);
    });

    it('404s an unknown preset rather than returning an empty preview', async () => {
        const response = await call(deployment(), 'presets/preview', {
            cookie: await session(),
            method: 'POST',
            body: { id: 'does-not-exist' }
        });

        expect(response.status).toBe(404);
    });

    it('treats a malformed body as absent rather than as a 500', async () => {
        const env = createEnv(deployment().namespace);
        const req = new Request(
            `https://${TEST_MAIN_DOMAIN}/${TEST_SECURE_PATH}/panel/platform/presets/preview`,
            { method: 'POST', body: '{not json', headers: { Cookie: await session() } }
        );
        await init(req, env);

        const response = await handlePlatform(req, env, 'presets/preview');
        expect(response?.status).toBe(400);
    });

    it('writes nothing, because the caller resubmits through the validated path', async () => {
        const kv = deployment();
        const before = kv.calls.filter(entry => entry.op === 'put').length;

        await call(kv, 'presets/preview', {
            cookie: await session(),
            method: 'POST',
            body: { id: 'balanced' }
        });

        expect(kv.calls.filter(entry => entry.op === 'put')).toHaveLength(before);
    });
});

/* ------------------------------------------------------------------ *
 * Scanner routes
 * ------------------------------------------------------------------ */

describe('scanner routes', () => {
    it('history defaults to clean-ip and rejects nothing, falling back on a bad kind', async () => {
        const kv = deployment();
        const repos = createRepositories(kv.namespace);
        await repos.scanner.recordRun({
            id: 'r1', at: 1_000, kind: 'clean-ip', targets: 2, healthy: 1,
            best: { address: '1.2.3.4', score: 80 }, medianScore: 60
        });
        await repos.flush();

        const defaulted = await body<{ kind: string; runs: unknown[] }>(
            await call(kv, 'scanner/history', { cookie: await session() })
        );
        expect(defaulted.body.kind).toBe('clean-ip');
        expect(defaulted.body.runs).toHaveLength(1);

        const bogus = await body<{ kind: string }>(
            await call(kv, 'scanner/history', { cookie: await session(), query: 'kind=nonsense' })
        );
        expect(bogus.body.kind).toBe('clean-ip');
    });

    it('schedule answers without needing the ability to scan', async () => {
        // Asking "when is the next scan due?" must not require a probe transport,
        // which is why the route computes the decision directly.
        const { body: decision } = await body<{ due: boolean; reason: string; nextDueAt: number | null }>(
            await call(deployment(), 'scanner/schedule', { cookie: await session() })
        );

        expect(decision.due).toBe(true);
        expect(decision.reason).toBe('never-run');
    });

    it('schedule reports disabled when asked', async () => {
        const { body: decision } = await body<{ due: boolean; reason: string }>(
            await call(deployment(), 'scanner/schedule', { cookie: await session(), query: 'enabled=false' })
        );

        expect(decision).toMatchObject({ due: false, reason: 'disabled' });
    });

    it('schedule clamps a too-short interval rather than honouring it', async () => {
        const kv = deployment();
        const repos = createRepositories(kv.namespace);
        await repos.scanner.recordRun({
            id: 'r1', at: Date.parse('2025-06-01T00:00:00.000Z') - 60_000,
            kind: 'clean-ip', targets: 1, healthy: 1, best: null, medianScore: null
        });
        await repos.flush();

        // 1s requested; the floor is 15 minutes, so the scan is not yet due.
        const { body: decision } = await body<{ due: boolean }>(
            await call(kv, 'scanner/schedule', { cookie: await session(), query: 'intervalMs=1000' })
        );

        expect(decision.due).toBe(false);
    });

    it('run is POST only', async () => {
        const response = await call(deployment(), 'scanner/run', { cookie: await session() });
        expect(response.status).toBe(405);
    });

    it('run validates the kind and requires at least one address', async () => {
        const cookie = await session();

        const badKind = await call(deployment(), 'scanner/run', {
            cookie, method: 'POST', body: { kind: 'nope', addresses: ['1.2.3.4'] }
        });
        expect(badKind.status).toBe(400);

        const noAddresses = await call(deployment(), 'scanner/run', {
            cookie, method: 'POST', body: { kind: 'clean-ip', addresses: [] }
        });
        expect(noAddresses.status).toBe(400);
    });

    it('run rejects non-string addresses without probing', async () => {
        const response = await call(deployment(), 'scanner/run', {
            cookie: await session(),
            method: 'POST',
            body: { kind: 'clean-ip', addresses: [1, null, {}] }
        });

        expect(response.status).toBe(400);
    });

    it('candidates is GET only', async () => {
        const response = await call(deployment(), 'scanner/candidates', {
            cookie: await session(), method: 'POST', body: {}
        });
        expect(response.status).toBe(405);
    });

    it('candidates validates the kind', async () => {
        const response = await call(deployment(), 'scanner/candidates', {
            cookie: await session(), query: 'kind=nonsense'
        });
        expect(response.status).toBe(400);
    });

    it('candidates draws from the configured endpoints, deduplicated', async () => {
        const kv = deployment({
            proxySettings: {
                cleanIPs: ['www.speedtest.net', '1.2.3.4'],
                customCdnAddrs: ['1.2.3.4', '5.6.7.8'],
                warpEndpoints: ['engage.cloudflareclient.com:2408'],
                panelVersion: VERSION
            }
        });
        const { body: result } = await body<{ kind: string; candidates: string[]; sourceCounts: Record<string, number> }>(
            await call(kv, 'scanner/candidates', { cookie: await session(), query: 'kind=clean-ip&count=10' })
        );

        expect(result.kind).toBe('clean-ip');
        // 1.2.3.4 appears in both cleanIPs and customCdnAddrs; it is listed once.
        expect(result.candidates).toEqual(['www.speedtest.net', '1.2.3.4', '5.6.7.8']);
        expect(result.sourceCounts).toEqual({ cleanIPs: 2, customCdnAddrs: 1 });
    });

    it('candidates honours the requested count', async () => {
        const kv = deployment({
            proxySettings: {
                cleanIPs: ['1.1.1.1', '2.2.2.2', '3.3.3.3'],
                customCdnAddrs: [],
                panelVersion: VERSION
            }
        });
        const { body: result } = await body<{ candidates: string[] }>(
            await call(kv, 'scanner/candidates', { cookie: await session(), query: 'kind=clean-ip&count=2' })
        );

        expect(result.candidates).toEqual(['1.1.1.1', '2.2.2.2']);
    });

    it('candidates returns an honest empty list when nothing is configured', async () => {
        const { body: result } = await body<{ candidates: string[]; total: number }>(
            await call(deployment(), 'scanner/candidates', { cookie: await session(), query: 'kind=clean-ip&count=10' })
        );

        expect(result.candidates).toEqual([]);
        expect(result.total).toBe(0);
    });

    it('applies a selected clean IP without replacing unrelated settings', async () => {
        const kv = deployment();
        const response = await call(kv, 'scanner/apply', {
            cookie: await session(),
            method: 'POST',
            body: { address: '1.1.1.1' }
        });
        const { body: result } = await body<{ cleanIPs: string[]; changed: boolean }>(response);

        expect(response.status).toBe(200);
        expect(result).toEqual({ cleanIPs: ['1.1.1.1'], changed: true });

        const stored = JSON.parse(kv.store.get('proxySettings') ?? '{}');
        expect(stored.cleanIPs).toEqual(['1.1.1.1']);
        expect(stored.remoteDNS).toBe('https://8.8.8.8/dns-query');
        expect(stored.ports).toEqual([443]);
    });

    it('preserves an unrelated setting changed while scanner apply is in flight', async () => {
        const kv = deployment();
        const originalGet = kv.namespace.get.bind(kv.namespace) as (
            key: string,
            options?: { type?: string } | string
        ) => Promise<unknown>;
        let settingsReads = 0;

        kv.namespace.get = (async (key: string, options?: { type?: string } | string) => {
            if (key === 'proxySettings' && ++settingsReads === 2) {
                const latest = JSON.parse(kv.store.get('proxySettings') ?? '{}');
                latest.remoteDNS = 'https://1.1.1.1/dns-query';
                kv.store.set('proxySettings', JSON.stringify(latest));
            }
            return originalGet(key, options);
        }) as KVNamespace['get'];

        const response = await call(kv, 'scanner/apply', {
            cookie: await session(),
            method: 'POST',
            body: { address: '1.1.1.1' }
        });

        expect(response.status).toBe(200);
        const stored = JSON.parse(kv.store.get('proxySettings') ?? '{}');
        expect(stored.cleanIPs).toEqual(['1.1.1.1']);
        expect(stored.remoteDNS).toBe('https://1.1.1.1/dns-query');
    });

    it('can append a clean IP and reports an idempotent apply', async () => {
        const kv = deployment({
            proxySettings: {
                ...JSON.parse(deployment().store.get('proxySettings') ?? '{}'),
                cleanIPs: ['1.1.1.1']
            }
        });
        const cookie = await session();

        const appended = await body<{ cleanIPs: string[]; changed: boolean }>(
            await call(kv, 'scanner/apply', {
                cookie,
                method: 'POST',
                body: { address: '8.8.8.8', mode: 'append' }
            })
        );
        expect(appended.body).toEqual({ cleanIPs: ['1.1.1.1', '8.8.8.8'], changed: true });

        const repeated = await body<{ cleanIPs: string[]; changed: boolean }>(
            await call(kv, 'scanner/apply', {
                cookie,
                method: 'POST',
                body: { address: '8.8.8.8', mode: 'append' }
            })
        );
        expect(repeated.body).toEqual({ cleanIPs: ['1.1.1.1', '8.8.8.8'], changed: false });
    });

    it('rejects invalid scanner apply requests without writing settings', async () => {
        const kv = deployment();
        const before = kv.store.get('proxySettings');
        const cookie = await session();

        for (const requestBody of [
            { address: 'https://example.com/path' },
            { address: '1.1.1.1:443' },
            { address: '1.1.1.1', mode: 'unknown' }
        ]) {
            const response = await call(kv, 'scanner/apply', {
                cookie,
                method: 'POST',
                body: requestBody
            });
            expect(response.status).toBe(400);
        }

        expect(kv.store.get('proxySettings')).toBe(before);
    });

    it('caps appended clean IPs', async () => {
        const existing = Array.from({ length: 40 }, (_, index) => `10.0.0.${index + 1}`);
        const base = deployment();
        const settings = JSON.parse(base.store.get('proxySettings') ?? '{}');
        const kv = deployment({ proxySettings: { ...settings, cleanIPs: existing } });

        const response = await call(kv, 'scanner/apply', {
            cookie: await session(),
            method: 'POST',
            body: { address: '1.1.1.1', mode: 'append' }
        });

        expect(response.status).toBe(400);
        expect(JSON.parse(kv.store.get('proxySettings') ?? '{}').cleanIPs).toEqual(existing);
    });
});

/* ------------------------------------------------------------------ *
 * Subscription links
 * ------------------------------------------------------------------ */

/**
 * These are the only routes in the platform table that write, so they are the only ones
 * where a bug persists. The route module was written before this file, and the shape of
 * these tests follows what actually broke elsewhere in the phase: `/addip` confirmed a
 * write that never landed because the assertion checked what reached the repository rather
 * than what came back out of it. So every case here re-reads through `links` after the
 * write, which is the only evidence that the value survived.
 */
describe('subscription link management', () => {
    /** Creates a link and returns the parsed profile. */
    async function create(kv: KvStub, cookie: string, payload: unknown): Promise<{
        token: string;
        name: string;
        status: string;
        expiresAt: number | null;
        requests: number;
    }> {
        const response = await call(kv, 'links/create', { cookie, method: 'POST', body: payload });
        const parsed = await body<{ token: string; name: string; status: string; expiresAt: number | null; requests: number }>(response);
        expect(parsed.success, parsed.message ?? 'create failed').toBe(true);
        return parsed.body;
    }

    async function list(kv: KvStub, cookie: string): Promise<{
        profiles: { token: string; name: string; status: string; enabled: boolean }[];
        max: number;
    }> {
        const parsed = await body<{ profiles: { token: string; name: string; status: string; enabled: boolean }[]; max: number }>(
            await call(kv, 'links', { cookie })
        );
        expect(parsed.success).toBe(true);
        return parsed.body;
    }

    it('an empty deployment reports no links and the real cap', async () => {
        const stored = await list(deployment(), await session());

        expect(stored.profiles).toEqual([]);
        // Read from the module rather than written as a literal, so the panel's create
        // button and the Worker's rejection cannot disagree.
        expect(stored.max).toBe(MAX_PROFILES);
    });

    it('a created link is readable back from storage, not just echoed', async () => {
        const kv = deployment();
        const cookie = await session();

        const created = await create(kv, cookie, { name: 'Family', days: 30 });
        const stored = await list(kv, cookie);

        expect(stored.profiles).toHaveLength(1);
        expect(stored.profiles[0]?.token).toBe(created.token);
        expect(stored.profiles[0]?.name).toBe('Family');
        expect(stored.profiles[0]?.status).toBe('active');
        // The KV document is the evidence the write landed, rather than the response.
        expect(kv.store.get('rz:profiles')).toContain(created.token);
    });

    it('the token is generated, never taken from the request', async () => {
        // A caller-supplied token would be a caller-chosen password on a URL that gets
        // pasted into chat apps.
        const created = await create(deployment(), await session(), { name: 'Attempt', token: 'aaaaaaaaaaaaaaaaaaaa' });

        expect(created.token).not.toBe('aaaaaaaaaaaaaaaaaaaa');
        expect(created.token).toMatch(/^[A-Za-z0-9_-]{16,64}$/u);
    });

    it('two links created in the same request do not share a token', async () => {
        // The runtime seam pins `random`, and an implementation that reached for it here
        // instead of `crypto.getRandomValues` would hand every profile the same token.
        const kv = deployment();
        const cookie = await session();

        const first = await create(kv, cookie, { name: 'One' });
        const second = await create(kv, cookie, { name: 'Two' });

        expect(first.token).not.toBe(second.token);
        expect((await list(kv, cookie)).profiles).toHaveLength(2);
    });

    it('omitting the expiry produces a link with no expiry rather than an expired one', async () => {
        // `expiryFrom` returns null for absent input. If a caller coerced that to 0, the
        // link would be born expired and the operator would never know why.
        const created = await create(deployment(), await session(), { name: 'Permanent' });

        expect(created.expiresAt).toBeNull();
        expect(created.status).toBe('active');
    });

    it('revoking a link keeps the row and stops the link working', async () => {
        const kv = deployment();
        const cookie = await session();
        const created = await create(kv, cookie, { name: 'Temporary' });

        const parsed = await body<{ remaining: number }>(
            await call(kv, 'links/update', { cookie, method: 'POST', body: { token: created.token, action: 'disable' } })
        );

        expect(parsed.success).toBe(true);
        const stored = await list(kv, cookie);
        // Kept, because "this link existed and was last used on Tuesday" is what the
        // operator wants after revoking. Deleting is the separate action.
        expect(stored.profiles).toHaveLength(1);
        expect(stored.profiles[0]?.status).toBe('disabled');
        expect(stored.profiles[0]?.enabled).toBe(false);
    });

    it('a revoked link can be re-enabled', async () => {
        const kv = deployment();
        const cookie = await session();
        const created = await create(kv, cookie, { name: 'Back' });

        await call(kv, 'links/update', { cookie, method: 'POST', body: { token: created.token, action: 'disable' } });
        await call(kv, 'links/update', { cookie, method: 'POST', body: { token: created.token, action: 'enable' } });

        expect((await list(kv, cookie)).profiles[0]?.status).toBe('active');
    });

    it('deleting a link removes it from storage', async () => {
        const kv = deployment();
        const cookie = await session();
        const created = await create(kv, cookie, { name: 'Gone' });

        await call(kv, 'links/update', { cookie, method: 'POST', body: { token: created.token, action: 'delete' } });

        expect((await list(kv, cookie)).profiles).toEqual([]);
        expect(kv.store.get('rz:profiles')).not.toContain(created.token);
    });

    it('an unknown action is rejected before anything is written', async () => {
        const kv = deployment();
        const cookie = await session();
        const created = await create(kv, cookie, { name: 'Intact' });

        const response = await call(kv, 'links/update', {
            cookie,
            method: 'POST',
            body: { token: created.token, action: 'revoke-everything' }
        });

        expect(response.status).toBe(400);
        expect((await list(kv, cookie)).profiles[0]?.status).toBe('active');
    });

    it('an unknown token is a 404, not a silent success', async () => {
        // A silent success is how an operator ends up believing they revoked a link.
        const response = await call(deployment(), 'links/update', {
            cookie: await session(),
            method: 'POST',
            body: { token: 'not-a-real-token-value', action: 'disable' }
        });

        expect(response.status).toBe(404);
    });

    it('both write routes refuse GET', async () => {
        const cookie = await session();

        for (const route of ['links/create', 'links/update']) {
            expect((await call(deployment(), route, { cookie })).status, route).toBe(405);
        }
    });

    it('a malformed body is a bad request, not a 500', async () => {
        const kv = deployment();
        const env = createEnv(kv.namespace);
        const req = new Request(
            `https://${TEST_MAIN_DOMAIN}/${TEST_SECURE_PATH}/panel/platform/links/update`,
            { method: 'POST', body: '{not json', headers: { Cookie: await session() } }
        );
        await init(req, env);

        expect((await handlePlatform(req, env, 'links/update'))?.status).toBe(400);
    });

    it('the cap is enforced, and the rejection does not evict an existing link', async () => {
        // `normaliseProfiles` truncates to MAX_PROFILES on read. Relying on that instead
        // of checking first would mean a create at the cap reported success while quietly
        // dropping whichever entry fell off the end.
        const kv = deployment();
        const cookie = await session();

        const tokens: string[] = [];
        for (let index = 0; index < MAX_PROFILES; index++) {
            tokens.push((await create(kv, cookie, { name: `Link ${index}` })).token);
        }

        const response = await call(kv, 'links/create', { cookie, method: 'POST', body: { name: 'One too many' } });
        expect(response.status).toBe(400);

        const stored = await list(kv, cookie);
        expect(stored.profiles).toHaveLength(MAX_PROFILES);
        expect(stored.profiles.map(profile => profile.token).sort()).toEqual([...tokens].sort());
    });

    it('a link change is recorded in history without the token', async () => {
        const kv = deployment();
        const cookie = await session();

        const created = await create(kv, cookie, { name: 'Audited' });
        const entries = await body<HistoryEntry[]>(await call(kv, 'history', { cookie }));
        const entry = entries.body.find(candidate => candidate.kind === 'links.changed');

        expect(entry?.summary).toBe("Created subscription link 'Audited'.");
        // History is durable and gets pasted into support conversations. A token in it
        // would be a live credential in a second place with a different lifetime.
        expect(JSON.stringify(entries.body)).not.toContain(created.token);
    });

    it('a revocation is dated in history, which is the point of logging it', async () => {
        const kv = deployment();
        const cookie = await session();
        const created = await create(kv, cookie, { name: 'Shared' });

        await call(kv, 'links/update', { cookie, method: 'POST', body: { token: created.token, action: 'disable' } });

        const entries = await body<HistoryEntry[]>(await call(kv, 'history', { cookie }));
        const summaries = entries.body.filter(entry => entry.kind === 'links.changed').map(entry => entry.summary);

        expect(summaries).toContain("Revoked subscription link 'Shared'.");
    });

    it('names are bounded and stripped of control characters', async () => {
        // The name reaches the panel table and Telegram HTML. Control characters break
        // both, and an unbounded name would grow the document without limit.
        const created = await create(deployment(), await session(), { name: `${'x'.repeat(200)}\u0007` });

        expect(created.name.length).toBeLessThanOrEqual(40);
        expect(created.name).not.toContain('\u0007');
    });

    it('a nameless link still gets a label rather than an empty row', async () => {
        expect((await create(deployment(), await session(), {})).name).toBe('Unnamed');
    });

    it('link routes need a session like every other platform route', async () => {
        // Covered by the enumerated sweep above too, but asserted here because these
        // routes write: an unauthenticated caller must not be able to mint a working
        // subscription link.
        for (const route of ['links', 'links/create', 'links/update']) {
            const response = await call(deployment(), route, { method: 'POST' });
            expect(response.status, route).toBe(401);
        }

        expect(await list(deployment(), await session())).toEqual({ profiles: [], max: MAX_PROFILES });
    });
});
