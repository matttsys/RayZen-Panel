/**
 * Analytics service: counters the operator can see, and nobody else can.
 *
 * What this is not, stated first because it matters most
 *
 * RayZen is a censorship-circumvention tool. "Analytics" in the ordinary web sense
 * would be an attack on its own users: a beacon to a third party, a page-view
 * event with an IP attached, an error reporter carrying a hostname. None of that
 * exists here and none of it may be added.
 *
 *   - No network egress. Ever. Counters are written to the deployment's own KV.
 *   - No per-user, per-IP, per-request records. The stored unit is a *count per
 *     day*, which cannot be traced to a person or a session.
 *   - No open-ended dimensions. `MetricName` is a closed union of ten names, so a
 *     future contributor cannot quietly add `config.exports.by_country`.
 *   - No timestamps finer than one UTC day. A minute-resolution series would let
 *     whoever obtains the KV data correlate activity with a person's waking hours.
 *
 * What remains is genuinely useful to the one person entitled to it: the operator
 * of a single deployment learns whether their panel is being used, whether logins
 * are failing, and whether config exports are hitting unsupported combinations.
 *
 * Why it is still worth building
 *
 * Analytics was left out of the panel for a long time because no backend capability
 * existed, and building UI for it would have been a fake feature. This is that
 * capability, built to the constraint that kept it out: strictly local, strictly
 * aggregate.
 *
 * Write budget
 *
 * The free plan allows 1,000 KV writes per day. Counter bumps therefore mutate an
 * in-memory document and the platform flushes once per request, so a request that
 * records four events costs one write rather than four. See
 * `src/platform/repositories.ts` for the mechanism.
 */

import type { AnalyticsInsight, DailyMetrics, MetricName, MetricsSnapshot, StatisticsSummary } from '#types/platform';
import type { MetricsRepository } from '@platform/repositories';
import { runtime } from '@runtime';

/** `YYYY-MM-DD` in UTC. UTC rather than local so a series never shifts with DST. */
export function utcDay(at: Date = runtime.now()): string {
    return at.toISOString().slice(0, 10);
}

export interface AnalyticsService {
    /** Records one occurrence of `metric` against today's UTC day. */
    record(metric: MetricName, by?: number): Promise<void>;
    /** Everything retained plus totals. */
    snapshot(): Promise<MetricsSnapshot>;
    /** Derived statistics over the retained window. */
    statistics(): Promise<StatisticsSummary>;
    /** A single counter's total across the window. */
    total(metric: MetricName): Promise<number>;
    /** Drops every counter. Used by the panel reset path. */
    reset(): Promise<void>;
}

/**
 * Computes a ratio, or null when the denominator is zero.
 *
 * Returning null rather than 0 is deliberate: "no login attempts yet" and "every
 * login failed" are different facts, and a UI that showed 0% for both would be
 * lying about the second.
 */
function ratio(numerator: number, denominator: number): number | null {
    if (denominator === 0) return null;
    return Math.round((numerator / denominator) * 1000) / 1000;
}

/** Rounds to one decimal, which is the precision the panel displays. */
function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

/**
 * Derives statistics from a snapshot.
 *
 * Pure and exported so it can be tested against hand-written snapshots without KV,
 * and so the panel could compute a summary from a snapshot it already fetched
 * rather than paying a second read.
 */
export function summarise(snapshot: MetricsSnapshot): StatisticsSummary {
    const { days, totals } = snapshot;

    // "Active" means the day recorded at least one event. Dividing by the width of
    // the retention window instead would understate a deployment that has been
    // live for three days, and would make every average drift downward as the
    // window fills.
    const activeDays = days.filter(day => Object.values(day.counters).some(value => (value ?? 0) > 0)).length;

    const dailyAverage: Partial<Record<MetricName, number>> = {};
    if (activeDays > 0) {
        for (const [metric, value] of Object.entries(totals) as [MetricName, number][]) {
            dailyAverage[metric] = round1(value / activeDays);
        }
    }

    const authSuccess = totals['auth.success'] ?? 0;
    const authFailure = totals['auth.failure'] ?? 0;
    const exports = totals['config.exports'] ?? 0;
    const unsupported = totals['config.unsupported'] ?? 0;

    // `days` is stored sorted ascending by the repository, so the last entry is the
    // most recent. Recomputing a max here would duplicate that guarantee.
    const lastActiveDay = days.length > 0 ? days[days.length - 1].day : null;

    return {
        totals,
        dailyAverage,
        authSuccessRate: ratio(authSuccess, authSuccess + authFailure),
        exportSuccessRate: ratio(exports, exports + unsupported),
        activeDays,
        lastActiveDay,
        recommendationAcceptanceRate: ratio(totals['recommendation.accepted'] ?? 0, (totals['recommendation.accepted'] ?? 0) + (totals['recommendation.dismissed'] ?? 0))
    };
}


