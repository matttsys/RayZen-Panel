/**
 * Scanner service: the composition of probe, scoring, scheduling and history.
 *
 * What this is and is not
 *
 * The scanner was deliberately left out of the panel rewrite for a specific reason:
 * no scanning backend existed, so any UI would have been a fake feature, and the
 * placeholder route said so honestly. This module is the backend that makes the
 * route real, and it is built as a *platform* rather than as a collection of
 * scanning algorithms:
 *
 *   - The transport (`probe.ts`) measures TCP connect latency only.
 *   - The model (`scoring.ts`) is pure and replaceable.
 *   - Scheduling (`schedule.ts`) is a pure decision, not a cron job.
 *   - History is a bounded summary in KV, never the raw attempt list.
 *
 * The instruction for this phase was to build the architecture, services,
 * repositories, scoring, history and scheduling, and *not* every scanning
 * algorithm. That boundary is visible in the code: adding a probe kind means adding
 * a `ProbeConnector` and a target source, and nothing in this file changes.
 *
 * Why target sources are passed in
 *
 * The service does not know where candidate addresses come from. Clean IPs come
 * from settings, WARP endpoints come from settings, and a future generated list
 * would come from somewhere else again. A service that reached into settings would
 * couple the scanner to the settings shape and make every test build a settings
 * object.
 *
 * Why A run persists A summary and not the run
 *
 * A `ScanRun` holds every attempt for every target: 40 targets x 3 attempts is 120
 * records, which is both larger than a KV value should carry per run and more
 * detail than anyone reads later. `ScanRunSummary` keeps what a trend needs. The
 * full run is returned to the caller for immediate display and then discarded.
 */

import type {
    ScanRun,
    ScanRunSummary,
    ScanTarget,
    ScanTargetKind,
    ScheduleDecision,
    ScoredTarget,
    UnmeasurableTarget,
    EndpointIntelligence
} from '#types/platform';
import type { EventBus } from '@platform/events';
import type { ScannerRepository } from '@platform/repositories';
import { runtime } from '@runtime';
import { probeAll, PROBE_LIMITS, type ProbeDeps, type ProbeOptions } from './probe';
import { medianScore, rank, scoreResult } from './scoring';
import { explainUnmeasurable } from './cloudflare';
import { intelligenceFromHistory } from './intelligence';
import { clampInterval, decide, type ScheduleState } from './schedule';

/** Default connect port per target kind. */
const DEFAULT_PORT: Record<ScanTargetKind, number> = {
    'proxy-ip': 443,
    'clean-ip': 443,
    // WARP speaks WireGuard over UDP on 2408. A TCP connect there measures
    // reachability of the address, which is the useful signal a TCP-only runtime
    // can obtain; it is documented as a proxy metric rather than presented as a
    // WireGuard handshake.
    'warp-endpoint': 2408
};

export interface ScanRequest {
    kind: ScanTargetKind;
    /** Candidate addresses. Deduplicated and capped by the service. */
    addresses: readonly string[];
    attempts?: number;
    timeoutMs?: number;
}

export interface ScannerService {
    /** Probes, scores, ranks, persists a summary and emits events. */
    run(request: ScanRequest): Promise<ScanRun>;
    /** Scores and ranks without persisting. Used for a one-off manual check. */
    dryRun(request: ScanRequest): Promise<ScanRun>;
    /** Retained run summaries for a kind, newest first. */
    history(kind: ScanTargetKind, limit?: number): Promise<ScanRunSummary[]>;
    /** Whether a scheduled scan is due for a kind. */
    schedule(kind: ScanTargetKind, options: { enabled: boolean; intervalMs?: number }): Promise<ScheduleDecision>;
    /** Best target from the most recent run of a kind, or null. */
    best(kind: ScanTargetKind): Promise<{ address: string; score: number } | null>;
    /** Recommended endpoint, evidence confidence and degradation state. */
    intelligence(kind: ScanTargetKind): Promise<EndpointIntelligence>;
    /** Drops all scan history. Used by the panel reset path. */
    reset(): Promise<void>;
}

/**
 * Normalises and bounds the candidate list.
 *
 * Deduplication happens before the cap so a list with repeats does not waste run
 * slots, and trimming happens before deduplication so ` 1.2.3.4 ` and `1.2.3.4`
 * are one target.
 */
export function toTargets(addresses: readonly string[], kind: ScanTargetKind): ScanTarget[] {
    const seen = new Set<string>();
    const targets: ScanTarget[] = [];

    for (const raw of addresses) {
        const address = raw.trim();
        if (!address || seen.has(address)) continue;

        seen.add(address);
        targets.push({ address, kind });

        if (targets.length >= PROBE_LIMITS.maxTargetsPerRun) break;
    }

    return targets;
}

