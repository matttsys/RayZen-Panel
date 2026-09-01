/**
 * Candidate generation for the device-side scan.
 *
 * Two properties matter and neither is obvious from reading the module:
 *
 *   1. **The sample is spread, not sequential.** `104.16.0.0/13` holds 524,286 usable
 *      addresses, and its first 200 are one contiguous slice of one datacentre's
 *      announcement. Probing those measures one path 200 times and presents it as a
 *      survey. So the test asserts distinct /24 coverage, which is the property that
 *      makes the result mean anything.
 *   2. **Only Cloudflare space is ever produced.** The addresses are fetched by the
 *      operator's own browser from their own IP, so a generator that could be steered
 *      outside the published prefixes would be a port scanner with the operator's
 *      address on it. `preferredBlocks` comes from stored history, which makes it the
 *      one attacker-influenceable input.
 */
import { describe, expect, it } from 'vitest';
import {
    MAX_CANDIDATES,
    SCAN_DEPTHS,
    blockOf,
    buildCandidates,
    isCloudflareAddress
} from '../../src/features/scanner/candidates';
import { CLOUDFLARE_IPV4 } from '../../src/features/scanner/cloudflare';

/** Reimplemented independently of the module, so a bug in one does not hide in both. */
function inPublishedSpace(address: string): boolean {
    const toInt = (value: string) =>
        value.split('.').reduce((sum, octet) => sum * 256 + Number(octet), 0);
    const target = toInt(address);
    return CLOUDFLARE_IPV4.some(cidr => {
        const [network, bits] = cidr.split('/');
        const size = 2 ** (32 - Number(bits));
        const start = toInt(network);
        return target >= start && target < start + size;
    });
}

describe('every generated address is inside Cloudflare space', () => {
    it.each(['quick', 'deep'] as const)('%s produces only published addresses', depth => {
        const candidates = buildCandidates({ depth });

        const outside = candidates.filter(c => !inPublishedSpace(c.address));
        expect(outside.map(c => c.address)).toEqual([]);
    });

    it('never produces a network or broadcast address', () => {
        // `.0` is the network and `.255` the broadcast of its /24. Neither answers, so
        // probing them manufactures dead results and drags the score distribution down.
        const hosts = buildCandidates({ depth: 'deep' }).map(c => Number(c.address.split('.')[3]));

        expect(Math.min(...hosts)).toBeGreaterThanOrEqual(1);
        expect(Math.max(...hosts)).toBeLessThanOrEqual(254);
    });

    it('produces no duplicates', () => {
        // A duplicate is a wasted probe and, worse, double-counts one path in the
        // ranking.
        const candidates = buildCandidates({ depth: 'deep' });

        expect(new Set(candidates.map(c => c.address)).size).toBe(candidates.length);
    });
});

describe('the sample is spread across the address space', () => {
    it('quick reaches at least 150 distinct /24 blocks out of 200 addresses', () => {
        // The failure this guards against is a sequential walk, which would yield
        // roughly one block per 254 addresses.
        const candidates = buildCandidates({ depth: 'quick' });
        const blocks = new Set(candidates.map(c => c.block));

        expect(candidates.length).toBe(SCAN_DEPTHS.quick);
        expect(blocks.size).toBeGreaterThanOrEqual(150);
    });

    it('deep reaches at least 700 distinct /24 blocks out of 1000 addresses', () => {
        const candidates = buildCandidates({ depth: 'deep' });

        expect(candidates.length).toBe(SCAN_DEPTHS.deep);
        expect(new Set(candidates.map(c => c.block)).size).toBeGreaterThanOrEqual(700);
    });

    it('covers more than one published prefix', () => {
        // Sampling proportionally to prefix size is the intent; sampling *only* the
        // largest prefix would still pass the block-spread test above.
        const prefixes = new Set(buildCandidates({ depth: 'quick' }).map(c => c.prefix));

        expect(prefixes.size).toBeGreaterThanOrEqual(6);
    });

    it('weights larger prefixes more heavily', () => {
        // A /13 holds 2048 times the addresses of a /22. Sampling both equally would
        // spend most of the budget on the smallest blocks.
        const candidates = buildCandidates({ depth: 'deep' });
        const big = candidates.filter(c => c.prefix === '104.16.0.0/13').length;
        const small = candidates.filter(c => c.prefix === '103.21.244.0/22').length;

        expect(big).toBeGreaterThan(small);
    });
});

