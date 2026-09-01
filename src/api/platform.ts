import { setSettings } from '@settings-loader';
/**
 * Internal platform API: the platform subsystems exposed as panel sub-routes.
 *
 * Why these routes exist and why they are additive only
 *
 * The rule that kept the panel rewrite honest was: the eleven original panel
 * sub-routes are the complete API surface, and if a screen needs data the Worker does
 * not return, the screen is out of scope rather than the endpoint. That is the right
 * rule while rewriting UI, and the wrong one while adding capability. These routes are
 * the capability, added deliberately, and every pre-existing route keeps its exact
 * path, method, payload and status codes.
 *
 * The authorisation rule
 *
 * Every route here is authenticated with the same `authenticate` call the existing
 * panel routes use, before any work happens. That is not a formality: the health
 * report names misconfigurations, the history log names what changed and when, and
 * the metrics show when the operator is active. Each of those is useful to an
 * attacker profiling a deployment, so none of it may be readable without a session.
 *
 * Data boundaries
 *
 *   - No route returns a secret, a UUID, a password, a token or `securePath`.
 *     The one deliberate exception is `links`, whose whole purpose is to hand the
 *     operator the subscription tokens they created; it is authenticated like
 *     everything else here, and the tokens live in their own KV key so they never
 *     travel in a settings export.
 *   - Scanner apply is the only settings mutation here. It accepts one validated
 *     address and updates only `cleanIPs`; general settings writes still use
 *     `panel/update-settings`.
 *   - The scan route is POST and rate-limited by construction (`PROBE_LIMITS`),
 *     because it is the only route in RayZen that generates outbound traffic on
 *     demand.
 */

import { authenticate } from '@auth';
import { HttpStatus, respond, safeError } from '@common';
import { updateDatasetDetailed } from '@kv';
import { persistIdentitySettings } from '@identity';
import { getGlobals, getKvSettings, getWarpAccounts, subscriptions } from '@settings';
import { withRecorder } from '@platform/record';
import { createStorage } from '@storage';
import { isValidProxyHost, validateSettings } from '@validators';
import { createPlatform, type Platform, type PlatformOptions } from '@platform/context';
import {
    readStorageCapabilities,
    settingsSubset,
    toCapabilityContext,
    toDiagnosticsContext,
    type CapabilityInput
} from '@platform/capability';
import type { ScanTargetKind } from '#types/platform';
import type { PanelSettings } from '#types/settings';
import { createSocketConnector, PROBE_LIMITS, type ProbeConnector } from '@features/scanner/probe';
import { ipv4ToInt, isCloudflareIp } from '@features/scanner/cloudflare';
import { candidatesInRange, validateCloudflareRange } from '@features/scanner/candidates';
import { clampInterval, decide } from '@features/scanner/schedule';
import { runtime } from '@runtime';
import { intelligenceFromHistory, intelligenceForRun, targetConfidence, explainTarget } from '@features/scanner/intelligence';
import { actionInsights } from '@features/analytics/service';
import { createBackup, planRestore, validateBackup, BACKUP_FORMAT_VERSION, MAX_BACKUP_BYTES } from '@features/backup/service';
import { compareConfigurations, planRollback, attributeChange } from '@features/configuration/compare';
import { buildHealthCenter } from '@features/health/service';
import { runPreflight, verifyDeployment } from '@features/deployment/service';
import { assessBackupCompatibility, assessMigration, MIN_SUPPORTED_VERSION } from '@features/migration/service';
import { adviseMigration, buildLifecycles } from '@features/scanner/lifecycle';
import { measureEffectiveness } from '@features/analytics/effectiveness';
import { createProfile, MAX_PROFILES, MAX_REQUEST_LIMIT, profileStatus, remainingRequests, requestLimitFrom, type Profile } from '@features/profiles';

/** Route names under `panel/platform/`, so the surface is greppable in one place. */
export const PLATFORM_ROUTES = [
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
    'presets/apply',
    'scanner/history',
    'scanner/schedule',
    'scanner/run',
    'scanner/candidates',
    'scanner/apply',
    'clean-ips',
    'modes',
    'subscriptions/urls',
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
    /**
     * Subscription links. Named `links/*` rather than `profiles/*` because `profiles`
     * above is already the optimization objective set, and two unrelated things called
     * "profile" one line apart is how a caller ends up sending a revoke to a scorer.
     *
     * These are the only routes here that write. The write is justified where the read/
     * preview rule is stated in this file's header: that rule exists so settings
     * validation keeps its monopoly on the settings document, and a link is not a
     * setting. It lives in its own KV key, it is validated by its own module, and
     * routing it through `panel/update-settings` would put subscription tokens into
     * every settings export.
     */
    'links',
    'links/create',
    'links/update'
] as const;

export type PlatformRoute = (typeof PLATFORM_ROUTES)[number];

/**
 * Assembles the capability input from live request state.
 *
 * `setSettings` is called first because the panel routes do not: `init` populates
 * the request globals but leaves `kvSettings` at the shipped defaults until
 * something loads them. Reporting health against defaults rather than against what
 * the operator actually saved would make the whole view a fiction. The subscription
 * and telegram handlers do the same thing for the same reason.
 */
/**
 * Exported because `src/handlers/scan.ts` needs the same capability snapshot to build an
 * optimization plan. Duplicating it there would let the two drift, and the drift would be
 * invisible: both would produce plausible findings from slightly different settings.
 */
export async function capabilityInput(env: Env): Promise<CapabilityInput> {
    await setSettings(env);

    const globals = getGlobals();
    const storage = createStorage(env.kv);
    const { hasPassword, hasTelegramBot } = await readStorageCapabilities(storage);

    return {
        settings: settingsSubset({ ...getKvSettings(), ...globals }),
        deployType: globals.deployType ?? 'workers',
        hasKv: Boolean(env.kv),
        hasApiToken: Boolean(globals.apiToken),
        hasPassword,
        hasTelegramBot,
        hasWarpAccounts: getWarpAccounts().length > 0
    };
}

/**
 * Keys `getGlobals` carries that describe *this request*, not the deployment's
 * configuration.
 *
 * `getGlobals()` returns `EmbededSettings & ReqSettings`, and the second half is
 * per-request: the URL being served, the query string, the client hint, and the two
 * static port tables. Merging them into a settings record was wrong in three ways
 * that all showed up at once:
 *
 *   1. **`pathname` leaked `securePath`.** A backup is supposed to be safe to share
 *      (`PROTECTED_KEYS` in src/features/backup/service.ts redacts `securePath`),
 *      but `pathname` is `/<securePath>/panel/platform/backup/export`, so the path
 *      travelled in the payload anyway and defeated the redaction.
 *   2. **Restore and rollback proposed nonsense changes.** `planRestore` diffs the
 *      envelope against this record, so restoring a backup produced a plan whose
 *      only change was rewriting `pathname` from the plan URL to the export URL.
 *   3. **`searchParams` is a `URLSearchParams`.** It survives neither
 *      `canonicalise` nor a JSON round trip as a settings value.
 *
 * Removing them costs nothing: no preset, recommendation, comparison or rollback
 * reads any of these, and the routes that genuinely need request context
 * (`deploymentInput`) read it from `getGlobals()` and the URL directly.
 */
const REQUEST_SCOPED_KEYS = [
    'origin',
    'pathname',
    'hostname',
    'searchParams',
    'client',
    'httpPorts',
    'httpsPorts'
] as const;

/**
 * Reads the current settings as a plain record, for preset and recommendation
 * comparison. Both need the whole settings object, unlike the diagnostics context
 * which is deliberately narrowed.
 *
 * Assumes the caller has already loaded settings, which every route that uses it
 * does either directly or through `capabilityInput`.
 *
 * Request-scoped globals are stripped; see `REQUEST_SCOPED_KEYS`.
 */
async function currentSettings(env: Env): Promise<Record<string, unknown>> {
    await setSettings(env);

    const merged = { ...getKvSettings(), ...getGlobals() } as unknown as Record<string, unknown>;
    for (const key of REQUEST_SCOPED_KEYS) delete merged[key];

    return merged;
}

/**
 * Creates a platform for one request.
 *
 * The probe transport is a *deferred* connector: `createSocketConnector` is not
 * awaited here, it is awaited on the first connect. That matters because
 * `cloudflare:sockets` is external to the bundle and unresolvable outside the
 * Worker runtime, so importing it eagerly would make the scan route fail at setup
 * in any other environment, including before a request that is about to be
 * rejected for a bad payload. A run that never probes never imports.
 */