/** Builds the persisted summary from a completed run. */
export function summarise(run: ScanRun): ScanRunSummary {
    const healthy = run.ranked.filter(entry => entry.verdict === 'good' || entry.verdict === 'usable').length;
    const best = run.ranked[0] ?? null;

    return {
        id: run.id,
        at: run.at,
        kind: run.kind,
        // Unmeasurable candidates are still inputs the user supplied, so they belong in
        // the target total; dropping them would let "10 candidates" silently read as
        // "2 measured" with no account of the other eight.
        targets: run.ranked.length + run.dead + run.unmeasurable.length,
        healthy,
        unmeasurable: run.unmeasurable.length,
        best: best && best.verdict !== 'dead' ? { address: best.target.address, score: best.score } : null,
        medianScore: medianScore(run.ranked)
    };
}

/**
 * Run ids are time-plus-suffix for the same reason history entry ids are: two runs
 * inside one request would otherwise collide, and a UUID costs 36 characters
 * against a bounded KV value for uniqueness nobody needs beyond one deployment.
 */
function runId(at: number): string {
    const suffix = Math.floor(runtime.random() * 36 ** 4)
        .toString(36)
        .padStart(4, '0');

    return `${at.toString(36)}-${suffix}`;
}

export interface ScannerDeps {
    probe: ProbeDeps;
    repository: ScannerRepository;
    /** Optional: when present, probe and completion events are published. */
    events?: EventBus;
}

export function createScannerService(deps: ScannerDeps): ScannerService {
    const { probe, repository, events } = deps;

    const execute = async (request: ScanRequest): Promise<ScanRun> => {
        const targets = toTargets(request.addresses, request.kind);
        const at = runtime.now().getTime();

        const options: ProbeOptions = {
            defaultPort: DEFAULT_PORT[request.kind],
            ...(request.attempts === undefined ? {} : { attempts: request.attempts }),
            ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
        };

        const results = targets.length === 0 ? [] : await probeAll(probe, targets, options);
        const scored = results.map(scoreResult);

        // Three outcomes, not two. A target is ranked (it was measured), dead (it was
        // measured and failed every attempt), or unmeasurable (the runtime refused to
        // probe it). Unmeasurable is not a failure and must never be counted as one:
        // it is surfaced separately with a Problem/Impact/Cause/Solution explanation so
        // the panel can say a Cloudflare IP is out of reach *for this measurement*
        // rather than reporting a healthy endpoint as dead.
        const alive: ScoredTarget[] = [];
        const unmeasurable: UnmeasurableTarget[] = [];
        let dead = 0;
        for (const entry of scored) {
            if (entry.verdict === 'unmeasurable' && entry.result.blocked) {
                unmeasurable.push({
                    address: entry.target.address,
                    reason: entry.result.blocked,
                    ...explainUnmeasurable(entry.result.blocked)
                });
            } else if (entry.verdict === 'dead') {
                dead += 1;
            } else {
                alive.push(entry);
            }
        }

        for (const entry of scored) {
            // An unmeasurable target was never probed: the runtime refused the
            // address before a connection was attempted. Reporting it as a failed
            // probe would count it against the analytics healthy ratio and make a
            // deployment that only uses Cloudflare endpoints look degraded.
            if (entry.verdict === 'unmeasurable') continue;

            events?.emit('scanner.probed', {
                target: entry.target.address,
                ok: entry.result.successes > 0,
                latencyMs: entry.result.avgLatencyMs
            });
        }

        return { id: runId(at), at, kind: request.kind, ranked: rank(alive), dead, unmeasurable };
    };

    return {
        async run(request) {
            const result = await execute(request);
            const summary = summarise(result);

            await repository.recordRun(summary);
            events?.emit('scanner.completed', { targets: summary.targets, healthy: summary.healthy });

            return result;
        },

        dryRun: execute,

        history(kind, limit) {
            return repository.listRuns(kind, limit);
        },

        async schedule(kind, options) {
            const lastRunAt = await repository.lastRunAt(kind);
            const state: ScheduleState = {
                enabled: options.enabled,
                lastRunAt,
                ...(options.intervalMs === undefined ? {} : { intervalMs: clampInterval(options.intervalMs) })
            };

            return decide(state, runtime.now().getTime());
        },

        async best(kind) {
            const [latest] = await repository.listRuns(kind, 1);
            return latest?.best ?? null;
        },

        async intelligence(kind) {
            return intelligenceFromHistory(await repository.listRuns(kind, 5));
        },

        reset() {
            return repository.clear();
        }
    };
}
