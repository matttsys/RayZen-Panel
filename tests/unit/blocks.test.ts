/**
 * Block learning.
 *
 * This is the module that has to justify the word "intelligence" in the product, so the
 * tests are about whether the learning is real rather than whether the code runs. Three
 * properties matter:
 *
 *   1. Repetition beats a single lucky result.
 *   2. Old evidence loses influence without being erased.
 *   3. Confidence is earned by observations *spread over time*, not by volume.
 *
 * Each is stated as a test rather than as a comment, because each is a claim the panel
 * makes to an operator.
 */
import { describe, expect, it } from 'vitest';
import {
    describeLearning,
    learnBlocks,
    preferredBlocks,
    type BlockObservation
} from '../../src/features/scanner/blocks';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 2, 12, 0, 0);

function observation(overrides: Partial<BlockObservation> = {}): BlockObservation {
    return {
        block: '104.16.1.0/24',
        at: NOW,
        medianScore: 80,
        medianLatency: 30,
        reachable: 3,
        measured: 4,
        ...overrides
    };
}

describe('a block is ranked on its measurements', () => {
    it('ranks a faster block above a slower one', () => {
        const knowledge = learnBlocks([
            observation({ block: 'a', medianScore: 40, medianLatency: 200 }),
            observation({ block: 'b', medianScore: 92, medianLatency: 22 })
        ], NOW);

        expect(knowledge.map(entry => entry.block)).toEqual(['b', 'a']);
    });

    it('breaks a tie on confidence, so better-evidenced blocks go first', () => {
        const knowledge = learnBlocks([
            observation({ block: 'thin', medianScore: 80 }),
            observation({ block: 'thick', medianScore: 80 }),
            observation({ block: 'thick', medianScore: 80, at: NOW - DAY }),
            observation({ block: 'thick', medianScore: 80, at: NOW - 2 * DAY })
        ], NOW);

        expect(knowledge[0].block).toBe('thick');
        expect(knowledge[0].confidence).toBeGreaterThan(knowledge[1].confidence);
    });
});

describe('evidence decays with age', () => {
    it('a recent observation outweighs an old one for the same block', () => {
        // The block was excellent a month ago and poor today. The learned score has to
        // follow the recent measurement, or the panel keeps recommending a dead route.
        const knowledge = learnBlocks([
            observation({ medianScore: 20, at: NOW }),
            observation({ medianScore: 95, at: NOW - 30 * DAY })
        ], NOW);

        expect(knowledge[0].score).toBeLessThan(40);
    });

    it('a one-week-old observation carries about half the weight of a fresh one', () => {
        // The half-life is 7 days, so a fresh 100 against a week-old 0 should land near
        // 67: the fresh sample has twice the weight.
        const knowledge = learnBlocks([
            observation({ medianScore: 100, at: NOW }),
            observation({ medianScore: 0, at: NOW - 7 * DAY })
        ], NOW);

        expect(knowledge[0].score).toBeGreaterThan(60);
        expect(knowledge[0].score).toBeLessThan(72);
    });

    it('drops observations beyond the retention window entirely', () => {
        const knowledge = learnBlocks([observation({ at: NOW - 90 * DAY })], NOW);

        expect(knowledge).toEqual([]);
    });

    it('ignores an observation timestamped in the future', () => {
        // A clock skew or a hand-edited document must not produce weight above 1, which
        // would let one bad row dominate every other observation.
        const knowledge = learnBlocks([
            observation({ block: 'sane', medianScore: 90 }),
            observation({ block: 'future', medianScore: 10, at: NOW + 10 * DAY })
        ], NOW);

        expect(knowledge.map(entry => entry.block)).toEqual(['sane']);
    });
});

