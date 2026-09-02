/**
 * Block learning: turning past scans into better future ones.
 *
 * The claim this module has to earn is "RayZen learns which parts of Cloudflare's
 * address space your network routes well". That is only worth making if the learning is
 * derived from measurements and is falsifiable, so the rules here are deliberately
 * simple and every one of them is testable:
 *
 *   - A /24 is the unit, not an individual address. Cloudflare withdraws and rebalances
 *     individual addresses constantly, so "104.16.149.116 was fast last Tuesday" ages
 *     badly. Which announcements an ISP routes well is far more stable.
 *   - Evidence accumulates and decays. A block that won once is a coincidence; a block
 *     that wins across several scans on different days is a property of the network. Old
 *     observations lose weight rather than being deleted, because a route that degraded
 *     three weeks ago should stop dominating without erasing the history that shows it.
 *   - Confidence is reported, never implied. Two observations is not evidence, and the
 *     panel says so rather than presenting a ranking as though it were.
 *
 * What this module does *not* do: change any setting. It produces a list of blocks to
 * probe first and a statement about what has been observed. Acting on it stays a
 * decision the operator makes.
 */

/** One block as a past scan measured it. */
export interface BlockObservation {
    block: string;
    /** Epoch milliseconds of the scan that produced it. */
    at: number;
    /** Median score of the block's reachable addresses in that scan, 0-100. */
    medianScore: number;
    /** Median latency in milliseconds. */
    medianLatency: number;
    /** Addresses that answered, over addresses measured, in that scan. */
    reachable: number;
    measured: number;
}

/**
 * Half-life for observation weight, in days.
 *
 * Seven days, so a fortnight-old scan carries a quarter of the weight of today's. Chosen
 * against how often the thing being measured changes: ISP routing and Cloudflare
 * anycast placement shift on the order of weeks, not hours, so a half-life in hours
 * would discard usable evidence and one in months would keep asserting a route that has
 * already gone.
 */
const HALF_LIFE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Observations older than this are dropped rather than merely down-weighted. */
const MAX_AGE_DAYS = 60;

/** Blocks fed back into the next scan. */
const PREFERRED_LIMIT = 12;

/**
 * Observations before a block's ranking is presented as evidence rather than a hint.
 *
 * Three, across at least two distinct scans. One scan can be unrepresentative for
 * reasons that have nothing to do with routing: a congested uplink, a laptop waking
 * from sleep, a neighbour saturating the line.
 */
const CONFIDENT_OBSERVATIONS = 3;

function weightFor(ageMs: number): number {
    return 2 ** (-(ageMs / DAY_MS) / HALF_LIFE_DAYS);
}

export interface BlockKnowledge {
    block: string;
    /** Time-decayed mean score. The ranking key. */
    score: number;
    /** Time-decayed mean latency, for display. */
    latency: number;
    /** How many scans have measured this block. */
    observations: number;
    /** Distinct days on which it was measured, which is what makes repetition meaningful. */
    days: number;
    /** Most recent observation. */
    lastSeen: number;
    /** Fraction of measured addresses that answered, decayed. */
    reachRate: number;
    /**
     * 0-1. Rises with observations and distinct days, and falls as the newest
     * observation ages. Reported to the operator rather than used as a gate, because a
     * low-confidence hint is still better than probing at random.
     */
    confidence: number;
    /** Direction of travel across the two most recent observations. */
    trend: 'improving' | 'stable' | 'degrading' | 'unknown';
}

/**
 * Reduces a history of observations to what is known about each block.
 *
 * `now` is injected rather than read from the clock so the decay is testable.
 */
