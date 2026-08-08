/**
 * Endpoint lifecycle tracking and migration advice.
 *
 * Why this exists
 *
 * The scanner ranks endpoints per run, and its confidence calculation is honest
 * about volatility. Both reason about *a scan*. Neither reasons about *an endpoint
 * over time*, which is where the real signal lives: an address
 * that has been the best choice for six consecutive scans is a different
 * proposition from one that won a single scan by two points, even when their
 * current scores are identical.
 *
 * The user-facing problem this solves is churn. Without lifecycle awareness the
 * panel will happily advise switching endpoints every time noise reorders the top
 * two, and every switch costs the user a client reconfiguration for no measurable
 * gain. Lifecycle turns "who won today" into "who has earned your trust".
 *
 * Cost discipline
 *
 * This module reads only the bounded `ScanRunSummary` list the scanner repository
 * already retains. It performs no probes, adds no storage, and is O(n) over a list
 * whose length is capped by `RETENTION.scanRunsPerKind`. A Worker request can
 * afford it; that constraint is why it consumes summaries rather than full runs.
 */

import type { EndpointLifecycle, LifecycleState, MigrationAdvice, ScanRunSummary } from '#types/platform';

/** Fewer observations than this and an endpoint is "new", regardless of score. */
const NEW_THRESHOLD = 2;

/** Score movement below this is noise, not a trend. */
const TREND_EPSILON = 4;

/** An endpoint absent from this many recent runs is treated as retired. */
const RETIREMENT_GAP = 3;

/**
 * A challenger must beat the incumbent by this much before switching is advised.
 *
 * Hysteresis, deliberately asymmetric against change: the cost of a needless switch
 * is paid by the user in effort, while the cost of a delayed switch is a few points
 * of score. The scanner should be biased toward stability.
 */
export const MIGRATION_MARGIN = 8;

/** Below this confidence the panel informs but does not advise switching. */
export const MIGRATION_CONFIDENCE_FLOOR = 0.55;

/**
 * Builds a lifecycle record per address seen as "best" in the retained runs.
 *
 * Only best-of-run addresses are tracked because that is what the persisted
 * summaries contain. This is a deliberate limitation of the bounded storage model,
 * and it is the right trade: tracking every address in every run would grow KV
 * linearly with target-list size for information nobody acts on.
 *
 * @param runs Summaries, newest first.
 */
export function buildLifecycles(runs: readonly ScanRunSummary[]): EndpointLifecycle[] {
    const ordered = [...runs].sort((a, b) => a.at - b.at); // oldest first
    const byAddress = new Map<string, { scores: number[]; times: number[]; lastIndex: number }>();

    ordered.forEach((run, index) => {
        if (!run.best) return;
        const entry = byAddress.get(run.best.address) ?? { scores: [], times: [], lastIndex: -1 };
        entry.scores.push(run.best.score);
        entry.times.push(run.at);
        entry.lastIndex = index;
        byAddress.set(run.best.address, entry);
    });

    const lastIndex = ordered.length - 1;

    return Array.from(byAddress.entries())
        .map(([address, entry]) => {
            const observations = entry.scores.length;
            const first = entry.scores[0] ?? 0;
            const latest = entry.scores[observations - 1] ?? 0;
            const delta = observations > 1 ? Math.round((latest - first) * 10) / 10 : null;
            const average = Math.round((entry.scores.reduce((sum, score) => sum + score, 0) / observations) * 10) / 10;
            const gap = lastIndex - entry.lastIndex;

            let state: LifecycleState;
            if (gap >= RETIREMENT_GAP) state = 'retired';
            else if (observations < NEW_THRESHOLD) state = 'new';
            else if (delta !== null && delta <= -TREND_EPSILON) state = 'degrading';
            else if (delta !== null && delta >= TREND_EPSILON) state = 'improving';
            else state = 'stable';

            return {
                address,
                state,
                observations,
                firstSeenAt: entry.times[0] ?? 0,
                lastSeenAt: entry.times[observations - 1] ?? 0,
                averageScore: average,
                scoreDelta: delta
            } satisfies EndpointLifecycle;
        })
        .sort((a, b) => b.averageScore - a.averageScore);
}