describe('the same seed yields the same scan', () => {
    it('is deterministic, so two runs are comparable', () => {
        // Without this, a "the same block got faster" claim is confounded by having
        // probed different addresses.
        const first = buildCandidates({ depth: 'quick', seed: 42 }).map(c => c.address);
        const second = buildCandidates({ depth: 'quick', seed: 42 }).map(c => c.address);

        expect(first).toEqual(second);
    });

    it('different seeds explore different addresses', () => {
        const first = new Set(buildCandidates({ depth: 'quick', seed: 1 }).map(c => c.address));
        const second = buildCandidates({ depth: 'quick', seed: 2 }).map(c => c.address);
        const overlap = second.filter(address => first.has(address)).length;

        // Some overlap is fine and expected; near-total overlap would mean the seed is
        // decorative and history could never widen its coverage.
        expect(overlap).toBeLessThan(second.length * 0.5);
    });
});

describe('preferred blocks bias the scan without breaking it', () => {
    it('probes a preferred block first', () => {
        const candidates = buildCandidates({
            depth: 'quick',
            preferredBlocks: ['104.16.7.0/24', '172.64.9.0/24']
        });

        expect(candidates[0].block).toBe('104.16.7.0/24');
        expect(candidates[1].block).toBe('172.64.9.0/24');
    });

    it('ignores a preferred block outside Cloudflare space', () => {
        // The one input an attacker could influence, by writing history. A stored block
        // that is not Cloudflare's must not become an address the operator's browser
        // reaches out to.
        const candidates = buildCandidates({
            depth: 'quick',
            preferredBlocks: ['192.0.2.0/24', '10.0.0.0/24', '127.0.0.0/24', '169.254.0.0/24']
        });

        expect(candidates.filter(c => !inPublishedSpace(c.address))).toEqual([]);
        expect(candidates.some(c => c.block === '192.0.2.0/24')).toBe(false);
    });

    it('ignores a malformed preferred block', () => {
        const candidates = buildCandidates({
            depth: 'quick',
            preferredBlocks: ['not-a-block', '999.1.1.0/24', '104.16.7.0/16', '', '104.16.7.5/24']
        });

        expect(candidates.length).toBe(SCAN_DEPTHS.quick);
        expect(candidates.filter(c => !inPublishedSpace(c.address))).toEqual([]);
    });

    it('still fills the requested count when every preference is rejected', () => {
        const candidates = buildCandidates({
            depth: 'quick',
            preferredBlocks: Array.from({ length: 50 }, () => '10.0.0.0/24')
        });

        expect(candidates.length).toBe(SCAN_DEPTHS.quick);
    });
});

describe('the ceiling holds', () => {
    it('an unknown depth falls back to quick rather than to everything', () => {
        const candidates = buildCandidates({ depth: 'enormous' as never });

        expect(candidates.length).toBe(SCAN_DEPTHS.quick);
    });

    it('deep stays under the hard ceiling', () => {
        expect(SCAN_DEPTHS.deep).toBeLessThanOrEqual(MAX_CANDIDATES);
    });
});

describe('address classification', () => {
    it.each([
        ['104.16.132.229', true],
        ['104.21.0.1', true],
        ['172.67.5.9', true],
        ['162.159.0.1', true],
        ['1.1.1.1', false],
        ['192.0.2.1', false],
        ['10.0.0.1', false],
        ['127.0.0.1', false],
        ['169.254.1.1', false],
        ['8.8.8.8', false],
        ['999.1.1.1', false],
        ['not an address', false],
        ['', false]
    ])('isCloudflareAddress(%s) is %s', (address, expected) => {
        expect(isCloudflareAddress(address)).toBe(expected);
    });

    it('1.1.1.1 is deliberately excluded', () => {
        // The resolver addresses are Cloudflare's but are not in the CDN prefixes, and
        // the device scan is about CDN edges. `src/features/scanner/cloudflare.ts`
        // lists them separately for the Worker-side classifier, which needs them for a
        // different reason: explaining why a pasted resolver address is unmeasurable.
        expect(isCloudflareAddress('1.1.1.1')).toBe(false);
    });

    it('blockOf reduces an address to its /24', () => {
        expect(blockOf('104.16.132.229')).toBe('104.16.132.0/24');
        expect(blockOf('172.67.5.9')).toBe('172.67.5.0/24');
        expect(blockOf('nonsense')).toBeNull();
    });
});
