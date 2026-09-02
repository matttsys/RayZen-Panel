/**
 * Device-side scan routes.
 *
 * Two endpoints and a page, all under the panel's secret path and all requiring a
 * session:
 *
 *   - `scan/frame`   the sandboxed measurement document
 *   - `scan/plan`    the candidate list for a requested depth
 *   - `scan/record`  the results the frame produced, scored and persisted
 *
 * The division of labour is deliberate. The browser measures, because only the browser
 * is on the operator's network. The Worker chooses *what* to measure and decides what
 * the numbers mean, because both of those are policy and belong where they can be
 * tested and where the history lives.
 *
 * Why `record` re-derives the score
 *
 * The frame reports raw timings and nothing else. Scoring in the page would mean the
 * ranking rules live in minified browser code, cannot be unit-tested, and could be
 * altered by anyone who can edit a request. So the page sends measurements and the
 * Worker scores them.
 */
import { HttpStatus, decompressGzipBase64, respond } from '@common';
import { authenticate } from '@auth';
import { getGlobals } from '@settings';
import { fallback } from './utils';
import {
    MAX_CANDIDATES,
    SCAN_DEPTHS,
    blockOf,
    buildCandidates,
    isCloudflareAddress,
    type ScanDepth
} from '@features/scanner/candidates';
import { scoreDeviceResults, type DeviceMeasurement } from '@features/scanner/device';
import { createPlatform } from '@platform/context';
import {
    describeLearning,
    learnBlocks,
    preferredBlocks,
    type BlockKnowledge
} from '@features/scanner/blocks';
import { buildOptimizationPlan } from '@features/scanner/optimize';
import { toDiagnosticsContext } from '@platform/capability';
import { capabilityInput } from '@api/platform';
import { safeError } from '@common';

const MAX_BODY_BYTES = 256 * 1024;

/**
 * Wall-clock cost per address, measured end to end in a browser against live Cloudflare
 * space: 200 addresses, 67 of them reachable, at concurrency 16. Used for the estimate
 * the panel shows before a scan starts.
 */
const MS_PER_ADDRESS = 70;

export async function handleScan(request: Request, env: Env): Promise<Response> {
    const { pathname } = getGlobals();

    // Same gate as the panel: this is an authenticated feature that names the
    // deployment's own address space and stores history against it.
    const auth = await authenticate(request, env);
    if (!auth) return respond(false, HttpStatus.UNAUTHORIZED, 'Sign in first.');

    const path = pathname.split('/').slice(2).join('/');

    switch (path) {
        case 'scan/frame':
            return renderFrame();

        case 'scan/plan':
            return plan(request, env);

        case 'scan/record':
            return record(request, env);

        case 'scan/optimize':
            return optimize(env);

        default:
            return fallback(request);
    }
}

async function renderFrame(): Promise<Response> {
    const html = await decompressGzipBase64(PROBE_HTML_CONTENT);

    return new Response(html, {
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            // Never cached. The frame's whole job is to be the one document with a
            // permissive connect-src, so a stale copy surviving a security fix is not
            // an acceptable outcome.
            'Cache-Control': 'no-store'
        }
    });
}

interface PlanBody {
    depth?: unknown;
    seed?: unknown;
}

async function plan(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    let body: PlanBody = {};
    try {
        const parsed: unknown = JSON.parse(await request.text());
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as PlanBody;
    } catch {
        return respond(false, HttpStatus.BAD_REQUEST, 'Malformed JSON request body.');
    }

    const depth: ScanDepth = body.depth === 'deep' ? 'deep' : 'quick';
    const seed = Number.isFinite(Number(body.seed)) ? Number(body.seed) >>> 0 : Date.now() >>> 8;

    // Learned history biases the head of the scan. Read on the plan path rather than
    // cached, because it changes only when a scan is recorded and the read is one KV
    // hit against a run the operator is about to wait seconds for.
    let learned: BlockKnowledge[] = [];
    const platform = createPlatform(env.kv);
    try {
        const observations = await platform.services.get('repositories').scanner.listBlocks();
        learned = learnBlocks(observations, Date.now());
    } catch {
        // No history, or an unreadable document. Either way the scan proceeds with an
        // even sample, which is exactly what a first scan does.
        learned = [];
    } finally {
        await platform.dispose().catch(() => undefined);
    }

    const candidates = buildCandidates({ depth, seed, preferredBlocks: preferredBlocks(learned) });

    return respond(true, HttpStatus.OK, undefined, {
        depth,
        seed,
        count: candidates.length,
        addresses: candidates.map(candidate => candidate.address),
        /** What past scans taught, so the panel can say why it is starting where it is. */
        learning: {
            summary: describeLearning(learned),
            blocks: learned.slice(0, 8).map(entry => ({
                block: entry.block,
                score: entry.score,
                latency: entry.latency,
                observations: entry.observations,
                days: entry.days,
                confidence: entry.confidence,
                trend: entry.trend
            }))
        },
        // Measured, not guessed, and corrected once already: the first estimate assumed
        // every address answers quickly and put a 200-address scan at 7 seconds when a
        // live run took 54. The cost is dominated by addresses that never answer, which
        // pay the full timeout, and on a filtered network that is most of the sample.
        //
        // With the frame retrying only addresses that responded, a 200-address scan
        // measured about 13 seconds. `MS_PER_ADDRESS` is that rate; it is deliberately
        // pessimistic, because an estimate that runs under is a pleasant surprise and one
        // that runs over reads as a hang.
        estimateSeconds: Math.max(1, Math.round((candidates.length * MS_PER_ADDRESS) / 1000))
    }, { 'Cache-Control': 'no-store' });
}

