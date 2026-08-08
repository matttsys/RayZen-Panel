/**
 * Cloudflare address-space candidate generation, for a scan the *user's device* runs.
 *
 * Why this is not the existing scanner
 *
 * `src/features/scanner/` measures from the Worker, which is Cloudflare's network
 * reaching a Cloudflare address: it answers "is this endpoint alive?" and is the right
 * question for proxy-IP health. It cannot answer the question an operator in a
 * filtered network actually has, which is "which Cloudflare edge is fast *from my
 * ISP*". Only the device can measure that, so the measurement lives in the browser
 * (`src/assets/probe/`) and this module supplies the addresses.
 *
 * Both scanners stay. They measure different things and neither replaces the other.
 *
 * Why the candidate list is generated here rather than in the page
 *
 * The prefixes are Cloudflare's published list, already embedded and already tested
 * (`src/features/scanner/cloudflare.ts`). Generating in the Worker keeps one source of
 * truth for what counts as Cloudflare address space, and lets the panel ask for a
 * different sample size without shipping prefix arithmetic to the browser twice.
 *
 * How addresses are chosen
 *
 * Not sequentially. `104.16.0.0/13` is 524,288 addresses and the first 200 of them are
 * one contiguous slice of one datacentre's announcement: a sequential sample measures
 * the same path 200 times and calls it a survey. Instead the sample is spread across
 * every /24 in the prefix, deterministically, so 200 addresses land in 200 different
 * /24s wherever the prefix is large enough to allow it.
 *
 * Determinism is deliberate: the same seed yields the same list, so a scan can be
 * repeated and compared, and `preferredPrefixes` can bias later scans toward blocks
 * that have historically performed well without the comparison being confounded by a
 * different random sample.
 */
import { CLOUDFLARE_IPV4 } from '@features/scanner/cloudflare';

/** How many addresses each depth samples. */
export const SCAN_DEPTHS = {
    /**
     * Quick. About seven seconds at the concurrency the browser actually sustains,
     * which was measured rather than guessed: 120 addresses took 4.3s at concurrency
     * 16, so ~36ms per address.
     */
    quick: 200,
    /**
     * Deep. About thirty-six seconds. Slow enough that the UI must show progress and
     * offer to stop, which is why the page does both.
     */
    deep: 1000
} as const;

export type ScanDepth = keyof typeof SCAN_DEPTHS;

/** The hard ceiling, independent of depth, so a crafted request cannot ask for more. */
export const MAX_CANDIDATES = 1200;

interface Prefix {
    /** Network address as a 32-bit unsigned integer. */
    network: number;
    /** Prefix length in bits. */
    bits: number;
    /** Usable host count, excluding network and broadcast. */
    hosts: number;
    /** Original CIDR text, for attributing a result back to its block. */
    cidr: string;
}

function parsePrefix(cidr: string): Prefix {
    const [address, length] = cidr.split('/');
    const bits = Number(length);
    const octets = address.split('.').map(Number);
    const network = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
    // /31 and /32 have no usable host range in the sense used here; the published list
    // contains neither, and `Math.max` keeps the arithmetic total rather than negative.
    const hosts = Math.max(0, 2 ** (32 - bits) - 2);
    return { network, bits, hosts, cidr };
}

const PREFIXES: readonly Prefix[] = CLOUDFLARE_IPV4.map(parsePrefix);

