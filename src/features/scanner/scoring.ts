/**
 * Scanner scoring model: turns a raw probe result into a comparable number.
 *
 * Why scoring is its own module
 *
 * The probe transport and the ranking policy change for different reasons. A new
 * transport (TLS handshake, HTTP trace, UDP for WARP) is an engineering decision
 * about what to measure. A change to how much latency matters relative to packet
 * loss is a product decision about what "good" means on a censored network. Keeping
 * them in one file would make every ranking tweak touch socket code.
 *
 * It is also the only part of the scanner that is a pure function, which is what
 * makes the model testable without a network: a `ProbeResult` in, a `ScoredTarget`
 * out, no I/O anywhere.
 *
 * Why three components and these weights
 *
 * A single latency number is the obvious model and the wrong one. On the networks
 * this project exists for, the failure that matters is not "slow" but "works, then
 * does not". A 90 ms endpoint that answers three attempts in five is worse than a
 * 300 ms endpoint that answers five in five, because the first one drops tunnels
 * and the second one carries them.
 *
 *   reliability  60%   successes / attempts
 *   latency      25%   mean latency of successful attempts, curved
 *   stability    15%   jitter relative to mean latency
 *
 * Reliability therefore dominates by construction. A target that answers half its
 * attempts scores at most 0.6*50 + 0.25*100 + 0.15*100 = 70, which is below the
 * `good` threshold of 75: no amount of speed can make an unreliable endpoint look
 * like a healthy one. That ceiling is the intended shape and it is pinned by tests.
 *
 * No score for A dead target
 *
 * Zero successes means zero, not a small number derived from timeouts. A dead
 * target must never appear in a ranked list above a working one, and giving it a
 * partial score for "failing quickly" would be exactly that mistake.
 */

import type { ProbeResult, ScoredTarget } from '#types/platform';

/**
 * Component weights. They sum to 1 and that is asserted by a test, so a future
 * edit cannot silently change the score's range.
 */
export const WEIGHTS = {
    reliability: 0.6,
    latency: 0.25,
    stability: 0.15
} as const;

/**
 * Latency curve anchors, in milliseconds.
 *
 * `excellent` scores 100 and anything at or beyond `unusable` scores 0, with a
 * linear ramp between. A linear ramp is deliberate over an exponential one: the
 * user-visible difference between 40 ms and 90 ms is negligible for a proxy hop,
 * while the difference between 400 ms and 900 ms is the difference between usable
 * and not, and a linear ramp across this range spends its resolution where the
 * decision actually is.
 */
export const LATENCY = {
    excellent: 80,
    unusable: 1200
} as const;

/**
 * Verdict thresholds.
 *
 * `dead` is not a threshold but a fact: zero successes. The others are cut points
 * on the composite score, chosen so `good` requires both high reliability and
 * reasonable latency rather than one compensating for the other.
 */
export const VERDICT_THRESHOLD = {
    good: 75,
    usable: 50,
    poor: 1
} as const;

/** Clamps to the 0-100 range the whole model works in. */
function clamp100(value: number): number {
    if (value < 0) return 0;
    if (value > 100) return 100;
    return value;
}

/** Rounds to one decimal, the precision a ranking needs and a UI shows. */
function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

/** Successes over attempts, as 0-100. */
export function reliabilityScore(successes: number, total: number): number {
    if (total <= 0) return 0;
    return clamp100((successes / total) * 100);
}

/** Mean latency mapped onto the curve in `LATENCY`. */
export function latencyScore(avgLatencyMs: number | null): number {
    if (avgLatencyMs === null) return 0;
    if (avgLatencyMs <= LATENCY.excellent) return 100;
    if (avgLatencyMs >= LATENCY.unusable) return 0;

    const span = LATENCY.unusable - LATENCY.excellent;
    return clamp100(((LATENCY.unusable - avgLatencyMs) / span) * 100);
}

/**
 * Jitter relative to mean latency, as 0-100.
 *
 * Relative rather than absolute because 30 ms of jitter on a 60 ms link is a
 * different experience from 30 ms on a 600 ms link. A coefficient of variation at
 * or above 1.0 (standard deviation as large as the mean) scores 0.
 *
 * A single successful attempt has no measurable jitter. Scoring that as perfect
 * stability would reward a thin sample, so it is scored as the neutral 50: honest
 * about the fact that stability is unknown.
 */
