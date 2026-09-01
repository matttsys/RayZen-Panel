/**
 * "Optimize My Connection".
 *
 * The whole value of this feature is that it does not invent anything, so that is what
 * the tests are about. A recommender that produces confident advice from an empty
 * deployment is worse than one that produces none, because it teaches the operator to
 * ignore the advice that is real.
 */
import { describe, expect, it } from 'vitest';
import { buildOptimizationPlan, type OptimizationInput } from '../../src/features/scanner/optimize';
import { learnBlocks, type BlockObservation } from '../../src/features/scanner/blocks';
import type { DiagnosticFinding } from '../../src/types/platform';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 2, 12, 0, 0);

function observation(overrides: Partial<BlockObservation> = {}): BlockObservation {
    return {
        block: '104.16.1.0/24',
        at: NOW,
        medianScore: 88,
        medianLatency: 24,
        reachable: 4,
        measured: 5,
        ...overrides
    };
}

function finding(overrides: Partial<DiagnosticFinding> = {}): DiagnosticFinding {
    return {
        id: 'auth.password',
        title: 'Panel password',
        status: 'fail',
        detail: 'No password is set.',
        weight: 100,
        remediation: 'Set a password.',
        ...overrides
    } as DiagnosticFinding;
}

function input(overrides: Partial<OptimizationInput> = {}): OptimizationInput {
    return {
        blocks: [],
        findings: [],
        settings: {},
        bestAddress: null,
        ...overrides
    };
}

describe('it says nothing when nothing has been measured', () => {
    it('reports itself ungrounded on a fresh deployment', () => {
        const plan = buildOptimizationPlan(input());

        expect(plan.grounded).toBe(false);
        expect(plan.steps).toEqual([]);
        expect(plan.summary).toMatch(/Nothing has been measured/u);
    });

    it('tells the operator what would make it useful', () => {
        // A dead end is a bad answer even when it is the honest one. The summary has to
        // name the action that produces evidence.
        expect(buildOptimizationPlan(input()).summary).toMatch(/Run a device scan/u);
    });

    it('lists no basis when there is none', () => {
        expect(buildOptimizationPlan(input()).basis).toEqual([]);
    });
});

describe('every step carries the measurement behind it', () => {
    it('recommends the fastest measured address, with its numbers', () => {
        const plan = buildOptimizationPlan(input({
            bestAddress: { address: '104.18.57.144', latency: 19, score: 100 },
            settings: { cleanIPs: [] }
        }));

        const step = plan.steps.find(entry => entry.field === 'cleanIPs');
        expect(step?.action).toContain('104.18.57.144');
        expect(step?.evidence).toContain('19ms');
        expect(step?.evidence).toContain('100 of 100');
        expect(step?.value).toBe('104.18.57.144');
        expect(step?.impact).toBe('high');
    });

    it('does not recommend an address that is already configured', () => {
        // The failure mode this guards against is a panel that keeps suggesting what the
        // operator already did, which is how a recommendation list becomes noise.
        const plan = buildOptimizationPlan(input({
            bestAddress: { address: '104.18.57.144', latency: 19, score: 100 },
            settings: { cleanIPs: ['104.18.57.144'] }
        }));

        expect(plan.steps.find(entry => entry.field === 'cleanIPs')).toBeUndefined();
        expect(plan.summary).toMatch(/already matches|No change/u);
    });

    it('omits latency rather than borrowing another address\'s', () => {
        // The winner's own /24 is often absent from stored block history, because only
        // blocks with two or more measured addresses are kept. An earlier version filled
        // the gap from the best *other* block and produced "answered in 309ms, scoring
        // 100 of 100": one address's score against another's latency. Wrong evidence is
        // worse than missing evidence, so the number is dropped instead.
        const plan = buildOptimizationPlan(input({
            bestAddress: { address: '104.18.57.144', latency: null, score: 100 },
            settings: { cleanIPs: [] }
        }));

        const step = plan.steps.find(entry => entry.field === 'cleanIPs');
        expect(step?.evidence).toContain('scored 100 of 100');
        expect(step?.evidence).not.toMatch(/\d+ms/u);
        // And the impact claim cannot rest on a latency it does not have.
        expect(step?.impact).toBe('medium');
        expect(plan.basis.join(' ')).not.toMatch(/\d+ms/u);
    });

    it('rates a slower winner as medium rather than high impact', () => {
        const plan = buildOptimizationPlan(input({
            bestAddress: { address: '104.18.57.144', latency: 180, score: 40 },
            settings: { cleanIPs: [] }
        }));

        expect(plan.steps[0].impact).toBe('medium');
    });

    it('every step has non-empty evidence', () => {
        const plan = buildOptimizationPlan(input({
            blocks: learnBlocks([
                observation({ at: NOW }), observation({ at: NOW - DAY }), observation({ at: NOW - 2 * DAY })
            ], NOW),
            findings: [finding()],
            bestAddress: { address: '104.16.1.9', latency: 22, score: 95 },
            settings: { cleanIPs: [], ports: [80, 8080] }
        }));

        expect(plan.steps.length).toBeGreaterThan(2);
        for (const step of plan.steps) {
            expect(step.evidence.length, `"${step.action}" has no evidence`).toBeGreaterThan(20);
        }
    });
});