function toDotted(value: number): string {
    return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

/**
 * A small deterministic hash, used to pick a host octet per /24.
 *
 * Deliberately not `Math.random`: two scans of the same prefix should probe the same
 * addresses so their results are comparable, and a seed makes the sample reproducible
 * without being identical for every deployment.
 */
function mix(seed: number, index: number): number {
    let value = (seed ^ (index * 0x9e3779b1)) >>> 0;
    value = (value ^ (value >>> 16)) >>> 0;
    value = Math.imul(value, 0x85ebca6b) >>> 0;
    value = (value ^ (value >>> 13)) >>> 0;
    return value >>> 0;
}

export interface Candidate {
    address: string;
    /** The published prefix this address came from, e.g. `104.16.0.0/13`. */
    prefix: string;
    /** The /24 it belongs to, e.g. `104.16.7.0/24`, which is the unit history tracks. */
    block: string;
}

export interface CandidateRequest {
    depth: ScanDepth;
    /** Repeatable sample selector. Any integer; the panel sends a rotating value. */
    seed?: number;
    /**
     * /24 blocks to favour, from measured history. Each listed block contributes an
     * address before the general spread does, so a network whose best routes have
     * consistently been in one block re-tests that block first without the scan
     * becoming blind to everything else. See `src/features/scanner/blocks.ts`.
     */
    preferredBlocks?: readonly string[];
}

/**
 * Builds the candidate list.
 *
 * The shape of the result matters as much as the addresses: every candidate carries
 * the block it came from, so a result can be attributed to a /24 and the next scan can
 * prefer it. Attribution done in the page would have to re-derive prefix arithmetic
 * from a bare address.
 */
export function buildCandidates(request: CandidateRequest): Candidate[] {
    const wanted = Math.min(SCAN_DEPTHS[request.depth] ?? SCAN_DEPTHS.quick, MAX_CANDIDATES);
    const seed = (request.seed ?? 1) >>> 0;
    const out: Candidate[] = [];
    const seen = new Set<string>();

    const push = (value: number, prefix: string) => {
        const address = toDotted(value);
        if (seen.has(address)) return;
        seen.add(address);
        out.push({ address, prefix, block: `${toDotted((value & 0xffffff00) >>> 0)}/24` });
    };

    // Preferred blocks first, one address each, and only blocks that really are inside
    // a published prefix: a stored block from an older prefix snapshot, or a crafted
    // one, must not turn this into an arbitrary-address prober.
    for (const block of request.preferredBlocks ?? []) {
        if (out.length >= wanted) break;
        const parsed = parseBlock(block);
        if (parsed === null) continue;
        const prefix = prefixFor(parsed);
        if (!prefix) continue;
        push((parsed | (1 + (mix(seed, out.length) % 254))) >>> 0, prefix.cidr);
    }

    // Then spread the remainder proportionally across the prefixes, largest first, so
    // /13s carry more of the sample than /22s. Within a prefix, one address per /24,
    // striding so consecutive picks are far apart.
    const total = PREFIXES.reduce((sum, prefix) => sum + prefix.hosts, 0);
    const ordered = [...PREFIXES].sort((a, b) => b.hosts - a.hosts);

    for (let pass = 0; out.length < wanted && pass < 64; pass++) {
        let added = 0;
        for (const prefix of ordered) {
            if (out.length >= wanted) break;
            const share = Math.max(1, Math.round((prefix.hosts / total) * wanted));
            const perPass = Math.max(1, Math.ceil(share / 8));
            for (let n = 0; n < perPass && out.length < wanted; n++) {
                const index = pass * perPass + n;
                const blocks = Math.max(1, 2 ** (32 - prefix.bits) / 256);
                // Stride by a value coprime with the block count so the walk visits
                // distinct /24s instead of cycling a few of them.
                const blockIndex = (mix(seed, index) % blocks) >>> 0;
                const host = 1 + (mix(seed ^ 0x5bf03635, index) % 254);
                push((prefix.network + blockIndex * 256 + host) >>> 0, prefix.cidr);
                added++;
            }
        }
        if (added === 0) break;
    }

    return out.slice(0, wanted);
}

/** Parses `104.16.7.0/24` into its network integer, or null when malformed. */
function parseBlock(block: string): number | null {
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.0\/24$/u.exec(block.trim());
    if (!match) return null;
    const octets = match.slice(1, 4).map(Number);
    if (octets.some(value => value > 255)) return null;
    return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8)) >>> 0;
}

/** The published prefix containing an address, or null when it is outside all of them. */
export function prefixFor(value: number): Prefix | null {
    for (const prefix of PREFIXES) {
        const mask = prefix.bits === 0 ? 0 : (0xffffffff << (32 - prefix.bits)) >>> 0;
        if (((value & mask) >>> 0) === prefix.network) return prefix;
    }
    return null;
}

/**
 * True when an address is inside Cloudflare's published IPv4 space.
 *
 * The device-side scanner will only measure addresses this accepts. Not because
 * measuring another address would fail, but because it would succeed: a panel that
 * probes arbitrary addresses on request is a port scanner pointed at whatever an
 * attacker names, running from the operator's own browser and their own IP.
 */
export function isCloudflareAddress(address: string): boolean {
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(address.trim());
    if (!match) return false;
    const octets = match.slice(1, 5).map(Number);
    if (octets.some(value => value > 255)) return false;
    const value = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
    return prefixFor(value) !== null;
}

/** The /24 an address belongs to, or null when the address is not usable. */
export function blockOf(address: string): string | null {
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(address.trim());
    if (!match) return null;
    const octets = match.slice(1, 5).map(Number);
    if (octets.some(value => value > 255)) return null;
    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
}