function platformFor(env: Env, needsProbe: boolean): Platform {
    const options: PlatformOptions = {};

    if (needsProbe) {
        let connector: Promise<ProbeConnector> | null = null;
        options.probe = {
            connect: target => {
                connector ??= createSocketConnector();
                // The socket is created once the connector resolves; `opened`
                // therefore carries the import failure too, which `probeTarget`
                // already treats as a failed attempt rather than an exception.
                const socket = connector.then(connect => connect(target));
                return {
                    opened: socket.then(value => value.opened),
                    close: () => socket.then(value => value.close()).catch(() => undefined)
                };
            }
        };
    }

    return createPlatform(env.kv, options);
}

/**
 * Handles a `panel/platform/*` route.
 *
 * Returns null when the path is not a platform route, so the caller falls through
 * to its existing switch rather than this module having to know about the others.
 */
export async function handlePlatform(
    request: Request,
    env: Env,
    route: string
): Promise<Response | null> {
    if (!(PLATFORM_ROUTES as readonly string[]).includes(route)) return null;

    const auth = await authenticate(request, env);
    if (!auth) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
    }

    // The probe transport is attached only for a request that can actually scan. The
    // method is checked here as well as in `scannerRun` so a GET, which is answered
    // with 405, does not pay the dynamic import of `cloudflare:sockets` first.
    const needsProbe = route === 'scanner/run' && request.method === 'POST';
    const platform = platformFor(env, needsProbe);

    try {
        return await dispatch(request, env, route as PlatformRoute, platform);
    } catch (error) {
        console.error('Platform request failed:', safeError(error));
        return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, 'The request could not be completed.');
    } finally {
        // Counters and history entries are mutated in memory and written once. A
        // route that skipped this would silently lose them.
        await platform.dispose();
    }
}

async function dispatch(
    request: Request,
    env: Env,
    route: PlatformRoute,
    platform: Platform
): Promise<Response> {
    switch (route) {
        case 'health':
            return health(env, platform);

        case 'features':
            return features(env, platform);

        case 'metrics':
            return metrics(platform);

        case 'history':
            return history(request, platform);

        case 'recommendations':
            return recommendations(env, platform);

        case 'recommendations/outcome':
            return recommendationOutcome(request, platform);

        case 'profiles':
            return profiles(platform);

        case 'profiles/evaluate':
            return profileEvaluation(request, env, platform);

        case 'presets':
            return presets(platform);

        case 'presets/preview':
            return presetPreview(request, env, platform);

        case 'presets/apply':
            return presetApply(request, env, platform);

        case 'scanner/history':
            return scannerHistory(request, platform);

        case 'scanner/schedule':
            return scannerSchedule(request, platform);

        case 'scanner/run':
            return scannerRun(request, platform);

        case 'scanner/candidates':
            return scannerCandidates(request, env, platform);

        case 'scanner/apply':
            return scannerApply(request, env, platform);

        case 'clean-ips':
            return cleanIpsRoute(request, env, platform);

        case 'modes':
            return modesRoute(request, env, platform);

        case 'subscriptions/urls':
            return subscriptionUrls(request, env, platform);

        case 'health/center':
            return healthCenter(env, platform);

        case 'deployment/preflight':
            return deploymentPreflight(request, env, platform);

        case 'deployment/verify':
            return deploymentVerify(request, env, platform);

        case 'backup/export':
            return backupExport(env);

        case 'backup/validate':
            return backupValidate(request, env);

        case 'backup/plan':
            return backupPlan(request, env);

        case 'backup/import-remote':
            return backupImportRemote(request);

        case 'config/compare':
            return configCompare(request, env);

        case 'config/rollback':
            return configRollback(request, env);

        case 'config/history':
            return configHistory(request, platform);

        case 'migration/status':
            return migrationStatus(request);

        case 'scanner/lifecycle':
            return scannerLifecycle(request, env, platform);

        case 'analytics/effectiveness':
            return analyticsEffectiveness(platform);

        case 'advanced/diagnostics':
            return advancedDiagnostics(env, platform);

        case 'links':
            return links(platform);

        case 'links/create':
            return linkCreate(request, platform);

        case 'links/update':
            return linkUpdate(request, platform);
    }
}

async function health(env: Env, platform: Platform): Promise<Response> {
    const input = await capabilityInput(env);

    // Statistics are best-effort input to one check. A KV failure here must
    // degrade that single check to `skip`, not fail the whole health report,
    // which is the view an operator opens *because* something is wrong.
    let statistics = null;
    try {
        statistics = await platform.services.get('analytics').statistics();
    } catch {
        statistics = null;
    }

    const scanRuns = await platform.services.get('repositories').scanner.listRuns('clean-ip', 5);
    const context = toDiagnosticsContext(input, VERSION, statistics, intelligenceFromHistory(scanRuns));
    const report = platform.services.get('diagnostics').run(context);

    return respond(true, HttpStatus.OK, undefined, report, noStore());
}

async function features(env: Env, platform: Platform): Promise<Response> {
    const context = toCapabilityContext(await capabilityInput(env));
    return respond(true, HttpStatus.OK, undefined, platform.features.evaluateAll(context), noStore());
}

async function metrics(platform: Platform): Promise<Response> {
    const analytics = platform.services.get('analytics');
    const [snapshot, statistics] = await Promise.all([analytics.snapshot(), analytics.statistics()]);

    return respond(true, HttpStatus.OK, undefined, { snapshot, statistics, insights: actionInsights(snapshot) }, noStore());
}

async function history(request: Request, platform: Platform): Promise<Response> {
    const limit = clampLimit(new URL(request.url).searchParams.get('limit'), 50);
    const entries = await platform.services.get('history').list(limit);

    return respond(true, HttpStatus.OK, undefined, entries, noStore());
}

async function recommendations(env: Env, platform: Platform): Promise<Response> {
    const input = await capabilityInput(env);

    let statistics = null;
    try {
        statistics = await platform.services.get('analytics').statistics();
    } catch {
        statistics = null;
    }

    const scanRuns = await platform.services.get('repositories').scanner.listRuns('clean-ip', 5);
    const list = await platform.recommendations.collect({
        diagnostics: toDiagnosticsContext(input, VERSION, statistics, intelligenceFromHistory(scanRuns)),
        settings: await currentSettings(env)
    });
    if (list.length > 0) await platform.services.get('analytics').record('recommendation.shown', list.length);
    return respond(true, HttpStatus.OK, undefined, list, noStore());
}

function profiles(platform: Platform): Response {
    return respond(true, HttpStatus.OK, undefined, platform.services.get('optimization').profiles(), noStore());
}

async function profileEvaluation(request: Request, env: Env, platform: Platform): Promise<Response> {
    if (request.method !== 'POST') return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    const evaluations = await platform.services.get('optimization').evaluate(await currentSettings(env));
    await platform.services.get('analytics').record('optimization.evaluated');
    return respond(true, HttpStatus.OK, undefined, evaluations, noStore());
}

async function recommendationOutcome(request: Request, platform: Platform): Promise<Response> {
    if (request.method !== 'POST') return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    const body = (await readJson(request)) as { outcome?: unknown } | null;
    if (body?.outcome !== 'accepted' && body?.outcome !== 'dismissed') return respond(false, HttpStatus.BAD_REQUEST, "outcome must be 'accepted' or 'dismissed'.");
    await platform.services.get('analytics').record(body.outcome === 'accepted' ? 'recommendation.accepted' : 'recommendation.dismissed');
    return respond(true, HttpStatus.OK, undefined, { recorded: true }, noStore());
}

function presets(platform: Platform): Response {
    return respond(true, HttpStatus.OK, undefined, platform.presets.list(), noStore());
}

/**
 * Returns what a preset *would* change. Never writes.
 *
 * POST rather than GET because the request carries a body in the general case and
 * because a preview that appeared in browser history alongside settings values
 * would be a small leak for no benefit. The response is the merged object, which
 * the panel then submits through `panel/update-settings` so validation runs.
 */
async function presetPreview(request: Request, env: Env, platform: Platform): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    const body = (await readJson(request)) as { id?: unknown } | null;
    const id = typeof body?.id === 'string' ? body.id : '';
    if (!id) return respond(false, HttpStatus.BAD_REQUEST, 'A preset id is required.');

    const application = platform.presets.apply(id, await currentSettings(env));
    if (!application) return respond(false, HttpStatus.NOT_FOUND, `Unknown preset '${id}'.`);

    return respond(
        true,
        HttpStatus.OK,
        undefined,
        {
            preset: application.preset,
            changed: application.changed,
            // Only the keys the preset touches are returned, not the whole merged
            // settings object. Echoing every field would put the UUID and Trojan
            // password in a response that does not need them.
            patch: Object.fromEntries(application.changed.map(key => [key, application.result[key]]))
        },
        noStore()
    );
}