export function learnBlocks(
    observations: readonly BlockObservation[],
    now: number
): BlockKnowledge[] {
    const byBlock = new Map<string, BlockObservation[]>();
    for (const observation of observations) {
        const ageDays = (now - observation.at) / DAY_MS;
        if (ageDays > MAX_AGE_DAYS || ageDays < -1) continue;
        const existing = byBlock.get(observation.block);
        if (existing) existing.push(observation);
        else byBlock.set(observation.block, [observation]);
    }

    const knowledge: BlockKnowledge[] = [];

    for (const [block, entries] of byBlock) {
        const sorted = [...entries].sort((a, b) => b.at - a.at);
        let weightSum = 0;
        let scoreSum = 0;
        let latencySum = 0;
        let reachSum = 0;
        let measuredSum = 0;

        for (const entry of sorted) {
            const weight = weightFor(Math.max(0, now - entry.at));
            weightSum += weight;
            scoreSum += weight * entry.medianScore;
            latencySum += weight * entry.medianLatency;
            reachSum += weight * entry.reachable;
            measuredSum += weight * Math.max(1, entry.measured);
        }

        if (weightSum <= 0) continue;

        const days = new Set(sorted.map(entry => Math.floor(entry.at / DAY_MS))).size;
        const lastSeen = sorted[0].at;
        const freshness = weightFor(Math.max(0, now - lastSeen));

        // Three factors, multiplied, so a block cannot look confident on repetition
        // alone: many observations from one afternoon is one observation.
        const volume = Math.min(1, sorted.length / CONFIDENT_OBSERVATIONS);
        const spread = Math.min(1, days / 2);
        const confidence = Math.round(volume * spread * freshness * 100) / 100;

        knowledge.push({
            block,
            score: Math.round((scoreSum / weightSum) * 10) / 10,
            latency: Math.round((latencySum / weightSum) * 10) / 10,
            observations: sorted.length,
            days,
            lastSeen,
            reachRate: Math.round((reachSum / measuredSum) * 100) / 100,
            confidence,
            trend: trendOf(sorted)
        });
    }

    // Ranked by decayed score, then by confidence: between two blocks that measured the
    // same, the one with more evidence behind it should be probed first.
    return knowledge.sort((a, b) => b.score - a.score || b.confidence - a.confidence);
}

/**
 * Direction of travel, from the two most recent observations.
 *
 * A threshold of 8 points, because scores are medians of a handful of addresses and move
 * a few points from noise alone. Reporting every wobble as a trend would make the word
 * meaningless.
 */
function trendOf(sorted: readonly BlockObservation[]): BlockKnowledge['trend'] {
    if (sorted.length < 2) return 'unknown';
    const delta = sorted[0].medianScore - sorted[1].medianScore;
    if (delta >= 8) return 'improving';
    if (delta <= -8) return 'degrading';
    return 'stable';
}

/**
 * Blocks the next scan should probe first.
 *
 * Two rules beyond "highest score wins":
 *
 *   - A block whose reach rate is very low is excluded even if its few reachable
 *     addresses were fast. Preferring it would spend the head of the scan budget on a
 *     block where most addresses are dead.
 *   - A degrading block is not preferred. It may recover, and the general spread will
 *     re-measure it anyway; putting it first would keep recommending a route that is on
 *     the way out.
 *
 * The result is a bias, not a restriction: `buildCandidates` places one address per
 * preferred block and then spreads the remaining budget across the whole space, so a
 * network whose good routes have moved will still find the new ones.
 */
export function preferredBlocks(knowledge: readonly BlockKnowledge[]): string[] {
    return knowledge
        .filter(entry => entry.reachRate >= 0.25 && entry.trend !== 'degrading' && entry.score > 0)
        .slice(0, PREFERRED_LIMIT)
        .map(entry => entry.block);
}

/**
 * One sentence describing what has been learned, or why nothing has been yet.
 *
 * Written here rather than in the page so the wording cannot drift from the rules that
 * produced it, and so it can be asserted.
 */
export function describeLearning(knowledge: readonly BlockKnowledge[]): string {
    if (!knowledge.length) {
        return 'No scan history yet. The first scan samples the whole published address space evenly.';
    }

    const confident = knowledge.filter(entry => entry.confidence >= 0.5);
    if (!confident.length) {
        return `${knowledge.length} block${knowledge.length === 1 ? '' : 's'} measured once. `
            + 'Run another scan on a different day before treating this ordering as evidence.';
    }

    const best = confident[0];
    const degrading = knowledge.filter(entry => entry.trend === 'degrading').length;
    const parts = [
        `${best.block} has performed best across ${best.observations} scans on ${best.days} `
        + `day${best.days === 1 ? '' : 's'} (median ${best.latency}ms).`
    ];
    if (degrading > 0) {
        parts.push(`${degrading} block${degrading === 1 ? ' is' : 's are'} getting worse and will not be prioritised.`);
    }
    return parts.join(' ');
}