export function actionInsights(snapshot: MetricsSnapshot): AnalyticsInsight[] {
    const stats = summarise(snapshot);
    const insights: AnalyticsInsight[] = [];
    const probes = stats.totals['scanner.probes'] ?? 0;
    const healthy = stats.totals['scanner.healthy'] ?? 0;
    if (probes >= 5 && healthy / probes < 0.6) insights.push({ id: 'scanner.degrading', title: 'Endpoint quality needs attention', detail: `Only ${healthy} of ${probes} probes were healthy.`, action: 'Run a bounded Clean IP scan and review the top-confidence endpoint.', severity: 'attention' });
    if ((stats.totals['settings.rejections'] ?? 0) >= 3) insights.push({ id: 'settings.rejections', title: 'Configuration changes are being rejected', detail: `${stats.totals['settings.rejections']} validation rejections were recorded.`, action: 'Open Diagnostics and resolve blocking field guidance before applying a profile.', severity: 'attention' });
    if (stats.recommendationAcceptanceRate !== null && stats.recommendationAcceptanceRate !== undefined) insights.push({ id: 'recommendation.effectiveness', title: 'Recommendation effectiveness', detail: `${Math.round(stats.recommendationAcceptanceRate * 100)}% of recorded recommendation outcomes were accepted.`, action: stats.recommendationAcceptanceRate < 0.4 ? 'Review low-confidence advice before expanding automation.' : 'Continue collecting outcomes before enabling adaptive defaults.', severity: stats.recommendationAcceptanceRate < 0.4 ? 'attention' : 'positive' });
    if (insights.length === 0) insights.push({ id: 'baseline', title: 'Keep collecting a privacy-safe baseline', detail: 'No action threshold has been crossed.', action: 'Run occasional bounded scans after meaningful network changes.', severity: 'info' });
    return insights;
}

/**
 * Sums one counter over a snapshot's days.
 *
 * Exported because the diagnostics engine needs single totals and should not have
 * to understand the document shape.
 */
export function totalOf(days: readonly DailyMetrics[], metric: MetricName): number {
    let sum = 0;
    for (const day of days) sum += day.counters[metric] ?? 0;
    return sum;
}

export function createAnalyticsService(metrics: MetricsRepository): AnalyticsService {
    return {
        record(metric, by = 1) {
            return metrics.increment(utcDay(), metric, by);
        },

        snapshot() {
            return metrics.snapshot();
        },

        async statistics() {
            return summarise(await metrics.snapshot());
        },

        async total(metric) {
            const { totals } = await metrics.snapshot();
            return totals[metric] ?? 0;
        },

        reset() {
            return metrics.clear();
        }
    };
}

/**
 * Subscribes analytics to the event bus.
 *
 * This function is the entire reason the event bus exists. Without it, every
 * counter would need a call site inside a handler, and `src/handlers/panel.ts`
 * would gain an import of this module plus a line per metric. With it, the
 * handlers publish facts they already know and this table decides what to count.
 * Adding a counter is a line here and no change anywhere else.
 *
 * Returns an unsubscribe function so a request-scoped platform can detach cleanly;
 * leaking listeners into a long-lived isolate is the failure mode the bus docs warn
 * about.
 */
export function subscribeAnalytics(
    bus: import('@platform/events').EventBus,
    analytics: AnalyticsService
): () => void {
    // Each listener returns its promise instead of voiding it, so `emit` can track
    // the write and `settled()` actually waits for it. A voided promise is invisible
    // to the bus (`invoke` only tracks a returned `Promise`), which would make the
    // "drain listeners, then flush" ordering in `dispose()` unenforced.
    const offs = [
        bus.on('config.exported', () => analytics.record('config.exports')),
        bus.on('config.unsupported', () => analytics.record('config.unsupported')),
        bus.on('auth.attempt', ({ ok }) => analytics.record(ok ? 'auth.success' : 'auth.failure')),
        bus.on('settings.updated', () => analytics.record('settings.saves')),
        bus.on('settings.rejected', () => analytics.record('settings.rejections')),
        bus.on('scanner.probed', ({ ok }) => {
            // Two counters from one event, so both promises are joined rather than
            // one of them being dropped.
            const writes = [analytics.record('scanner.probes')];
            if (ok) writes.push(analytics.record('scanner.healthy'));
            return Promise.all(writes).then(() => undefined);
        }),
        bus.on('warp.refreshed', () => analytics.record('warp.refreshes')),
        bus.on('panel.updated', () => analytics.record('panel.updates'))
    ];

    return () => {
        for (const off of offs) off();
    };
}