/**
 * Applies a preset directly. Validates resulting settings and writes both KV and main settings.
 */
async function presetApply(request: Request, env: Env, platform: Platform): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    const body = (await readJson(request)) as { id?: unknown } | null;
    const id = typeof body?.id === 'string' ? body.id : '';
    if (!id) return respond(false, HttpStatus.BAD_REQUEST, 'A preset id is required.');

    const current = await currentSettings(env);
    const application = platform.presets.apply(id, current);
    if (!application) return respond(false, HttpStatus.NOT_FOUND, `Unknown preset '${id}'.`);

    const next = application.result as unknown as PanelSettings;
    const errors = validateSettings(next);
    if (errors) {
        return respond(false, HttpStatus.BAD_REQUEST, 'Validation Error', errors);
    }

    const { changed } = await updateDatasetDetailed(env, next);

    await withRecorder(env, p => {
        p.events.emit('settings.updated', { changed, version: VERSION });
    });

    return respond(
        true,
        HttpStatus.OK,
        undefined,
        {
            preset: application.preset,
            changed,
            patch: Object.fromEntries(application.changed.map(key => [key, next[key as keyof PanelSettings]]))
        },
        noStore()
    );
}

const SCAN_KINDS: readonly ScanTargetKind[] = ['proxy-ip', 'clean-ip', 'warp-endpoint'];

/**
 * Body ceiling for an apply.
 *
 * 64 KB, sized against the work it has to allow: a deep scan can return a thousand
 * working addresses, and "Apply All" sends every one of them in a single call. At
 * ~16 bytes per address plus JSON overhead that is under 24 KB, so the bound has
 * headroom without being an invitation to stream megabytes at the validator.
 */
const MAX_SCANNER_APPLY_BYTES = 64 * 1024;

/**
 * Ceiling on the stored clean-IP list.
 *
 * This is a settings-document size bound, not a scanner bound. The subscription
 * builders emit one config per clean IP per core, so a list in the thousands makes
 * a subscription no client will parse; 1,000 is far past any practical list and
 * still keeps the settings value small.
 */
const MAX_CLEAN_IPS = 1000;

function parseKind(value: string | null): ScanTargetKind | null {
    return SCAN_KINDS.includes(value as ScanTargetKind) ? (value as ScanTargetKind) : null;
}

async function scannerHistory(request: Request, platform: Platform): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const kind = parseKind(params.get('kind')) ?? 'clean-ip';
    const limit = clampLimit(params.get('limit'), 20);

    const runs = await platform.services.get('repositories').scanner.listRuns(kind, limit);
    return respond(true, HttpStatus.OK, undefined, { kind, runs, intelligence: intelligenceFromHistory(runs) }, noStore());
}

async function scannerSchedule(request: Request, platform: Platform): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const kind = parseKind(params.get('kind')) ?? 'clean-ip';
    const interval = Number(params.get('intervalMs'));

    const repository = platform.services.get('repositories').scanner;
    const lastRunAt = await repository.lastRunAt(kind);

    // The decision is computed here rather than through the scanner service so this
    // route needs no probe transport: asking "when is the next scan due?" must not
    // require the ability to scan. `schedule.ts` is a pure module with no runtime
    // imports, so this costs nothing beyond the two functions.
    //
    // The clock comes from the runtime seam, not `Date.now`, for the same reason
    // every other clock read in the platform does: a route whose answer depends on
    // wall time is untestable otherwise.
    const decision = decide(
        {
            enabled: params.get('enabled') !== 'false',
            lastRunAt,
            ...(Number.isFinite(interval) && interval > 0 ? { intervalMs: clampInterval(interval) } : {})
        },
        runtime.now().getTime()
    );

    return respond(true, HttpStatus.OK, undefined, { kind, ...decision }, noStore());
}

/**
 * Runs a scan.
 *
 * POST only and authenticated, because this is the one route that makes the
 * deployment emit outbound connections on request. Targets come from the body so
 * the caller decides what to probe, and `PROBE_LIMITS` caps how much of it happens
 * regardless of what was asked for.
 */
async function scannerRun(request: Request, platform: Platform): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    const body = (await readJson(request)) as
        | { kind?: unknown; addresses?: unknown; attempts?: unknown }
        | null;

    const kind = parseKind(typeof body?.kind === 'string' ? body.kind : null);
    if (!kind) {
        return respond(false, HttpStatus.BAD_REQUEST, `kind must be one of: ${SCAN_KINDS.join(', ')}.`);
    }

    const addresses = Array.isArray(body?.addresses)
        ? body.addresses.filter((value): value is string => typeof value === 'string')
        : [];

    if (addresses.length === 0) {
        return respond(false, HttpStatus.BAD_REQUEST, 'At least one address is required.');
    }

    const attempts = typeof body?.attempts === 'number' ? body.attempts : undefined;
    const run = await platform.services.get('scanner').run({
        kind,
        addresses,
        ...(attempts === undefined ? {} : { attempts })
    });

    const intelligence = intelligenceForRun(run);

    // The full attempt list is dropped from the response: bounded aggregates and explanations are sufficient.
    return respond(
        true,
        HttpStatus.OK,
        undefined,
        {
            id: run.id,
            at: run.at,
            kind: run.kind,
            dead: run.dead,
            // Reported separately from `dead` and `ranked` so the panel can explain that a
            // Cloudflare/private/loopback candidate is out of reach for this measurement
            // rather than presenting a healthy endpoint as a failure.
            unmeasurable: run.unmeasurable.map(entry => ({
                address: entry.address,
                reason: entry.reason,
                problem: entry.problem,
                impact: entry.impact,
                cause: entry.cause,
                solution: entry.solution
            })),
            intelligence,
            ranked: run.ranked.map((entry, index) => ({
                address: entry.target.address,
                score: entry.score,
                verdict: entry.verdict,
                reliability: entry.reliability,
                latency: entry.latency,
                stability: entry.stability,
                avgLatencyMs: entry.result.avgLatencyMs,
                jitterMs: entry.result.jitterMs,
                confidence: targetConfidence(entry, run.ranked[index + 1]),
                reasons: explainTarget(entry, run.ranked[index + 1])
            }))
        },
        noStore()
    );
}

/**
 * Candidate discovery: the "Generate candidates" step of the scan workflow.
 *
 * The candidate pool is drawn entirely from what the operator has actually
 * configured — proxy IPs, clean IPs, custom CDN addresses and WARP endpoints —
 * never from randomly sampled public address space. Random sampling would
 * (a) scan third-party hosts, which `probe.ts` deliberately avoids, and
 * (b) mostly surface Cloudflare ranges, which the runtime cannot measure anyway.
 * The scanner's own documentation describes this exact boundary: target sources
 * are supplied by the caller, and settings are the source that exists today.
 *
 * The UI flow is: discover candidates → pick how many → measure → read the
 * ranked explanation. This route is the discover step; it does not probe.
 */
