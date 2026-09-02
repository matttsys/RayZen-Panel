/**
 * Scan scheduling: decides whether a scan is due, without a scheduler.
 *
 * Why there is no cron
 *
 * Cloudflare offers `scheduled()` triggers, and using one here would be wrong for
 * this project. A cron trigger fires whether or not anyone is using the
 * deployment, so a dormant panel would keep probing edge addresses on a timer,
 * spending the free plan's request budget and producing periodic outbound traffic
 * with a fixed period. A fixed period is a fingerprint, and the budget is the
 * thing that keeps the tunnel alive at the end of the month.
 *
 * So scheduling here is *opportunistic*: the decision function is pure, the
 * caller asks "is a scan due?" while already serving a request, and the scan runs
 * inside that request's `waitUntil` if it is. A deployment nobody visits performs
 * no scans, which is the correct behaviour for a tool that exists to serve its
 * operator.
 *
 * Why this is A pure function and not A service
 *
 * The decision needs three inputs: the last run time, the configured interval, and
 * now. All three are values the caller already has. Making it a function means the
 * whole scheduling policy is testable by passing numbers, and means the scanner
 * service can be constructed without a clock.
 */

import type { ScheduleDecision } from '#types/platform';

/**
 * Interval bounds.
 *
 * The minimum is 15 minutes because anything shorter cannot pay for itself: edge
 * address quality does not change on a five-minute scale, and a shorter interval
 * would mostly measure noise while consuming budget. The default is 6 hours, which
 * catches a route degrading over a day without the operator noticing.
 */
export const SCHEDULE = {
    minIntervalMs: 15 * 60 * 1000,
    defaultIntervalMs: 6 * 60 * 60 * 1000,
    maxIntervalMs: 7 * 24 * 60 * 60 * 1000
} as const;

export interface ScheduleState {
    /** Whether scheduled scanning is enabled at all. */
    enabled: boolean;
    /** Epoch ms of the last completed run, or null when never run. */
    lastRunAt: number | null;
    /** Desired interval. Clamped into the `SCHEDULE` bounds. */
    intervalMs?: number;
}

/** Clamps a requested interval into the supported range. */
export function clampInterval(intervalMs: number | undefined): number {
    if (intervalMs === undefined || !Number.isFinite(intervalMs)) return SCHEDULE.defaultIntervalMs;
    if (intervalMs < SCHEDULE.minIntervalMs) return SCHEDULE.minIntervalMs;
    if (intervalMs > SCHEDULE.maxIntervalMs) return SCHEDULE.maxIntervalMs;
    return Math.floor(intervalMs);
}

/**
 * Decides whether a scan is due.
 *
 * Returns the reason as well as the verdict, because the panel shows "next scan in
 * 4h" and a bare boolean cannot produce that. `nextDueAt` is null only when
 * scanning is disabled, so the UI never has to guess.
 *
 * A `lastRunAt` in the future (clock skew between isolates, or a hand-edited KV
 * value) is treated as "within interval" rather than as due. Treating it as due
 * would make a skewed clock cause a scan on every request.
 */
export function decide(state: ScheduleState, now: number): ScheduleDecision {
    if (!state.enabled) {
        return { due: false, reason: 'disabled', nextDueAt: null };
    }

    const intervalMs = clampInterval(state.intervalMs);

    if (state.lastRunAt === null) {
        return { due: true, reason: 'never-run', nextDueAt: now };
    }

    const nextDueAt = state.lastRunAt + intervalMs;
    if (now >= nextDueAt) {
        return { due: true, reason: 'interval-elapsed', nextDueAt };
    }

    return { due: false, reason: 'within-interval', nextDueAt };
}

/** Milliseconds until the next scan, or null when disabled or already due. */
export function timeUntilDue(decision: ScheduleDecision, now: number): number | null {
    if (decision.nextDueAt === null || decision.due) return null;
    return Math.max(0, decision.nextDueAt - now);
}
