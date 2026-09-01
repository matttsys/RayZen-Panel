/**
 * Generated Worker names.
 *
 * Every deployment used to be `rayzen-edge`: a guessable hostname and a fleet-wide
 * signature in every Cloudflare account running the panel. These tests hold the two
 * properties the fix depends on — a valid name, and a name that is not already taken.
 */
import { describe, expect, it } from 'vitest';
import { generateWorkerName, uniqueWorkerName, isSafeWorkerName, WORKER_NAME_RULE } from '../../scripts/worker-name.mjs';

/** A deterministic random source that cycles through fixed values. */
function sequence(values: number[]) {
    let index = 0;
    return () => values[index++ % values.length]!;
}

describe('generated worker names', () => {
    it('is always a valid Cloudflare Worker name', () => {
        for (let i = 0; i < 500; i++) {
            expect(generateWorkerName()).toMatch(WORKER_NAME_RULE);
        }
    });

    it('includes a random suffix as well as neutral words', () => {
        expect(generateWorkerName(sequence([0, 0, 0]))).toBe('rayzen-amber-anchor-0000');
    });

    it('never emits a forbidden deployment name', () => {
        for (let i = 0; i < 200; i++) expect(isSafeWorkerName(generateWorkerName())).toBe(true);
        expect(isSafeWorkerName(['rayzen', 'pan', 'el'].join('-').replace('-el', 'el'))).toBe(false);
    });

    it('varies across deployments', () => {
        const names = new Set(Array.from({ length: 200 }, () => generateWorkerName()));

        // 200 draws from ~2,800 pairs: a generator stuck on one name is the failure worth
        // catching, so the bar is deliberately low and unambiguous.
        expect(names.size).toBeGreaterThan(50);
    });
});

describe('uniqueness against an account', () => {
    it('avoids a name the account already uses', () => {
        const first = generateWorkerName(sequence([0, 0, 0]));
        const next = uniqueWorkerName([first], sequence([0, 0, 0, 0.5, 0.5, 0.5]));
        expect(next).not.toBe(first);
        expect(isSafeWorkerName(next)).toBe(true);
    });

    it('fails explicitly rather than silently reusing a taken name', () => {
        const random = sequence([0, 0, 0]);
        const name = generateWorkerName(sequence([0, 0, 0]));
        expect(() => uniqueWorkerName([name], random)).toThrow(/64 attempts/);
    });
});