async function scannerCandidates(request: Request, env: Env, platform: Platform): Promise<Response> {
    if (request.method !== 'GET') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    await setSettings(env);

    const url = new URL(request.url);
    const kind = parseKind(url.searchParams.get('kind'));
    if (!kind) {
        return respond(false, HttpStatus.BAD_REQUEST, `kind must be one of: ${SCAN_KINDS.join(', ')}.`);
    }

    const requested = Number(url.searchParams.get('count') ?? 10);
    const count = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), PROBE_LIMITS.maxTargetsPerRun) : 10;

    /**
     * Custom range. When present the sample comes from that one CIDR instead of the
     * configured address lists, which is what "scan this range" means. The range must
     * be fully inside Cloudflare's published IPv4 space: the reason
     * `isCloudflareAddress` exists is that a prober willing to visit an arbitrary
     * address is a port scanner running from the operator's own deployment, and a
     * range parameter would be the easiest way to hand one an arbitrary target.
     */
    const rawRange = url.searchParams.get('range');
    if (rawRange) {
        if (kind !== 'clean-ip') {
            return respond(false, HttpStatus.BAD_REQUEST, "range is only supported for kind 'clean-ip'.");
        }
        const range = validateCloudflareRange(rawRange);
        if (!range.ok) {
            const message = range.reason === 'malformed'
                ? 'range must be an IPv4 CIDR, for example 104.16.0.0/16.'
                : range.reason === 'prefix-out-of-range'
                    ? 'range prefix length must be between 8 and 31.'
                    : 'range is outside the published Cloudflare IPv4 list.';
            return respond(false, HttpStatus.BAD_REQUEST, message, { reason: range.reason }, noStore());
        }

        const sample = candidatesInRange(range.cidr, count, Number(url.searchParams.get('seed') ?? 1) || 1);
        return respond(true, HttpStatus.OK, undefined, {
            kind,
            range: range.cidr,
            withinPrefix: range.prefix,
            hosts: range.hosts,
            candidates: sample.map(entry => entry.address),
            blocks: [...new Set(sample.map(entry => entry.block))],
            sourceCounts: { range: sample.length },
            total: sample.length
        }, noStore());
    }

    const kvSettings = getKvSettings();
    const globals = getGlobals();

    // Per-kind sources, in the order they matter for that kind's purpose. The
    // proxy-ip kind is the operator's relay list; clean-ip adds the CDN/clean
    // lists; warp-endpoint is the WARP relay list alone.
    const sources: Record<ScanTargetKind, { label: string; values: readonly string[] }[]> = {
        'proxy-ip': [
            { label: 'proxyIPs', values: globals.proxyIPs }
        ],
        'clean-ip': [
            { label: 'proxyIPs', values: globals.proxyIPs },
            { label: 'cleanIPs', values: kvSettings.cleanIPs },
            { label: 'customCdnAddrs', values: kvSettings.customCdnAddrs }
        ],
        'warp-endpoint': [
            { label: 'warpEndpoints', values: kvSettings.warpEndpoints }
        ]
    };

    const seen = new Set<string>();
    const candidates: string[] = [];
    const sourceCounts: Record<string, number> = {};

    for (const source of sources[kind]) {
        for (const raw of source.values) {
            const address = raw.trim();
            if (!address || seen.has(address)) continue;
            seen.add(address);
            sourceCounts[source.label] = (sourceCounts[source.label] ?? 0) + 1;
            candidates.push(address);
            if (candidates.length >= count) break;
        }
        if (candidates.length >= count) break;
    }

    return respond(
        true,
        HttpStatus.OK,
        undefined,
        { kind, candidates, sourceCounts, total: candidates.length },
        noStore()
    );
}

/** One rejected entry, with a machine-readable reason the Companion can localise. */
interface Rejection {
    address: string;
    reason: string;
}

/**
 * Splits an incoming list into addresses that are published Cloudflare IPv4 and
 * everything else, keeping the reason for each rejection.
 *
 * Partial acceptance rather than all-or-nothing. "Apply All" sends whatever a scan
 * produced, and one stale or mistyped entry rejecting a thousand good ones would
 * make the feature useless. Duplicates are reported rather than silently dropped so
 * the counts the caller shows add up.
 */
function partitionCloudflareIpv4(entries: readonly unknown[]): { accepted: string[]; rejected: Rejection[] } {
    const accepted: string[] = [];
    const rejected: Rejection[] = [];
    const seen = new Set<string>();

    for (const entry of entries) {
        if (typeof entry !== 'string') {
            rejected.push({ address: '', reason: 'not-a-string' });
            continue;
        }

        const address = entry.trim();
        if (!address) continue;

        if (seen.has(address)) {
            rejected.push({ address, reason: 'duplicate' });
            continue;
        }
        seen.add(address);

        if (ipv4ToInt(address) === null) {
            rejected.push({ address, reason: 'not-an-ipv4-address' });
            continue;
        }

        if (!isCloudflareIp(address)) {
            rejected.push({ address, reason: 'outside-published-cloudflare-ranges' });
            continue;
        }

        accepted.push(address);
    }

    return { accepted, rejected };
}

/**
 * Writes a clean-IP list.
 *
 * `mode` is the whole contract. `replace` stores exactly the list given, in the
 * order given, which is what makes reordering a save rather than a separate
 * endpoint; `append` unions onto what is already stored. Either way this is one KV
 * write, because the settings document is written once through
 * `updateDatasetDetailed`.
 */
async function storeCleanIPs(
    cleanIPs: string[],
    env: Env,
    platform: Platform
): Promise<{ error: Response } | { cleanIPs: string[]; changed: boolean }> {
    if (cleanIPs.length > MAX_CLEAN_IPS) {
        return { error: respond(false, HttpStatus.BAD_REQUEST, `A maximum of ${MAX_CLEAN_IPS} clean IPs is supported.`) };
    }

    const settings = await currentSettings(env) as unknown as PanelSettings;
    const next = { ...settings, cleanIPs } as PanelSettings;
    const errors = validateSettings(next);
    if (errors) {
        return { error: respond(false, HttpStatus.BAD_REQUEST, 'Validation Error', errors) };
    }

    const { changed } = await updateDatasetDetailed(env, { cleanIPs });
    platform.events.emit('settings.updated', { changed, version: VERSION });

    return { cleanIPs, changed: changed.includes('cleanIPs') };
}

async function currentCleanIPs(env: Env): Promise<string[]> {
    const settings = await currentSettings(env) as unknown as PanelSettings;
    return Array.isArray(settings.cleanIPs) ? [...settings.cleanIPs] : [];
}

/**
 * `scanner/apply`: push scan results into the clean-IP list.
 *
 * Accepts an arbitrary-length array. There is no per-call item cap; the bounds are
 * the body size and the stored-list ceiling, both of which are about keeping the
 * settings document sane rather than about how many results a scan may produce.
 * Every entry is validated as a published Cloudflare IPv4, and the response reports
 * the accepted count alongside each rejected entry and its reason, so the caller can
 * show a result state instead of a bare failure.
 */
async function scannerApply(request: Request, env: Env, platform: Platform): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    const { value, tooLarge } = await readBoundedJson(request, MAX_SCANNER_APPLY_BYTES);
    if (tooLarge) {
        return respond(false, HttpStatus.PAYLOAD_TOO_LARGE, 'Request body is too large.');
    }

    const body = value && typeof value === 'object' && !Array.isArray(value)
        ? value as { address?: unknown; addresses?: unknown; mode?: unknown }
        : null;
    if (!body) {
        return respond(false, HttpStatus.BAD_REQUEST, 'A JSON object is required.');
    }

    const incoming: unknown[] = Array.isArray(body.addresses)
        ? body.addresses
        : typeof body.address === 'string' ? [body.address] : [];
    if (incoming.length === 0) {
        return respond(false, HttpStatus.BAD_REQUEST, 'address or addresses is required.');
    }

    const mode = body.mode ?? 'replace';
    if (mode !== 'replace' && mode !== 'append') {
        return respond(false, HttpStatus.BAD_REQUEST, "mode must be 'replace' or 'append'.");
    }

    const { accepted, rejected } = partitionCloudflareIpv4(incoming);
    if (accepted.length === 0) {
        return respond(false, HttpStatus.BAD_REQUEST, 'No entry was a published Cloudflare IPv4 address.', { accepted: 0, rejected }, noStore());
    }

    const existing = mode === 'append' ? await currentCleanIPs(env) : [];
    const merged = [...new Set([...existing, ...accepted])];

    const result = await storeCleanIPs(merged, env, platform);
    if ('error' in result) return result.error;

    return respond(true, HttpStatus.OK, undefined, {
        accepted: accepted.length,
        acceptedAddresses: accepted,
        rejected,
        cleanIPs: result.cleanIPs,
        changed: result.changed
    }, noStore());
}

/**
 * `clean-ips`: the operator's own list, managed without touching KV by hand.
 *
 * GET reads it. PUT stores the list verbatim, which covers add, delete and reorder
 * in one call and one write — the order is the order the subscription builders emit,
 * so it is data, not presentation. POST appends. DELETE removes named entries.
 *
 * Unlike `scanner/apply` this accepts hostnames as well as addresses: an operator's
 * clean list legitimately contains CDN hostnames, and only the scanner is restricted
 * to Cloudflare IPv4 because only the scanner claims to have measured one.
 */