export function stabilityScore(avgLatencyMs: number | null, jitterMs: number | null): number {
    if (avgLatencyMs === null || avgLatencyMs <= 0) return 0;
    if (jitterMs === null) return 50;

    const coefficient = jitterMs / avgLatencyMs;
    return clamp100((1 - Math.min(coefficient, 1)) * 100);
}

export function verdictFor(score: number, successes: number): ScoredTarget['verdict'] {
    if (successes === 0) return 'dead';
    if (score >= VERDICT_THRESHOLD.good) return 'good';
    if (score >= VERDICT_THRESHOLD.usable) return 'usable';
    return 'poor';
}

/** Scores one probe result. Pure. */
export function scoreResult(result: ProbeResult): ScoredTarget {
    // An address the runtime refused to probe is `unmeasurable`, not `dead`. It made
    // zero attempts, so every component is zero, but the verdict must record "we were
    // not allowed to ask" rather than "the endpoint failed". Collapsing this back into
    // `dead` here would defeat the whole classify-before-probe pipeline: the service
    // must be able to route it into the run's `unmeasurable` list instead of `dead`.
    if (result.blocked) {
        return {
            target: result.target,
            score: 0,
            reliability: 0,
            latency: 0,
            stability: 0,
            verdict: 'unmeasurable',
            result
        };
    }

    const reliability = reliabilityScore(result.successes, result.total);
    const latency = latencyScore(result.avgLatencyMs);
    const stability = stabilityScore(result.avgLatencyMs, result.jitterMs);

    const composite =
        result.successes === 0
            ? 0
            : reliability * WEIGHTS.reliability + latency * WEIGHTS.latency + stability * WEIGHTS.stability;

    const score = round1(clamp100(composite));

    return {
        target: result.target,
        score,
        reliability: round1(reliability),
        latency: round1(latency),
        stability: round1(stability),
        verdict: verdictFor(score, result.successes),
        result
    };
}

/**
 * Ranks scored targets, best first.
 *
 * Ties break on mean latency then on address, so the same input always produces
 * the same order. A stable order matters more than it looks: the panel shows a
 * "best endpoint" and an unstable sort would make it flicker between equals on
 * every refresh.
 */
export function rank(scored: readonly ScoredTarget[]): ScoredTarget[] {
    return [...scored].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;

        const aLatency = a.result.avgLatencyMs ?? Number.POSITIVE_INFINITY;
        const bLatency = b.result.avgLatencyMs ?? Number.POSITIVE_INFINITY;
        if (aLatency !== bLatency) return aLatency - bLatency;

        return a.target.address < b.target.address ? -1 : a.target.address > b.target.address ? 1 : 0;
    });
}

/** Median of the scores present, or null when the list is empty. */
export function medianScore(scored: readonly ScoredTarget[]): number | null {
    if (scored.length === 0) return null;

    const values = scored.map(entry => entry.score).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);

    return values.length % 2 === 1
        ? values[middle]
        : round1((values[middle - 1] + values[middle]) / 2);
}

/**
 * Reduces a set of attempts into the aggregate fields of a `ProbeResult`.
 *
 * Population standard deviation rather than sample: the attempts *are* the whole
 * population of measurements taken, and with three to five attempts the Bessel
 * correction would inflate jitter by 20-40% for no gain in meaning.
 */
export function aggregate(attempts: readonly { ok: boolean; elapsedMs: number }[]): {
    successes: number;
    total: number;
    avgLatencyMs: number | null;
    jitterMs: number | null;
} {
    const latencies = attempts.filter(attempt => attempt.ok).map(attempt => attempt.elapsedMs);
    const successes = latencies.length;

    if (successes === 0) {
        return { successes: 0, total: attempts.length, avgLatencyMs: null, jitterMs: null };
    }

    const mean = latencies.reduce((sum, value) => sum + value, 0) / successes;

    // One sample has no spread. `null` says "not measured" rather than "zero
    // jitter", which `stabilityScore` then treats as unknown instead of perfect.
    const jitter =
        successes < 2
            ? null
            : Math.sqrt(latencies.reduce((sum, value) => sum + (value - mean) ** 2, 0) / successes);

    return {
        successes,
        total: attempts.length,
        avgLatencyMs: round1(mean),
        jitterMs: jitter === null ? null : round1(jitter)
    };
}
