/**
 * Recommendation effectiveness and before/after reporting.
 *
 * Why this exists
 *
 * The analytics foundation counts events. Counting is not insight. The panel can
 * say "41 recommendations shown" and still be unable to answer the two questions
 * that decide whether the recommendation engine deserves the user's trust:
 *
 *   - **Do people act on what it says?** If almost every recommendation is dismissed,
 *     the engine is noise and should be tuned down, not shown more prominently.
 *   - **Did acting help?** A recommendation that was accepted and left the health
 *     score unchanged is a recommendation that should not have been made.
 *
 * Design choices
 *
 * - **No new counters.** Everything here is derived from the existing
 *   `recommendation.shown` / `.accepted` / `.dismissed` metrics and the existing
 *   diagnostics score. Adding storage to measure the value of storage would be a
 *   poor trade.
 * - **Refuse to conclude from small samples.** Below `MIN_SAMPLE` the verdict is
 *   `insufficient-data` and no rate is reported. Reporting "100% acceptance" from
 *   one event is a lie told with arithmetic.
 * - **No charts.** Every function here returns a sentence or a number that changes
 *   a decision. A time series nobody acts on is decoration.
 */

import type { MetricsSnapshot, RecommendationEffectiveness } from '#types/platform';

/** Below this many answered recommendations, no rate is reported. */
export const MIN_SAMPLE = 5;

/** Acceptance at or above this means the engine is earning its place. */
const TRUSTED_RATE = 0.6;

/** Acceptance at or below this means the engine is being ignored. */
const IGNORED_RATE = 0.2;

function total(snapshot: MetricsSnapshot, name: string): number {
    const counters = snapshot.totals as Record<string, number | undefined>;
    return counters[name] ?? 0;
}

/**
 * Measures whether recommendations are trusted.
 *
 * `pending` (shown but never answered) is reported separately rather than folded
 * into the denominator, because ignoring a card is weaker evidence than dismissing
 * one and mixing them would flatter the engine.
 */
export function measureEffectiveness(snapshot: MetricsSnapshot): RecommendationEffectiveness {
    const shown = total(snapshot, 'recommendation.shown');
    const accepted = total(snapshot, 'recommendation.accepted');
    const dismissed = total(snapshot, 'recommendation.dismissed');
    const answered = accepted + dismissed;
    const pending = Math.max(0, shown - answered);

    const notes: string[] = [];

    if (answered < MIN_SAMPLE) {
        notes.push(
            `Only ${answered} recommendation${answered === 1 ? ' has' : 's have'} been answered so far, which is too few to judge.`
        );
        return {
            shown,
            accepted,
            dismissed,
            acceptanceRate: null,
            pending,
            verdict: 'insufficient-data',
            notes
        };
    }

    const rate = Math.round((accepted / answered) * 100) / 100;

    const verdict: RecommendationEffectiveness['verdict'] =
        rate >= TRUSTED_RATE ? 'trusted' : rate <= IGNORED_RATE ? 'ignored' : 'mixed';

    notes.push(
        `${accepted} of ${answered} answered recommendations were accepted (${Math.round(rate * 100)}%).`
    );

    if (verdict === 'ignored') {
        notes.push('Most recommendations are being dismissed. Treat them as informational rather than actionable.');
    }

    if (pending > answered) {
        notes.push(`${pending} recommendations were shown but never answered, so this rate reflects a minority of them.`);
    }

    return { shown, accepted, dismissed, acceptanceRate: rate, pending, verdict, notes };
}

export interface ImprovementReport {
    /** Health score before the change, when known. */
    before: number | null;
    after: number;
    /** After minus before, or null when there is no baseline. */
    delta: number | null;
    verdict: 'improved' | 'unchanged' | 'regressed' | 'unknown';
    summary: string;
}

/** Movement smaller than this is inside the noise of the scoring model. */
const SCORE_EPSILON = 2;

/**
 * Compares a health score before and after a change.
 *
 * The epsilon matters: diagnostics scoring is weighted and a single reworded check
 * can move the number by a point. Declaring a one-point rise an "improvement" would
 * manufacture success, so anything inside the epsilon is reported as unchanged.
 */
export function reportImprovement(before: number | null, after: number): ImprovementReport {
    if (before === null || !Number.isFinite(before)) {
        return {
            before: null,
            after,
            delta: null,
            verdict: 'unknown',
            summary: `Health score is ${after}/100. There is no earlier score to compare it with yet.`
        };
    }

    const delta = Math.round((after - before) * 10) / 10;

    if (Math.abs(delta) < SCORE_EPSILON) {
        return {
            before,
            after,
            delta,
            verdict: 'unchanged',
            summary: `Health score is effectively unchanged at ${after}/100.`
        };
    }

    return {
        before,
        after,
        delta,
        verdict: delta > 0 ? 'improved' : 'regressed',
        summary:
            delta > 0
                ? `Health score rose ${delta} points to ${after}/100.`
                : `Health score fell ${Math.abs(delta)} points to ${after}/100. Review the most recent change.`
    };
}

export interface OptimizationRecord {
    at: number;
    /** What was applied: recommendation id, preset id or profile id. */
    sourceId: string;
    source: 'recommendation' | 'preset' | 'profile';
    scoreBefore: number | null;
    scoreAfter: number | null;
}

export interface OptimizationHistoryReport {
    entries: Array<OptimizationRecord & { report: ImprovementReport }>;
    /** Mean score movement across records that have both endpoints, or null. */
    averageDelta: number | null;
    summary: string;
}

/**
 * Summarises the effect of past optimisations.
 *
 * Records lacking either endpoint are kept in the list but excluded from the
 * average: dropping them would hide activity, while averaging them would invent
 * measurements that were never taken.
 */
export function summariseOptimizationHistory(
    records: readonly OptimizationRecord[]
): OptimizationHistoryReport {
    const entries = records
        .map(record => ({
            ...record,
            report: reportImprovement(record.scoreBefore, record.scoreAfter ?? record.scoreBefore ?? 0)
        }))
        .sort((a, b) => b.at - a.at);

    const measured = entries.filter(entry => entry.report.delta !== null);
    const averageDelta =
        measured.length > 0
            ? Math.round((measured.reduce((sum, entry) => sum + (entry.report.delta ?? 0), 0) / measured.length) * 10) / 10
            : null;

    const summary =
        entries.length === 0
            ? 'No optimisations have been applied yet.'
            : averageDelta === null
              ? `${entries.length} optimisation${entries.length === 1 ? '' : 's'} applied, none with a before-and-after score to compare.`
              : averageDelta > 0
                ? `${measured.length} measured optimisation${measured.length === 1 ? '' : 's'} improved the health score by ${averageDelta} points on average.`
                : averageDelta < 0
                  ? `${measured.length} measured optimisation${measured.length === 1 ? '' : 's'} lowered the health score by ${Math.abs(averageDelta)} points on average. Review what is being recommended.`
                  : 'Applied optimisations have not measurably changed the health score.';

    return { entries, averageDelta, summary };
}