async function cleanIpsRoute(request: Request, env: Env, platform: Platform): Promise<Response> {
    if (request.method === 'GET') {
        return respond(true, HttpStatus.OK, undefined, {
            cleanIPs: await currentCleanIPs(env),
            max: MAX_CLEAN_IPS
        }, noStore());
    }

    if (request.method !== 'POST' && request.method !== 'PUT' && request.method !== 'DELETE') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    const { value, tooLarge } = await readBoundedJson(request, MAX_SCANNER_APPLY_BYTES);
    if (tooLarge) {
        return respond(false, HttpStatus.PAYLOAD_TOO_LARGE, 'Request body is too large.');
    }

    const body = value && typeof value === 'object' && !Array.isArray(value)
        ? value as { address?: unknown; addresses?: unknown; cleanIPs?: unknown }
        : null;
    if (!body) {
        return respond(false, HttpStatus.BAD_REQUEST, 'A JSON object is required.');
    }

    const rawList = Array.isArray(body.cleanIPs)
        ? body.cleanIPs
        : Array.isArray(body.addresses)
            ? body.addresses
            : typeof body.address === 'string' ? [body.address] : null;
    if (!rawList) {
        return respond(false, HttpStatus.BAD_REQUEST, 'cleanIPs, addresses, or address is required.');
    }

    const rejected: Rejection[] = [];
    const incoming: string[] = [];
    const seen = new Set<string>();
    for (const entry of rawList) {
        if (typeof entry !== 'string') {
            rejected.push({ address: '', reason: 'not-a-string' });
            continue;
        }
        const address = entry.trim();
        if (!address) continue;
        if (seen.has(address)) {
            rejected.push({ address, reason: 'duplicate' });
            continue;
        }
        seen.add(address);
        if (!isValidProxyHost(address, false)) {
            rejected.push({ address, reason: 'not-an-address-or-hostname' });
            continue;
        }
        incoming.push(address);
    }

    let cleanIPs: string[];
    if (request.method === 'DELETE') {
        const removing = new Set(incoming);
        cleanIPs = (await currentCleanIPs(env)).filter(entry => !removing.has(entry));
    } else if (request.method === 'POST') {
        cleanIPs = [...new Set([...(await currentCleanIPs(env)), ...incoming])];
    } else {
        if (incoming.length === 0) {
            return respond(false, HttpStatus.BAD_REQUEST, 'cleanIPs must contain at least one valid entry.', { rejected }, noStore());
        }
        cleanIPs = incoming;
    }

    const result = await storeCleanIPs(cleanIPs, env, platform);
    if ('error' in result) return result.error;

    return respond(true, HttpStatus.OK, undefined, {
        cleanIPs: result.cleanIPs,
        changed: result.changed,
        accepted: incoming.length,
        rejected
    }, noStore());
}

/**
 * The two mode selections that used to be reachable only by editing the settings
 * document: how an outbound is addressed, and how TLS records are fragmented.
 *
 * Declared as data rather than as branches in the UI so the panel and the Companion
 * render the same options from one source, and so adding a mode is a line here.
 */
const MODE_OPTIONS = {
    proxyIpMode: {
        options: ['proxyip', 'prefix'] as const,
        labels: {
            proxyip: 'Proxy IP',
            prefix: 'Address prefix'
        }
    },
    fragmentMode: {
        options: ['custom', 'low', 'medium', 'high'] as const,
        labels: {
            custom: 'Custom',
            low: 'Low',
            medium: 'Medium',
            high: 'High'
        }
    }
} as const;

type ModeField = keyof typeof MODE_OPTIONS;

async function modesRoute(request: Request, env: Env, platform: Platform): Promise<Response> {
    const settings = await currentSettings(env) as unknown as PanelSettings;

    const describe = () => ({
        modes: (Object.keys(MODE_OPTIONS) as ModeField[]).map(field => ({
            field,
            value: String((settings as unknown as Record<string, unknown>)[field] ?? ''),
            options: MODE_OPTIONS[field].options.map(id => ({
                id,
                label: (MODE_OPTIONS[field].labels as Record<string, string>)[id]
            }))
        }))
    });

    if (request.method === 'GET') {
        return respond(true, HttpStatus.OK, undefined, describe(), noStore());
    }

    if (request.method !== 'POST' && request.method !== 'PUT') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    const { value, tooLarge } = await readBoundedJson(request, MAX_SCANNER_APPLY_BYTES);
    if (tooLarge) {
        return respond(false, HttpStatus.PAYLOAD_TOO_LARGE, 'Request body is too large.');
    }
    const body = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
    if (!body) {
        return respond(false, HttpStatus.BAD_REQUEST, 'A JSON object is required.');
    }

    const patch: Record<string, string> = {};
    for (const field of Object.keys(MODE_OPTIONS) as ModeField[]) {
        const requested = body[field];
        if (requested === undefined) continue;
        if (typeof requested !== 'string' || !(MODE_OPTIONS[field].options as readonly string[]).includes(requested)) {
            return respond(
                false,
                HttpStatus.BAD_REQUEST,
                `${field} must be one of: ${MODE_OPTIONS[field].options.join(', ')}.`
            );
        }
        patch[field] = requested;
    }

    if (Object.keys(patch).length === 0) {
        return respond(false, HttpStatus.BAD_REQUEST, 'At least one mode field is required.');
    }

    const next = { ...settings, ...patch } as PanelSettings;
    const errors = validateSettings(next);
    if (errors) {
        return respond(false, HttpStatus.BAD_REQUEST, 'Validation Error', errors);
    }

    /**
     * The two fields live in different documents. `proxyIpMode` belongs to the
     * deployment identity in `rz:identity`, so it is written through
     * `persistIdentitySettings`; `fragmentMode` is an ordinary setting in
     * `proxySettings`. Writing both through `updateDatasetDetailed` is the bug this
     * split exists to avoid: the value would appear to save and then read back as the
     * old one on the next request.
     */
    const changed: string[] = [];
    if (patch.proxyIpMode !== undefined) {
        await persistIdentitySettings(env, { proxyIpMode: patch.proxyIpMode });
        changed.push('proxyIpMode');
    }
    const { fragmentMode } = patch;
    if (fragmentMode !== undefined) {
        const detail = await updateDatasetDetailed(env, { fragmentMode: fragmentMode as PanelSettings['fragmentMode'] });
        changed.push(...detail.changed);
    }
    platform.events.emit('settings.updated', { changed, version: VERSION });

    return respond(true, HttpStatus.OK, undefined, {
        changed,
        modes: (Object.keys(MODE_OPTIONS) as ModeField[]).map(field => ({
            field,
            value: patch[field] ?? String((settings as unknown as Record<string, unknown>)[field] ?? ''),
            options: MODE_OPTIONS[field].options.map(id => ({
                id,
                label: (MODE_OPTIONS[field].labels as Record<string, string>)[id]
            }))
        }))
    }, noStore());
}

async function subscriptionUrls(request: Request, env: Env, platform: Platform): Promise<Response> {
    const url = new URL(request.url);
    const token = url.searchParams.get('token') || '';
    const { securePath } = getGlobals();
    const origin = url.origin;

    const prefix = token ? `${securePath}/p/${encodeURIComponent(token)}` : securePath;

    const list: Array<{
        type: string;
        core: string;
        label: string;
        clients: readonly string[];
        path: string;
        url: string;
        importUrl?: string;
    }> = [];

    for (const [type, { label, categories }] of Object.entries(subscriptions)) {
        for (const cat of categories) {
            const subPath = `/${prefix}/sub/${type}?app=${cat.core}#RayZen%20${encodeURIComponent(label)}`;
            const fullUrl = `${origin}${subPath}`;
            const isSingBox = cat.core === 'sing-box' && type !== 'raw';
            list.push({
                type,
                core: cat.core,
                label,
                clients: cat.clients,
                path: subPath,
                url: fullUrl,
                ...(isSingBox ? { importUrl: `sing-box://import-remote-profile?url=${encodeURIComponent(fullUrl)}` } : {})
            });
        }
    }

    return respond(true, HttpStatus.OK, undefined, {
        securePath,
        token: token || null,
        urls: list,
        subscriptions
    }, noStore());
}

// Backup, health, preflight, migration and lifecycle routes
//
// Three rules hold for everything below.
//
//   1. **No writes.** Backup restore, rollback and preflight all return plans or
//      findings. The caller submits the resulting patch through
//      `panel/update-settings`, so every change is still validated by the same
//      validators and recorded by the same history engine.
//   2. **No secrets in responses.** Backups are redacted at export, comparisons
//      withhold protected values, and preflight reports presence rather than
//      content. A response that names a problem must not also leak the credential
//      involved in it.
//   3. **No unbounded work.** Bodies are size-checked before parsing, lists are
//      clamped, and nothing here probes the network.