interface RecordBody {
    depth?: unknown;
    results?: unknown;
    elapsed?: unknown;
    stopped?: unknown;
    control?: unknown;
}

/**
 * Accepts measurements, scores them, and persists a summary.
 *
 * Every value is validated rather than trusted. Not because the operator is an
 * adversary, but because this is an authenticated endpoint whose body determines what
 * the panel will later recommend: a result naming an address outside Cloudflare space
 * would produce a recommendation pointing somewhere else entirely.
 */
async function record(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
        return respond(false, HttpStatus.PAYLOAD_TOO_LARGE, 'Request body is too large.');
    }

    let body: RecordBody;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
        body = parsed as RecordBody;
    } catch {
        return respond(false, HttpStatus.BAD_REQUEST, 'Malformed JSON request body.');
    }

    const measurements = toMeasurements(body.results);
    if (!measurements.length) {
        return respond(false, HttpStatus.BAD_REQUEST, 'No usable measurements were supplied.');
    }

    const depth: ScanDepth = body.depth === 'deep' ? 'deep' : 'quick';
    const scored = scoreDeviceResults(measurements);

    let learning: { summary: string; blocks: unknown[] } = { summary: '', blocks: [] };
    const platform = createPlatform(env.kv);
    try {
        // Only the blocks worth learning from: those with at least two measured
        // addresses and one that answered. A block where a single address answered once
        // is noise, and storing 900 of those per Deep scan would fill the document
        // without teaching anything.
        const worthKeeping = scored.blocks
            .filter(block => block.measured >= 2 && block.reachable >= 1 && block.medianScore !== null)
            .slice(0, 12)
            .map(block => ({
                block: block.block,
                at: Date.now(),
                medianScore: block.medianScore as number,
                medianLatency: block.medianLatency ?? 0,
                reachable: block.reachable,
                measured: block.measured
            }));
        const scanner = platform.services.get('repositories').scanner;
        await scanner.recordBlocks(worthKeeping);

        // Read back *after* writing, so the summary includes the scan just recorded. The
        // repository serves this from its in-memory document, so it costs no extra read.
        const knowledge = learnBlocks(await scanner.listBlocks(), Date.now());
        learning = {
            summary: describeLearning(knowledge),
            blocks: knowledge.slice(0, 8).map(entry => ({
                block: entry.block,
                score: entry.score,
                latency: entry.latency,
                observations: entry.observations,
                days: entry.days,
                confidence: entry.confidence,
                trend: entry.trend
            }))
        };
        await platform.services.get('repositories').scanner.recordRun({
            id: `dev-${Date.now().toString(36)}`,
            at: Date.now(),
            // Recorded under `clean-ip`, which is what these are: candidate edge
            // addresses for the subscription's CDN field. The Worker-side scanner uses
            // `proxy-ip` and `warp-endpoint`, so the two never overwrite each other.
            kind: 'clean-ip',
            targets: scored.results.length,
            healthy: scored.results.filter(result => result.score > 0).length,
            // The winner's own latency, stored here because this is the only point at
            // which it exists. Recovering it afterwards from block aggregates was tried
            // and produced evidence citing one address's score beside another's latency.
            best: scored.best
                ? {
                      address: scored.best.address,
                      score: scored.best.score,
                      ...(scored.best.latency === null ? {} : { latencyMs: Math.round(scored.best.latency) })
                  }
                : null,
            medianScore: scored.medianScore
        });
        await platform.dispose();
    } catch {
        // History is derived data. Failing the request because it could not be stored
        // would throw away a scan the operator waited half a minute for.
        await platform.dispose().catch(() => undefined);
    }

    return respond(true, HttpStatus.OK, undefined, {
        depth,
        elapsed: Number.isFinite(Number(body.elapsed)) ? Number(body.elapsed) : null,
        stopped: body.stopped === true,
        // The accumulated view, including this scan. Returned alongside the run's own
        // results so the panel can show both without a second round trip, and so the
        // difference between "this scan" and "across scans" is visible on one screen.
        learning,
        ...scored
    }, { 'Cache-Control': 'no-store' });
}