/**
 * Decides whether the user should move to a different endpoint.
 *
 * Returns `moveTo: null` far more often than not, and that is the point. Three
 * conditions must all hold before a switch is advised:
 *
 *   1. the challenger's *average* beats the incumbent's average by `MIGRATION_MARGIN`
 *      (averages, not last score, so one lucky run cannot trigger a move);
 *   2. the challenger is not `new` (it has survived more than one observation);
 *   3. combined confidence clears `MIGRATION_CONFIDENCE_FLOOR`.
 *
 * A degrading incumbent lowers the bar but never removes it.
 */
export function adviseMigration(
    lifecycles: readonly EndpointLifecycle[],
    currentAddress: string | null
): MigrationAdvice {
    const active = lifecycles.filter(entry => entry.state !== 'retired');

    if (active.length === 0) {
        return {
            moveTo: null,
            from: currentAddress,
            confidence: 0,
            reasons: ['No endpoint has enough recent history to compare.']
        };
    }

    const incumbent = currentAddress ? active.find(entry => entry.address === currentAddress) ?? null : null;
    const challenger = active.find(entry => entry.address !== currentAddress) ?? null;

    if (!incumbent) {
        const best = active[0];
        // Nothing is configured yet, or the configured endpoint has no history: this
        // is adoption advice, not migration, and it needs no hysteresis.
        return {
            moveTo: best.address,
            from: currentAddress,
            confidence: best.observations >= NEW_THRESHOLD ? 0.6 : 0.4,
            reasons: [
                currentAddress
                    ? `The endpoint in use has no scan history, while ${best.address} averages ${best.averageScore}/100 over ${best.observations} scan${best.observations === 1 ? '' : 's'}.`
                    : `${best.address} averages ${best.averageScore}/100 over ${best.observations} scan${best.observations === 1 ? '' : 's'}.`
            ]
        };
    }

    if (!challenger) {
        return {
            moveTo: null,
            from: currentAddress,
            confidence: 0.5,
            reasons: [`${incumbent.address} is the only endpoint with recent history. Stay where you are.`]
        };
    }

    const margin = Math.round((challenger.averageScore - incumbent.averageScore) * 10) / 10;
    const requiredMargin = incumbent.state === 'degrading' ? MIGRATION_MARGIN / 2 : MIGRATION_MARGIN;
    const reasons: string[] = [];

    if (challenger.state === 'new') {
        reasons.push(`${challenger.address} has only been seen once, which is not enough to recommend a switch.`);
    }

    if (margin < requiredMargin) {
        reasons.push(
            `${challenger.address} leads by ${margin} point${Math.abs(margin) === 1 ? '' : 's'}, below the ${requiredMargin}-point margin needed to justify reconfiguring your clients.`
        );
    }

    if (incumbent.state === 'degrading') {
        reasons.push(`${incumbent.address} has lost ${Math.abs(incumbent.scoreDelta ?? 0)} points since it was first measured.`);
    }

    const sampleQuality = Math.min(1, (incumbent.observations + challenger.observations) / 8);
    const marginQuality = Math.min(1, Math.max(0, margin) / (MIGRATION_MARGIN * 2));
    const confidence = Math.round((sampleQuality * 0.5 + marginQuality * 0.5) * 100) / 100;

    const shouldMove =
        challenger.state !== 'new' && margin >= requiredMargin && confidence >= MIGRATION_CONFIDENCE_FLOOR;

    if (shouldMove) {
        reasons.unshift(
            `${challenger.address} averages ${challenger.averageScore}/100 against ${incumbent.averageScore}/100 for ${incumbent.address}, across ${challenger.observations} and ${incumbent.observations} scans.`
        );
    } else if (reasons.length === 0) {
        reasons.push(`${incumbent.address} remains the best measured choice.`);
    }

    return {
        moveTo: shouldMove ? challenger.address : null,
        from: currentAddress,
        confidence,
        reasons
    };
}