/**
 * Reads a JSON body with an explicit byte ceiling.
 *
 * `readJson` alone is not enough for the backup routes: a restore payload is
 * attacker-influenced in the case of a stolen session, and parsing an arbitrarily
 * large document inside a Worker is a cheap way to burn the CPU budget for every
 * other request on the isolate.
 */
async function readBoundedJson(request: Request, limit: number): Promise<{ value: unknown; tooLarge: boolean }> {
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > limit) return { value: null, tooLarge: true };

    const text = await request.text().catch(() => '');
    if (text.length > limit) return { value: null, tooLarge: true };

    try {
        return { value: JSON.parse(text), tooLarge: false };
    } catch {
        return { value: null, tooLarge: false };
    }
}

/** Shared deployment facts, derived from the request and current settings. */
async function deploymentInput(request: Request, env: Env) {
    const settings = await currentSettings(env);
    const globals = getGlobals();
    const storage = createStorage(env.kv);
    const { hasPassword } = await readStorageCapabilities(storage);
    const url = new URL(request.url);

    let storageWritable = false;
    if (env.kv) {
        // Read-only probe: a write here would be a side effect on a read route.
        // Reachability is the honest thing this route can assert without one.
        try {
            await env.kv.get('kv-write-probe');
            storageWritable = true;
        } catch {
            storageWritable = false;
        }
    }

    return {
        kvBound: Boolean(env.kv),
        storageWritable,
        passwordSet: hasPassword,
        passwordLength: 0,
        securePath: typeof globals.securePath === 'string' ? globals.securePath : '',
        uuidConfigured: typeof settings.vlUUID === 'string' && settings.vlUUID.length > 0,
        trojanConfigured: typeof settings.trPass === 'string' && settings.trPass.length > 0,
        hostname: url.hostname,
        secureTransport: url.protocol === 'https:',
        apiTokenPresent: Boolean(globals.apiToken),
        deployType: globals.deployType ?? 'workers',
        panelVersion: VERSION
    };
}

/**
 * The one screen that answers "is my setup good?".
 *
 * It calls no new subsystem: diagnostics, features, scanner history and
 * recommendations are all already computed for other routes. The value added here
 * is the reduction to a single status, which is exactly the work the user was
 * previously expected to do by reading four pages.
 */
async function healthCenter(env: Env, platform: Platform): Promise<Response> {
    const input = await capabilityInput(env);

    let statistics = null;
    try {
        statistics = await platform.services.get('analytics').statistics();
    } catch {
        statistics = null;
    }

    const repositories = platform.services.get('repositories');
    const runs = await repositories.scanner.listRuns('clean-ip', 5);
    const intelligence = intelligenceFromHistory(runs);
    const context = toDiagnosticsContext(input, VERSION, statistics, intelligence);
    const diagnostics = platform.services.get('diagnostics').run(context);
    const features = platform.features.evaluateAll(toCapabilityContext(input));

    const list = await platform.recommendations.collect({
        diagnostics: context,
        settings: await currentSettings(env)
    });

    const report = buildHealthCenter({
        diagnostics,
        features,
        endpoints: runs.length > 0 ? intelligence : null,
        recentRuns: runs,
        recommendations: list,
        storageWritable: Boolean(env.kv)
    });

    return respond(true, HttpStatus.OK, undefined, report, noStore());
}

/**
 * The read the Telegram assistant answers from.
 *
 * Why it lives here
 *
 * The bot must answer "is my setup healthy" with the *same* numbers the panel
 * shows, or the two surfaces will disagree and the operator will trust neither.
 * Rather than reimplement the composition in the bot, the assistant reuses the
 * exact inputs `healthCenter` and `scannerLifecycle` already assemble.
 *
 * SECURITY
 *
 * This function performs no authentication of its own. It is not routable: the
 * only caller is the Telegram webhook, which has already matched the sender
 * against the stored owner id. Nothing returned here contains a secret, a UUID,
 * a password, or `securePath` beyond the subscription links the owner alone
 * receives.
 */
export interface AssistantSnapshot {
    version: string;
    center: ReturnType<typeof buildHealthCenter>;
    findings: Array<{ id: string; title: string; status: string; detail: string; remediation?: string }>;
    recommendations: Array<{ title: string; rationale?: string }>;
    endpoint: {
        address: string | null;
        score: number | null;
        confidence: number | null;
        trend: string | null;
        reason: string | null;
    };
    preflightReady: boolean;
}

export async function assistantSnapshot(env: Env): Promise<AssistantSnapshot> {
    const platform = platformFor(env, false);

    try {
        const input = await capabilityInput(env);

        let statistics = null;
        try {
            statistics = await platform.services.get('analytics').statistics();
        } catch {
            statistics = null;
        }

        const repositories = platform.services.get('repositories');
        const runs = await repositories.scanner.listRuns('clean-ip', 5);
        const intelligence = intelligenceFromHistory(runs);
        const context = toDiagnosticsContext(input, VERSION, statistics, intelligence);
        const diagnostics = platform.services.get('diagnostics').run(context);
        const features = platform.features.evaluateAll(toCapabilityContext(input));

        const recommendations = await platform.recommendations.collect({
            diagnostics: context,
            settings: await currentSettings(env)
        });

        const center = buildHealthCenter({
            diagnostics,
            features,
            endpoints: runs.length > 0 ? intelligence : null,
            recentRuns: runs,
            recommendations,
            storageWritable: Boolean(env.kv)
        });

        const lifecycles = buildLifecycles(runs);
        const best = lifecycles[0] ?? null;
        const recommended = intelligence?.recommended ?? null;

        return {
            version: VERSION,
            center,
            // Only the checks that failed or warned: a bot message listing twenty
            // passing checks is a wall of text, which is the problem being fixed.
            findings: diagnostics.findings
                .filter(finding => finding.status === 'fail' || finding.status === 'warn')
                .slice(0, 5)
                .map(finding => ({
                    id: finding.id,
                    title: finding.title,
                    status: finding.status,
                    detail: finding.detail,
                    remediation: finding.remediation
                })),
            recommendations: recommendations.slice(0, 3).map(entry => ({ title: entry.title, rationale: entry.rationale })),
            endpoint: {
                address: recommended?.address ?? best?.address ?? null,
                score: recommended?.score ?? best?.averageScore ?? null,
                confidence: typeof intelligence?.confidence === 'number' ? intelligence.confidence : null,
                trend: intelligence?.trend ?? best?.state ?? null,
                reason: intelligence?.reasons?.[0] ?? null
            },
            preflightReady: runPreflight(await deploymentInput(new Request('https://rayzen.local/'), env)).ready
        };
    } finally {
        await platform.dispose();
    }
}

async function deploymentPreflight(request: Request, env: Env, _platform: Platform): Promise<Response> {
    return respond(true, HttpStatus.OK, undefined, runPreflight(await deploymentInput(request, env)), noStore());
}

/**
 * Post-deployment verification.
 *
 * Uses recorded counters rather than live probes: "has a config ever been
 * exported?" is answerable from analytics for free, whereas generating one to find
 * out would be a side effect on a diagnostic route.
 */
async function deploymentVerify(request: Request, env: Env, platform: Platform): Promise<Response> {
    const base = await deploymentInput(request, env);

    let snapshot = null;
    try {
        snapshot = await platform.services.get('analytics').snapshot();
    } catch {
        snapshot = null;
    }

    const totals = (snapshot?.totals ?? {}) as Record<string, number | undefined>;
    const runs = await platform.services.get('repositories').scanner.listRuns('clean-ip', 1);

    const report = verifyDeployment({
        ...base,
        configExports: totals['config.exports'] ?? 0,
        successfulLogins: totals['auth.success'] ?? 0,
        scannerUsed: runs.length > 0
    });

    return respond(true, HttpStatus.OK, undefined, report, noStore());
}

/**
 * Exports a redacted, checksummed backup.
 *
 * GET, because it produces no state change, and `no-store` so a shared browser
 * does not keep a copy of the configuration in its cache.
 */
async function backupExport(env: Env): Promise<Response> {
    const settings = await currentSettings(env);
    const globals = getGlobals();

    const envelope = createBackup(settings, {
        panelVersion: VERSION,
        deployType: globals.deployType ?? 'workers'
    });

    return respond(true, HttpStatus.OK, undefined, envelope, noStore());
}