/**
 * Validates the frame's report into measurements.
 *
 * Anything that is not a Cloudflare address is dropped rather than rejected: a stopped
 * scan legitimately reports fewer results than requested, and rejecting the whole batch
 * for one bad row would lose the rest.
 */
function toMeasurements(value: unknown): DeviceMeasurement[] {
    if (!Array.isArray(value)) return [];

    const out: DeviceMeasurement[] = [];
    for (const entry of value.slice(0, MAX_CANDIDATES)) {
        if (!entry || typeof entry !== 'object') continue;
        const row = entry as Record<string, unknown>;
        const address = typeof row.address === 'string' ? row.address.trim() : '';
        if (!isCloudflareAddress(address)) continue;

        const block = blockOf(address);
        if (!block) continue;

        const latency = Number(row.latency);
        const success = Number(row.success);
        const jitter = Number(row.jitter);

        out.push({
            address,
            block,
            latency: Number.isFinite(latency) && latency >= 0 ? latency : null,
            success: Number.isFinite(success) ? Math.min(1, Math.max(0, success)) : 0,
            jitter: Number.isFinite(jitter) && jitter >= 0 ? jitter : 0,
            // An address that answered with a *response* rather than a refused
            // handshake was intercepted by something on the path. Carried through so
            // scoring can discount it.
            answered: Number.isFinite(Number(row.answered)) ? Number(row.answered) : 0
        });
    }
    return out;
}

export { SCAN_DEPTHS };


/**
 * Builds the "Optimize My Connection" plan.
 *
 * Everything it needs already exists: learned block knowledge from device scans,
 * diagnostics findings derived from the real settings, and the settings themselves. The
 * assembly is here so the recommendation rules stay in one testable module, and the
 * diagnostics context is built by the same helper the health view uses rather than by a
 * second hand-written copy that could drift from it.
 */
async function optimize(env: Env): Promise<Response> {
    const platform = createPlatform(env.kv);

    try {
        const scanner = platform.services.get('repositories').scanner;
        const knowledge = learnBlocks(await scanner.listBlocks(), Date.now());

        // The most recent device run's best address: the one measurement with an effect
        // size attached.
        const runs = await scanner.listRuns('clean-ip', 1);
        const best = runs[0]?.best ?? null;

        // Latency comes from the winner's *own* block or not at all.
        //
        // Two wrong answers were tried first. Requiring the block to be present dropped
        // the recommendation on most runs, because only blocks with two or more measured
        // addresses are stored and a sample spread across ~190 distinct blocks usually
        // touches the winning one exactly once. Falling back to the best learned block's
        // median was worse: it produced "answered in 309ms, scoring 100 of 100", citing
        // one address's score against another's latency. A recommendation whose evidence
        // is wrong is more damaging than one that is missing.
        // Latency comes from the run summary, which recorded the winner's own
        // measurement. The block median is a fallback for summaries written before that
        // was stored, and only when it is the winner's own block: citing a different
        // block's latency beside this address's score would make the evidence wrong.
        const bestBlock = best ? knowledge.find(entry => entry.block === blockOf(best.address)) : undefined;
        const bestLatency = best?.latencyMs ?? bestBlock?.latency ?? null;

        const input = await capabilityInput(env);
        const context = toDiagnosticsContext(input, VERSION, null);
        const findings = platform.services.get('diagnostics').inspect(context);

        const plan = buildOptimizationPlan({
            blocks: knowledge,
            findings,
            settings: context.settings,
            bestAddress: best
                ? { address: best.address, latency: bestLatency, score: best.score }
                : null
        });

        return respond(true, HttpStatus.OK, undefined, plan, { 'Cache-Control': 'no-store' });
    } catch (error) {
        return respond(
            false,
            HttpStatus.INTERNAL_SERVER_ERROR,
            `Could not build an optimization plan: ${safeError(error)}`
        );
    } finally {
        await platform.dispose().catch(() => undefined);
    }
}
