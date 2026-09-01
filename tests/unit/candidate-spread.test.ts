/**
 * Prints the real distribution of a generated candidate list.
 *
 * Kept as a test so it runs through the same module resolution as the suite. It
 * asserts the numbers rather than only printing them, so it cannot rot into a script
 * nobody runs.
 */
import { describe, expect, it } from 'vitest';
import { buildCandidates } from '../../src/features/scanner/candidates';

describe('the generated distribution, printed', () => {
    it.each(['quick', 'deep'] as const)('%s spreads across prefixes and blocks', depth => {
        const candidates = buildCandidates({ depth });
        const blocks = new Set(candidates.map(candidate => candidate.block));
        const perPrefix = new Map<string, number>();
        for (const candidate of candidates) {
            perPrefix.set(candidate.prefix, (perPrefix.get(candidate.prefix) ?? 0) + 1);
        }

        const lines = [...perPrefix]
            .sort((a, b) => b[1] - a[1])
            .map(([prefix, count]) => `      ${prefix.padEnd(18)} ${count}`);
        console.log(
            `\n    ${depth}: ${candidates.length} addresses across ${blocks.size} distinct /24 blocks\n`
            + lines.join('\n')
            + `\n      sample: ${candidates.slice(0, 6).map(candidate => candidate.address).join(' ')}`
        );

        expect(perPrefix.size).toBeGreaterThanOrEqual(6);
        expect(blocks.size / candidates.length).toBeGreaterThan(0.7);
    });
});