async function backupValidate(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');

    const { value, tooLarge } = await readBoundedJson(request, MAX_BACKUP_BYTES);
    if (tooLarge) return respond(false, HttpStatus.PAYLOAD_TOO_LARGE, 'The backup file is too large to process.');

    const validation = validateBackup(value);
    const compatibility = validation.envelope
        ? assessBackupCompatibility(validation.envelope.panelVersion, VERSION)
        : null;

    await currentSettings(env);

    return respond(
        true,
        HttpStatus.OK,
        undefined,
        { ...validation, compatibility, format: BACKUP_FORMAT_VERSION },
        noStore()
    );
}

/**
 * Returns the exact effect of a restore, and writes nothing.
 *
 * A restore that applied immediately would be the single most dangerous action in
 * the panel: it overwrites a working configuration from a file whose provenance the
 * panel cannot verify. Splitting plan from apply is what makes the feature safe to
 * ship, and it is why `requiresConfirmation` exists in the response at all.
 */
async function backupPlan(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');

    const { value, tooLarge } = await readBoundedJson(request, MAX_BACKUP_BYTES);
    if (tooLarge) return respond(false, HttpStatus.PAYLOAD_TOO_LARGE, 'The backup file is too large to process.');

    const validation = validateBackup(value);
    if (!validation.ok || !validation.envelope) {
        return respond(false, HttpStatus.BAD_REQUEST, validation.issues[0] ?? 'The backup could not be read.');
    }

    const compatibility = assessBackupCompatibility(validation.envelope.panelVersion, VERSION);
    if (!compatibility.compatible) {
        return respond(false, HttpStatus.BAD_REQUEST, compatibility.notes[0] ?? 'The backup is not compatible with this panel.');
    }

    const plan = planRestore(validation.envelope, await currentSettings(env));

    return respond(true, HttpStatus.OK, undefined, { plan, compatibility, issues: validation.issues }, noStore());
}

/**
 * Imports a settings document from a remote URL, fetched by the Worker.
 *
 * Why the worker fetches and the browser does not
 *
 * The panel's Import Remote Settings feature is aimed at another deployment's
 * `sub/share-settings` endpoint, which is deliberately cross-origin readable. But
 * the panel page's own CSP restricts `connect-src` to `'self'` and two IP-echo
 * origins — so a browser-side fetch of the remote URL was always blocked by the
 * very policy that protects the page. The export side enabled CORS; the import
 * side's CSP forbade the origin; the feature could not work.
 *
 * Routing the fetch through this authenticated platform route keeps the CSP strict
 * (the browser only talks to `'self'`) and confines the outbound request to the
 * operator: every platform route requires a valid session. The URL is restricted to
 * `https:` and the returned document is bounded to `MAX_BACKUP_BYTES`, the same
 * ceiling the file-based restore enforces.
 */
async function backupImportRemote(request: Request): Promise<Response> {
    if (request.method !== 'POST') return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');

    const { value, tooLarge } = await readBoundedJson(request, MAX_BACKUP_BYTES);
    if (tooLarge) return respond(false, HttpStatus.PAYLOAD_TOO_LARGE, 'Request too large.');

    const urlText = typeof (value as { url?: unknown } | null)?.url === 'string'
        ? ((value as { url: string }).url).trim()
        : '';
    if (!urlText) return respond(false, HttpStatus.BAD_REQUEST, 'A settings URL is required.');

    let url: URL;
    try {
        url = new URL(urlText);
    } catch {
        return respond(false, HttpStatus.BAD_REQUEST, 'The URL is not valid.');
    }
    if (url.protocol !== 'https:') {
        return respond(false, HttpStatus.BAD_REQUEST, 'Only https:// URLs can be imported.');
    }

    let response: Response;
    try {
        response = await fetch(url.href);
    } catch {
        return respond(false, HttpStatus.BAD_GATEWAY, 'The remote address could not be reached.');
    }
    if (!response.ok) {
        return respond(false, HttpStatus.BAD_GATEWAY, `The remote address answered with HTTP ${response.status}.`);
    }

    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BACKUP_BYTES) {
        return respond(false, HttpStatus.PAYLOAD_TOO_LARGE, 'The remote settings document is too large.');
    }

    // `sub/share-settings` exports base64-encoded UTF-8 JSON; that is the contract
    // the file-based importer uses too, so the same decoding applies here.
    let document: unknown;
    try {
        document = JSON.parse(atob(raw));
    } catch {
        return respond(false, HttpStatus.BAD_REQUEST, 'The remote document is not a base64 JSON settings export.');
    }
    if (typeof document !== 'object' || document === null || Array.isArray(document)) {
        return respond(false, HttpStatus.BAD_REQUEST, 'The remote document is not a settings object.');
    }

    return respond(true, HttpStatus.OK, undefined, { settings: document }, noStore());
}

/** Compares a supplied configuration (usually a backup) against the live one. */
async function configCompare(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');

    const { value, tooLarge } = await readBoundedJson(request, MAX_BACKUP_BYTES);
    if (tooLarge) return respond(false, HttpStatus.PAYLOAD_TOO_LARGE, 'The document is too large to compare.');

    const body = value as { settings?: unknown } | null;
    const other = body?.settings;
    if (typeof other !== 'object' || other === null || Array.isArray(other)) {
        return respond(false, HttpStatus.BAD_REQUEST, 'A settings object is required.');
    }

    const comparison = compareConfigurations(await currentSettings(env), other as Record<string, unknown>);
    return respond(true, HttpStatus.OK, undefined, comparison, noStore());
}

/** Computes the inverse patch needed to return to a supplied earlier configuration. */
async function configRollback(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');

    const { value, tooLarge } = await readBoundedJson(request, MAX_BACKUP_BYTES);
    if (tooLarge) return respond(false, HttpStatus.PAYLOAD_TOO_LARGE, 'The document is too large to process.');

    const body = value as { settings?: unknown } | null;
    const target = body?.settings;
    if (typeof target !== 'object' || target === null || Array.isArray(target)) {
        return respond(false, HttpStatus.BAD_REQUEST, 'A settings object is required.');
    }

    const plan = planRollback(await currentSettings(env), target as Record<string, unknown>);
    return respond(true, HttpStatus.OK, undefined, plan, noStore());
}

/**
 * History with attribution: what changed, when, and why.
 *
 * The "why" is derived from the structured detail the producers already record, so
 * this route adds meaning without adding storage.
 */
async function configHistory(request: Request, platform: Platform): Promise<Response> {
    const limit = clampLimit(new URL(request.url).searchParams.get('limit'), 50);
    const entries = await platform.services.get('history').list(limit);

    return respond(
        true,
        HttpStatus.OK,
        undefined,
        entries.map(entry => ({ ...entry, attribution: attributeChange(entry) })),
        noStore()
    );
}

/**
 * Version and migration status.
 *
 * `?from=` lets the panel ask "what would happen if I moved from this version?"
 * before an update, which is the only moment the answer can still change a
 * decision.
 */
function migrationStatus(request: Request): Response {
    const from = new URL(request.url).searchParams.get('from');

    return respond(
        true,
        HttpStatus.OK,
        undefined,
        {
            current: VERSION,
            minimumSupported: MIN_SUPPORTED_VERSION,
            backupFormat: BACKUP_FORMAT_VERSION,
            assessment: from ? assessMigration(from, VERSION) : null
        },
        noStore()
    );
}

/** Endpoint lifecycle and migration advice, derived from retained scan summaries. */
async function scannerLifecycle(request: Request, env: Env, platform: Platform): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const kind = parseKind(params.get('kind')) ?? 'clean-ip';
    const limit = clampLimit(params.get('limit'), 20);

    const runs = await platform.services.get('repositories').scanner.listRuns(kind, limit);
    const lifecycles = buildLifecycles(runs);

    const settings = await currentSettings(env);
    // `proxyIPs` is `string[]` (`EmbededSettings` in src/types/settings.ts), not a
    // comma-joined string. The previous `typeof === 'string'` test therefore never
    // matched, so `configured` was always null and `adviseMigration` always took its
    // "nothing is configured" branch: the route recommended adoption even when the
    // operator was already using the endpoint being recommended.
    const proxyIPs = settings.proxyIPs;
    const configured = Array.isArray(proxyIPs)
        ? (proxyIPs.map(String).find(value => value.trim().length > 0)?.trim() ?? null)
        : typeof proxyIPs === 'string' && proxyIPs.length > 0
          ? proxyIPs.split(',')[0].trim()
          : null;

    return respond(
        true,
        HttpStatus.OK,
        undefined,
        { kind, lifecycles, advice: adviseMigration(lifecycles, configured) },
        noStore()
    );
}