describe('confidence is earned across days, not within one', () => {
    it('a single observation is not confident', () => {
        const knowledge = learnBlocks([observation()], NOW);

        expect(knowledge[0].observations).toBe(1);
        expect(knowledge[0].days).toBe(1);
        expect(knowledge[0].confidence).toBeLessThan(0.5);
    });

    it('three observations on one day are still not confident', () => {
        // The failure this guards against: a user clicking scan three times in a row and
        // the panel then presenting the result as established.
        const knowledge = learnBlocks([
            observation({ at: NOW }),
            observation({ at: NOW - 60 * 1000 }),
            observation({ at: NOW - 120 * 1000 })
        ], NOW);

        expect(knowledge[0].observations).toBe(3);
        expect(knowledge[0].days).toBe(1);
        expect(knowledge[0].confidence).toBeLessThanOrEqual(0.5);
    });

    it('three observations across three days is confident', () => {
        const knowledge = learnBlocks([
            observation({ at: NOW }),
            observation({ at: NOW - DAY }),
            observation({ at: NOW - 2 * DAY })
        ], NOW);

        expect(knowledge[0].days).toBe(3);
        expect(knowledge[0].confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('confidence falls again as the newest observation ages', () => {
        const fresh = learnBlocks([
            observation({ at: NOW }), observation({ at: NOW - DAY }), observation({ at: NOW - 2 * DAY })
        ], NOW)[0].confidence;
        const stale = learnBlocks([
            observation({ at: NOW - 20 * DAY }),
            observation({ at: NOW - 21 * DAY }),
            observation({ at: NOW - 22 * DAY })
        ], NOW)[0].confidence;

        expect(stale).toBeLessThan(fresh / 2);
    });
});

describe('trend needs a real move, not noise', () => {
    it('reports unknown from a single observation', () => {
        expect(learnBlocks([observation()], NOW)[0].trend).toBe('unknown');
    });

    it('calls a few points of movement stable', () => {
        const knowledge = learnBlocks([
            observation({ medianScore: 82, at: NOW }),
            observation({ medianScore: 78, at: NOW - DAY })
        ], NOW);

        expect(knowledge[0].trend).toBe('stable');
    });

    it('reports improving and degrading past the threshold', () => {
        const up = learnBlocks([
            observation({ medianScore: 90, at: NOW }),
            observation({ medianScore: 60, at: NOW - DAY })
        ], NOW);
        const down = learnBlocks([
            observation({ medianScore: 45, at: NOW }),
            observation({ medianScore: 88, at: NOW - DAY })
        ], NOW);

        expect(up[0].trend).toBe('improving');
        expect(down[0].trend).toBe('degrading');
    });
});

describe('what gets fed back into the next scan', () => {
    it('prefers the best blocks', () => {
        const knowledge = learnBlocks([
            observation({ block: 'fast', medianScore: 95 }),
            observation({ block: 'slow', medianScore: 30 })
        ], NOW);

        expect(preferredBlocks(knowledge)[0]).toBe('fast');
    });

    it('excludes a block where most addresses are dead, however fast the rest were', () => {
        // One fast address out of twenty is not a block worth spending the head of the
        // scan budget on.
        const knowledge = learnBlocks([
            observation({ block: 'sparse', medianScore: 99, reachable: 1, measured: 20 }),
            observation({ block: 'solid', medianScore: 70, reachable: 8, measured: 10 })
        ], NOW);

        expect(preferredBlocks(knowledge)).toEqual(['solid']);
    });

    it('does not prefer a degrading block', () => {
        const knowledge = learnBlocks([
            observation({ block: 'falling', medianScore: 50, at: NOW }),
            observation({ block: 'falling', medianScore: 95, at: NOW - DAY }),
            observation({ block: 'steady', medianScore: 70, at: NOW })
        ], NOW);

        expect(preferredBlocks(knowledge)).toEqual(['steady']);
    });

    it('is bounded, so it cannot crowd out the general sample', () => {
        // `buildCandidates` places one address per preferred block before spreading the
        // rest. An unbounded list would turn every scan into a re-test of what is already
        // known and never find a route that moved.
        const many = Array.from({ length: 60 }, (_, index) =>
            observation({ block: `b${index}`, medianScore: 90 - index * 0.1 }));

        expect(preferredBlocks(learnBlocks(many, NOW)).length).toBeLessThanOrEqual(12);
    });

    it('prefers nothing when there is no history', () => {
        expect(preferredBlocks(learnBlocks([], NOW))).toEqual([]);
    });
});

describe('the learning is described honestly', () => {
    it('says so when there is no history', () => {
        expect(describeLearning(learnBlocks([], NOW))).toMatch(/No scan history yet/u);
    });

    it('refuses to call one scan evidence', () => {
        const summary = describeLearning(learnBlocks([observation()], NOW));

        expect(summary).toMatch(/another scan on a different day/u);
    });

    it('names the best block and its evidence once it is confident', () => {
        const summary = describeLearning(learnBlocks([
            observation({ block: '172.64.9.0/24', medianLatency: 21, at: NOW }),
            observation({ block: '172.64.9.0/24', medianLatency: 23, at: NOW - DAY }),
            observation({ block: '172.64.9.0/24', medianLatency: 22, at: NOW - 2 * DAY })
        ], NOW));

        expect(summary).toContain('172.64.9.0/24');
        expect(summary).toContain('3 scans');
        expect(summary).toContain('3 days');
    });

    it('mentions degrading blocks so the omission is explained', () => {
        const summary = describeLearning(learnBlocks([
            observation({ block: 'good', at: NOW }),
            observation({ block: 'good', at: NOW - DAY }),
            observation({ block: 'good', at: NOW - 2 * DAY }),
            observation({ block: 'bad', medianScore: 30, at: NOW }),
            observation({ block: 'bad', medianScore: 90, at: NOW - DAY })
        ], NOW));

        expect(summary).toMatch(/getting worse/u);
    });
});
