/**
 * Scoring for device-side measurements.
 *
 * Separate from `scoring.ts`, which scores the Worker-side probe, because the two have
 * different inputs and different meanings. The Worker measures Cloudflare reaching
 * Cloudflare and gets a TCP connect time. The device measures the operator's ISP
 * reaching a Cloudflare edge and gets a TLS-refusal time, three samples, a jitter
 * spread and an interception flag. Forcing both through one function would mean one of
 * them lying about what it knows.
 *
 * What the score means
 *
 * A number from 0 to 100 answering "how good is this edge for this network, right
 * now". It is a ranking aid, not a physical quantity, and the panel shows the latency
 * and success rate alongside it so an operator never has to take the number on faith.
 *
 * The shape of it
 *
 * Quality is latency and stability together, and reliability *multiplies* that rather
 * than adding to it:
 *
 *     score = (0.85 x latency + 0.15 x stability) x success
 *
 *   - **Latency, 85% of quality.** The reason anyone runs this. On a reciprocal curve
 *     rather than a linear ramp: 20 ms versus 40 ms matters to a user, 400 ms versus
 *     420 ms does not.
 *   - **Stability, 15%.** Jitter relative to the median, because 40 ms of variance on a
 *     30 ms path is chaos and on a 400 ms path is noise.
 *   - **Success rate as a multiplier.** An edge answering one attempt in three is not
 *     70% as good as one answering all three; it is roughly a third as useful, because
 *     the missing attempts are stalls the user will feel.
 *
 * Why multiplicative, specifically
 *
 * The first version of this added a 30% reliability term and a 10% stability term. That
 * gave every address a floor: a 1500 ms path that answered reliably still scored 41,
 * against 100 for an excellent one, so more than a third of the scale was unreachable
 * and the verdict bands were crammed into the top half. Multiplying removes the floor
 * (that path now scores 17) and makes the failure modes separable: 1/3 success at 30 ms
 * drops from 70 to 29, which is the honest reading.
 *
 * Interception is not a weight at all. An address that returned a real HTTP response,
 * rather than refusing the handshake, is not the Cloudflare edge: something on the path
 * answered for it. That is disqualifying, so those score zero however fast they looked.
 */

/** One address as the measurement frame reported it, after validation. */
export interface DeviceMeasurement {
    address: string;
    /** The /24 this address belongs to. */
    block: string;
    /** Median latency in milliseconds across answering attempts, or null when none answered. */
    latency: number | null;
    /** Fraction of attempts that got any answer, 0 to 1. */
    success: number;
    /** Spread between fastest and slowest answering attempt, in milliseconds. */
    jitter: number;
    /** Attempts that received an actual HTTP response, which means the path intercepted it. */
    answered: number;
}

export interface ScoredAddress extends DeviceMeasurement {
    score: number;
    /** Why this address scored as it did, in one phrase, for display. */
    verdict: 'excellent' | 'good' | 'usable' | 'slow' | 'unreachable' | 'intercepted';
}

/**
 * Latency component.
 *
 * A reciprocal curve rather than a linear ramp: full marks at or below 25 ms, half
 * marks around 100 ms, and a long tail that keeps ordering slow-but-alive addresses
 * instead of flattening them all to zero.
 */
function latencyPoints(latency: number): number {
    if (latency <= 25) return 1;
    return 25 / latency;
}

/** Stability component: jitter as a fraction of the median, inverted and clamped. */
function stabilityPoints(latency: number, jitter: number): number {
    if (latency <= 0) return 0;
    const ratio = jitter / latency;
    if (ratio <= 0.25) return 1;
    if (ratio >= 3) return 0;
    return 1 - (ratio - 0.25) / 2.75;
}

/**
 * Bands, placed against the real curve rather than at round numbers.
 *
 * On the scoring above, and at full reliability, the boundaries fall at roughly 25 ms
 * (100), 45 ms (62), 60 ms (50) and 150 ms (29). So: excellent is a sub-30 ms edge, good
 * is under about 50 ms, usable runs to around 150 ms, and slow is everything still
 * alive beyond that.
 */
function verdictFor(score: number, measurement: DeviceMeasurement): ScoredAddress['verdict'] {
    if (measurement.answered > 0) return 'intercepted';
    if (measurement.latency === null || measurement.success === 0) return 'unreachable';
    if (score >= 80) return 'excellent';
    if (score >= 55) return 'good';
    if (score >= 25) return 'usable';
    return 'slow';
}

/** Scores one measurement. Exported for the tests that pin the weights. */
export function scoreMeasurement(measurement: DeviceMeasurement): ScoredAddress {
    // Intercepted first: it is a statement about what the address *is*, which no
    // amount of good timing changes.
    if (measurement.answered > 0) {
        return { ...measurement, score: 0, verdict: 'intercepted' };
    }

    if (measurement.latency === null || measurement.success <= 0) {
        return { ...measurement, score: 0, verdict: 'unreachable' };
    }

    const quality = 0.85 * latencyPoints(measurement.latency)
        + 0.15 * stabilityPoints(measurement.latency, measurement.jitter);
    const score = Math.round(100 * quality * measurement.success);

    return { ...measurement, score, verdict: verdictFor(score, measurement) };
}

export interface BlockSummary {
    block: string;
    /** Addresses measured in this block. */
    measured: number;
    /** Addresses that scored above zero. */
    reachable: number;
    /** Median score across the block's reachable addresses. */
    medianScore: number | null;
    /** Median latency across the block's reachable addresses. */
    medianLatency: number | null;
}

export interface DeviceScanResult {
    results: ScoredAddress[];
    best: ScoredAddress | null;
    medianScore: number | null;
    /**
     * Per-/24 rollup, sorted best first.
     *
     * The block is the useful unit for a *next* scan: an individual address may be
     * withdrawn or rebalanced at any time, while the block it came from is a stable
     * statement about which of Cloudflare's announcements this ISP routes well. This is
     * what `preferredBlocks` consumes.
     */
    blocks: BlockSummary[];
    /** How many addresses were measured but disqualified as intercepted. */
    intercepted: number;
}

function median(values: readonly number[]): number | null {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const value = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    return Math.round(value * 10) / 10;
}

/**
 * Scores a batch and rolls it up by block.
 *
 * Sorted by score, then by latency as a tie-break: with three attempts and a rounded
 * score, ties are common, and a stable ordering matters because the top entry becomes a
 * recommendation.
 */
export function scoreDeviceResults(measurements: readonly DeviceMeasurement[]): DeviceScanResult {
    const results = measurements
        .map(scoreMeasurement)
        .sort((a, b) => b.score - a.score || (a.latency ?? Infinity) - (b.latency ?? Infinity));

    const reachable = results.filter(result => result.score > 0);

    const byBlock = new Map<string, ScoredAddress[]>();
    for (const result of results) {
        const existing = byBlock.get(result.block);
        if (existing) existing.push(result);
        else byBlock.set(result.block, [result]);
    }

    const blocks: BlockSummary[] = [...byBlock]
        .map(([block, entries]) => {
            const alive = entries.filter(entry => entry.score > 0);
            return {
                block,
                measured: entries.length,
                reachable: alive.length,
                medianScore: median(alive.map(entry => entry.score)),
                medianLatency: median(alive.map(entry => entry.latency ?? 0))
            };
        })
        .sort((a, b) => (b.medianScore ?? -1) - (a.medianScore ?? -1));

    return {
        results,
        best: reachable[0] ?? null,
        medianScore: median(reachable.map(result => result.score)),
        blocks,
        intercepted: results.filter(result => result.verdict === 'intercepted').length
    };
}