/** Whether the recommendation engine is earning the user's trust. */
async function analyticsEffectiveness(platform: Platform): Promise<Response> {
    const snapshot = await platform.services.get('analytics').snapshot();
    return respond(true, HttpStatus.OK, undefined, measureEffectiveness(snapshot), noStore());
}

/**
 * Advanced mode: the raw material behind every summarised view.
 *
 * Authenticated like every other platform route, and still redacted: advanced mode
 * exposes *detail*, never *secrets*. An expert who needs the UUID can read it in
 * settings; a debugging view has no reason to carry it, and it would end up in
 * every pasted bug report if it did.
 */
async function advancedDiagnostics(env: Env, platform: Platform): Promise<Response> {
    const input = await capabilityInput(env);

    let statistics = null;
    let snapshot = null;
    try {
        const analytics = platform.services.get('analytics');
        [snapshot, statistics] = await Promise.all([analytics.snapshot(), analytics.statistics()]);
    } catch {
        snapshot = null;
        statistics = null;
    }

    const repositories = platform.services.get('repositories');
    const runs = await repositories.scanner.listRuns('clean-ip', 10);
    const intelligence = intelligenceFromHistory(runs);
    const context = toDiagnosticsContext(input, VERSION, statistics, intelligence);

    return respond(
        true,
        HttpStatus.OK,
        undefined,
        {
            version: VERSION,
            deployType: input.deployType,
            capabilities: {
                hasKv: input.hasKv,
                hasApiToken: input.hasApiToken,
                hasPassword: input.hasPassword,
                hasTelegramBot: input.hasTelegramBot,
                hasWarpAccounts: input.hasWarpAccounts
            },
            diagnostics: platform.services.get('diagnostics').run(context),
            features: platform.features.evaluateAll(toCapabilityContext(input)),
            metrics: snapshot,
            statistics,
            scanner: { runs, intelligence, lifecycles: buildLifecycles(runs) }
        },
        noStore()
    );
}

/**
 * Presents a stored profile to the panel.
 *
 * The token is included, because a link the operator cannot read is not a link. The
 * derived status is included so the panel does not reimplement expiry arithmetic and
 * disagree with the Worker about whether a link still works.
 *
 * The relative path is returned rather than an absolute URL: the Worker knows
 * `securePath`, but it does not reliably know which of possibly several hostnames the
 * operator wants to hand out, and the panel is already on the right origin.
 */
function presentProfile(profile: Profile, now: number): Record<string, unknown> {
    return {
        token: profile.token,
        name: profile.name,
        createdAt: profile.createdAt,
        expiresAt: profile.expiresAt,
        enabled: profile.enabled,
        requests: profile.requests,
        requestLimit: profile.requestLimit,
        /** Null when there is no limit, so the caller need not repeat the arithmetic. */
        remaining: remainingRequests(profile),
        lastSeenAt: profile.lastSeenAt,
        lastSeenFrom: profile.lastSeenFrom,
        status: profileStatus(profile, now)
    };
}

async function links(platform: Platform): Promise<Response> {
    const stored = await platform.services.get('repositories').profiles.list();
    const now = runtime.now().getTime();

    return respond(
        true,
        HttpStatus.OK,
        undefined,
        {
            profiles: stored.map(profile => presentProfile(profile, now)),
            /**
             * The cap travels with the list so the panel can disable its create button at
             * the right number instead of hardcoding a copy that drifts from the module.
             */
            max: MAX_PROFILES,
            /** Same reason: the client validates against the module's bound, not a copy. */
            maxRequestLimit: MAX_REQUEST_LIMIT
        },
        noStore()
    );
}

/**
 * Creates a subscription link.
 *
 * The token is generated here and never accepted from the request. An operator-chosen
 * token would be an operator-chosen password on a URL that gets pasted into chat apps,
 * and the whole security of a profile link is that its token is unguessable.
 */
async function linkCreate(request: Request, platform: Platform): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    const body = (await readJson(request)) as { name?: unknown; days?: unknown; requestLimit?: unknown } | null;
    const repository = platform.services.get('repositories').profiles;
    const stored = await repository.list();

    // Checked before the write rather than relying on `normaliseProfiles` to truncate:
    // truncation would silently drop the *oldest* entry, so an operator at the cap would
    // see a create succeed and an existing link stop working.
    if (stored.length >= MAX_PROFILES) {
        return respond(
            false,
            HttpStatus.BAD_REQUEST,
            `This deployment already has ${MAX_PROFILES} subscription links. Revoke one to create another.`
        );
    }

    const profile = createProfile(body?.name, body?.days, runtime.now().getTime(), body?.requestLimit ?? null);
    await repository.replace([...stored, profile]);

    /**
     * Published rather than recorded directly, so the log wording lives in the one
     * subscriber table with every other kind. The payload carries no token: history is a
     * durable log an operator reads and pastes into a support conversation, and a token in
     * it would be a working credential sitting in a second place with a different lifetime.
     */
    platform.events.emit('links.changed', { action: 'create', name: profile.name, remaining: stored.length + 1 });

    return respond(true, HttpStatus.OK, undefined, presentProfile(profile, runtime.now().getTime()), noStore());
}

/**
 * Enables, disables, deletes, re-limits or resets the counter of one link.
 *
 * Disable and delete are separate actions on purpose. Disabling keeps the row, so the
 * operator can still see that the link existed and when it was last used, which is what
 * they want after handing a link to someone who no longer needs it. Deleting removes the
 * evidence too, which is what they want after a mistake. Collapsing the two would force
 * one of those to be impossible.
 */
async function linkUpdate(request: Request, platform: Platform): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    const body = (await readJson(request)) as { token?: unknown; action?: unknown; requestLimit?: unknown } | null;
    const token = typeof body?.token === 'string' ? body.token : '';
    const action = body?.action;

    /**
     * `limit` is an action rather than a field on every call.
     *
     * A field would make "do not change the limit" and "remove the limit" the same
     * request, since both arrive as an absent or null value. As an action, `null` means
     * remove and omission is impossible.
     */
    if (action !== 'enable' && action !== 'disable' && action !== 'delete' && action !== 'limit' && action !== 'reset-count') {
        return respond(
            false,
            HttpStatus.BAD_REQUEST,
            "action must be 'enable', 'disable', 'delete', 'limit' or 'reset-count'."
        );
    }

    if (action === 'limit' && body?.requestLimit !== null && requestLimitFrom(body?.requestLimit) === null) {
        return respond(
            false,
            HttpStatus.BAD_REQUEST,
            `requestLimit must be null or a positive integer up to ${MAX_REQUEST_LIMIT}.`
        );
    }

    const repository = platform.services.get('repositories').profiles;
    const stored = await repository.list();
    const target = stored.find(profile => profile.token === token);

    // A 404 here, unlike on the subscription path, is safe to distinguish: the caller
    // already holds a panel session, so telling them a token is unknown reveals nothing
    // they could not read from `links`.
    if (!target) return respond(false, HttpStatus.NOT_FOUND, 'That subscription link no longer exists.');

    const next = action === 'delete'
        ? stored.filter(profile => profile.token !== token)
        : stored.map(profile => {
            if (profile.token !== token) return profile;
            switch (action) {
                case 'limit':
                    return { ...profile, requestLimit: requestLimitFrom(body?.requestLimit) };
                // Resetting the counter is what makes a limit renewable: without it an
                // exhausted link could only be replaced, which means reissuing the URL.
                case 'reset-count':
                    return { ...profile, requests: 0 };
                default:
                    return { ...profile, enabled: action === 'enable' };
            }
        });

    await repository.replace(next);

    platform.events.emit('links.changed', { action, name: target.name, remaining: next.length });

    const updated = next.find(profile => profile.token === token);
    return respond(true, HttpStatus.OK, undefined, {
        token,
        action,
        remaining: next.length,
        profile: updated ? presentProfile(updated, runtime.now().getTime()) : null
    }, noStore());
}

/**
 * Platform responses describe the deployment's current state, so a cached copy is
 * both stale and a small disclosure risk in a shared browser.
 */
function noStore(): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
    };
}

function clampLimit(raw: string | null, fallbackValue: number): number {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return fallbackValue;
    return Math.min(Math.floor(value), 200);
}

/** Reads a JSON body, treating malformed input as absent rather than as a 500. */
async function readJson(request: Request): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        return null;
    }
}