describe('block advice waits for repeat observations', () => {
    it('says nothing about blocks after a single scan', () => {
        // One scan naming a block is a coincidence with a number attached.
        const plan = buildOptimizationPlan(input({
            blocks: learnBlocks([observation()], NOW)
        }));

        expect(plan.steps.some(step => step.action.includes('Prefer addresses'))).toBe(false);
        expect(plan.summary).toMatch(/Scan again on another day/u);
    });

    it('recommends a block once it has been measured across days', () => {
        const plan = buildOptimizationPlan(input({
            blocks: learnBlocks([
                observation({ block: '172.64.9.0/24', at: NOW }),
                observation({ block: '172.64.9.0/24', at: NOW - DAY }),
                observation({ block: '172.64.9.0/24', at: NOW - 2 * DAY })
            ], NOW)
        }));

        const step = plan.steps.find(entry => entry.action.includes('Prefer addresses'));
        expect(step?.action).toContain('172.64.9.0/24');
        expect(step?.evidence).toContain('3 scans');
        expect(step?.evidence).toContain('3 days');
    });
});

describe('measured configuration faults are surfaced', () => {
    it('includes a failing diagnostic as a high-impact step', () => {
        const plan = buildOptimizationPlan(input({
            findings: [finding({ title: 'Panel password', remediation: 'Set a password.' })]
        }));

        expect(plan.steps[0].impact).toBe('high');
        expect(plan.steps[0].action).toBe('Set a password.');
        expect(plan.grounded).toBe(true);
    });

    it('ignores warnings, which are advice rather than faults', () => {
        // Everything in this list should be something that is wrong. Mixing in advice
        // makes the list longer and less actionable.
        const plan = buildOptimizationPlan(input({
            findings: [finding({ status: 'warn' }), finding({ status: 'pass' }), finding({ status: 'skip' })]
        }));

        expect(plan.steps).toEqual([]);
    });

    it('flags an all-plaintext port set', () => {
        const plan = buildOptimizationPlan(input({ settings: { ports: [80, 8080, 2052] } }));
        const step = plan.steps.find(entry => entry.field === 'ports');

        expect(step?.value).toBe(443);
        expect(step?.evidence).toContain('plaintext');
    });

    it('says nothing about ports when a TLS port is already selected', () => {
        const plan = buildOptimizationPlan(input({ settings: { ports: [80, 443] } }));

        expect(plan.steps.find(entry => entry.field === 'ports')).toBeUndefined();
    });
});

describe('ordering follows measured impact', () => {
    it('puts high-impact steps first', () => {
        const plan = buildOptimizationPlan(input({
            blocks: learnBlocks([
                observation({ at: NOW }), observation({ at: NOW - DAY }), observation({ at: NOW - 2 * DAY })
            ], NOW),
            findings: [finding()],
            settings: { ports: [80] }
        }));

        const impacts = plan.steps.map(step => step.impact);
        const ranked = [...impacts].sort((a, b) => {
            const rank = { high: 3, medium: 2, low: 1 } as const;
            return rank[b] - rank[a];
        });
        expect(impacts).toEqual(ranked);
    });

    it('is stable across identical runs, so the list does not reshuffle', () => {
        const args = input({
            findings: [finding(), finding({ id: 'b', title: 'Other', remediation: 'Do the other thing.' })],
            settings: { ports: [80] }
        });

        expect(buildOptimizationPlan(args).steps.map(step => step.action))
            .toEqual(buildOptimizationPlan(args).steps.map(step => step.action));
    });
});

describe('the basis is reported, so the operator can judge it', () => {
    it('names how many blocks were measured and whether they repeat', () => {
        const plan = buildOptimizationPlan(input({
            blocks: learnBlocks([observation({ at: NOW }), observation({ at: NOW - DAY })], NOW)
        }));

        expect(plan.basis.join(' ')).toMatch(/measured from this device/u);
    });

    it('names the fastest measured address', () => {
        const plan = buildOptimizationPlan(input({
            bestAddress: { address: '104.16.1.9', latency: 21, score: 97 }
        }));

        expect(plan.basis.join(' ')).toContain('104.16.1.9');
        expect(plan.basis.join(' ')).toContain('21ms');
    });
});
