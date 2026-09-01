/**
 * Device-side scan: scoring, and the routes around it.
 *
 * The property worth protecting here is honesty. A scan that cannot measure must say
 * so rather than return zeros, and a measurement that was intercepted must not be
 * presented as a fast edge. Both are easy to get wrong in a way that looks like a
 * working feature, which is why they are tested rather than commented.
 */
import { describe, expect, it } from 'vitest';
import {
    scoreDeviceResults,
    scoreMeasurement,
    type DeviceMeasurement
} from '../../src/features/scanner/device';

function measurement(overrides: Partial<DeviceMeasurement> = {}): DeviceMeasurement {
    return {
        address: '104.16.1.1',
        block: '104.16.1.0/24',
        latency: 30,
        success: 1,
        jitter: 4,
        answered: 0,
        ...overrides
    };
}

describe('a single measurement becomes a score', () => {
    it('a fast, reliable, stable edge scores near the top', () => {
        const scored = scoreMeasurement(measurement({ latency: 18, success: 1, jitter: 2 }));

        expect(scored.score).toBeGreaterThanOrEqual(95);
        expect(scored.verdict).toBe('excellent');
    });

    it('latency dominates, because it is what the operator came for', () => {
        const fast = scoreMeasurement(measurement({ latency: 20 })).score;
        const slow = scoreMeasurement(measurement({ latency: 400 })).score;

        expect(fast - slow).toBeGreaterThan(45);
    });

    it('reliability scales the whole score rather than topping it up', () => {
        // An additive reliability term gave every address a floor: a 1500 ms path that
        // answered every time still scored 41 of 100. Multiplying means one answer in
        // three at 30 ms scores 29 rather than 70, which is the honest reading.
        const reliable = scoreMeasurement(measurement({ latency: 30, success: 1 })).score;
        const twoOfThree = scoreMeasurement(measurement({ latency: 30, success: 2 / 3 })).score;
        const oneOfThree = scoreMeasurement(measurement({ latency: 30, success: 1 / 3 })).score;

        expect(reliable).toBeGreaterThan(twoOfThree);
        expect(twoOfThree).toBeGreaterThan(oneOfThree);
        expect(oneOfThree).toBeLessThan(reliable / 2);
    });

    it('a slow but reliable edge does not sit on an artificial floor', () => {
        // The scale has to be usable across its whole range, or the verdict bands end
        // up crammed into the top half of it.
        const verySlow = scoreMeasurement(measurement({ latency: 1500 })).score;

        expect(verySlow).toBeLessThan(25);
        expect(verySlow).toBeGreaterThan(0);
    });

    it('jitter is penalised relative to the median, not absolutely', () => {
        // 40 ms of jitter on a 30 ms path is chaos; on a 400 ms path it is noise.
        const unstableFast = scoreMeasurement(measurement({ latency: 30, jitter: 90 }));
        const stableFast = scoreMeasurement(measurement({ latency: 30, jitter: 3 }));

        expect(stableFast.score).toBeGreaterThan(unstableFast.score);
        // Bounded at 15 of 100: instability is a real signal but must not outrank
        // latency, which is what the operator is actually choosing on.
        expect(stableFast.score - unstableFast.score).toBeLessThanOrEqual(15);
    });

    it('an unreachable address scores zero rather than a small number', () => {
        const scored = scoreMeasurement(measurement({ latency: null, success: 0 }));

        expect(scored.score).toBe(0);
        expect(scored.verdict).toBe('unreachable');
    });

    it('an intercepted address is disqualified however fast it looked', () => {
        // A bare IP that returns a real HTTP response is not the Cloudflare edge:
        // something on the path answered for it. Scoring it on latency would rank a
        // captive portal or a filtering middlebox first, precisely on the networks this
        // feature exists to serve.
        const scored = scoreMeasurement(measurement({ latency: 3, success: 1, answered: 3 }));

        expect(scored.score).toBe(0);
        expect(scored.verdict).toBe('intercepted');
    });

    it('verdicts are ordered and cover the range', () => {
        const verdicts = [15, 45, 120, 900].map(
            latency => scoreMeasurement(measurement({ latency })).verdict
        );

        expect(verdicts).toEqual(['excellent', 'good', 'usable', 'slow']);
    });
});

describe('a batch becomes a ranking', () => {
    const batch: DeviceMeasurement[] = [
        measurement({ address: '104.16.1.1', block: '104.16.1.0/24', latency: 120 }),
        measurement({ address: '104.16.1.2', block: '104.16.1.0/24', latency: 130 }),
        measurement({ address: '172.64.9.1', block: '172.64.9.0/24', latency: 22 }),
        measurement({ address: '172.64.9.2', block: '172.64.9.0/24', latency: 26 }),
        measurement({ address: '104.24.5.1', block: '104.24.5.0/24', latency: null, success: 0 }),
        measurement({ address: '104.24.5.2', block: '104.24.5.0/24', latency: 8, answered: 2 })
    ];

    it('ranks by score, best first', () => {
        const { results } = scoreDeviceResults(batch);

        expect(results[0].address).toBe('172.64.9.1');
        expect(results.map(result => result.score)).toEqual([...results.map(r => r.score)].sort((a, b) => b - a));
    });

    it('names the best reachable address, not the best-looking one', () => {
        const { best } = scoreDeviceResults(batch);

        // `104.24.5.2` measured 8 ms, the fastest in the batch, and is intercepted.
        expect(best?.address).toBe('172.64.9.1');
    });

    it('rolls up by /24, sorted best first', () => {
        const { blocks } = scoreDeviceResults(batch);

        expect(blocks[0].block).toBe('172.64.9.0/24');
        expect(blocks[0].measured).toBe(2);
        expect(blocks[0].reachable).toBe(2);
        expect(blocks[0].medianLatency).toBe(24);
    });

    it('a block whose addresses all failed sorts last and reports zero reachable', () => {
        const { blocks } = scoreDeviceResults(batch);
        const dead = blocks.find(block => block.block === '104.24.5.0/24');

        expect(dead?.reachable).toBe(0);
        expect(dead?.medianScore).toBeNull();
        expect(blocks[blocks.length - 1].block).toBe('104.24.5.0/24');
    });

    it('counts interceptions so the panel can explain them', () => {
        expect(scoreDeviceResults(batch).intercepted).toBe(1);
    });

    it('the median score ignores addresses that did not answer', () => {
        // Including zeros would drag the median toward zero on a network where most of
        // the sample is filtered, which is exactly the network the operator is trying
        // to characterise.
        const { medianScore } = scoreDeviceResults(batch);
        const reachableScores = scoreDeviceResults(batch)
            .results.filter(result => result.score > 0)
            .map(result => result.score);

        expect(medianScore).not.toBeNull();
        expect(medianScore!).toBeGreaterThanOrEqual(Math.min(...reachableScores));
        expect(medianScore!).toBeLessThanOrEqual(Math.max(...reachableScores));
    });

    it('an empty batch produces nulls rather than zeros', () => {
        const result = scoreDeviceResults([]);

        // A zero would read as "we measured and everything is terrible"; null reads as
        // "nothing was measured", which is the truth.
        expect(result.best).toBeNull();
        expect(result.medianScore).toBeNull();
        expect(result.blocks).toEqual([]);
    });

    it('a batch where nothing answered reports no best', () => {
        const result = scoreDeviceResults([
            measurement({ latency: null, success: 0 }),
            measurement({ address: '104.16.1.9', latency: null, success: 0 })
        ]);

        expect(result.best).toBeNull();
        expect(result.medianScore).toBeNull();
    });
});
