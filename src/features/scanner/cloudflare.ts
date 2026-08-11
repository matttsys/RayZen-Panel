/**
 * Cloudflare address space recognition.
 *
 * Why this module is the most important file in the scanner
 *
 * The Workers runtime documents, under "Considerations" in the TCP sockets API
 * reference, that "outbound TCP sockets to Cloudflare IP ranges are blocked", and
 * its troubleshooting section names the resulting error: `proxy request failed,
 * cannot connect to the specified address`, raised for "Cloudflare IPs, localhost,
 * and private network IPs".
 *
 * That single sentence invalidates the obvious design for a Cloudflare clean-IP
 * scanner. A Worker cannot connect to a Cloudflare edge address, so it cannot
 * measure one, so it cannot rank one. Verified against a live deployment: 1.1.1.1,
 * 104.16.132.229, engage.cloudflareclient.com:2408 and even example.com (which is
 * Cloudflare-fronted) all fail to connect, while 8.8.8.8 and 9.9.9.9 connect in
 * 2-2.5 ms from the same isolate.
 *
 * The bug this exists to prevent
 *
 * Without this module the probe cannot tell "this endpoint is broken" from "this
 * platform refuses to measure this endpoint". Both arrive as a rejected `opened`
 * promise, both aggregate to zero successes, and `scoreResult` then assigns the
 * verdict `dead`. So a user who pastes a perfectly good Cloudflare IP, which is the
 * *entire intended use of the feature*, is told the address is dead.
 *
 * That is worse than a missing feature. A missing feature is visible; this is a
 * confident, wrong answer, and a user acting on it discards working endpoints and
 * keeps whichever non-Cloudflare address happened to answer.
 *
 * What we do instead
 *
 * Classify the address before probing. Cloudflare-owned addresses are marked
 * `unmeasurable` with a documented reason, excluded from ranking, and surfaced in
 * the UI as "measurement must happen on your own network" rather than as a score.
 * Candidate generation, provenance and guidance remain useful; a fabricated latency
 * number does not.
 *
 * Range provenance
 *
 * The prefixes below are Cloudflare's published list from https://www.cloudflare.com/ips/
 * (fetched 2026-07-31). They are embedded rather than fetched at runtime because a
 * scanner that cannot classify an address until a network call succeeds would fall
 * back to guessing during exactly the failure it needs to explain. `RANGES_FETCHED_AT`
 * makes the snapshot's age visible so the panel can say how old it is.
 */

/** ISO date the embedded prefix snapshot was taken from cloudflare.com/ips. */
export const RANGES_FETCHED_AT = '2026-07-31';

/** Cloudflare's published IPv4 prefixes. */
export const CLOUDFLARE_IPV4 = [
    '173.245.48.0/20',
    '103.21.244.0/22',
    '103.22.200.0/22',
    '103.31.4.0/22',
    '141.101.64.0/18',
    '108.162.192.0/18',
    '190.93.240.0/20',
    '188.114.96.0/20',
    '197.234.240.0/22',
    '198.41.128.0/17',
    '162.158.0.0/15',
    '104.16.0.0/13',
    '104.24.0.0/14',
    '172.64.0.0/13',
    '131.0.72.0/22'
] as const;

/** Cloudflare's published IPv6 prefixes. */
export const CLOUDFLARE_IPV6 = [
    '2400:cb00::/32',
    '2606:4700::/32',
    '2803:f800::/32',
    '2405:b500::/32',
    '2405:8100::/32',
    '2a06:98c0::/29',
    '2c0f:f248::/32'
] as const;

/**
 * Resolver addresses Cloudflare operates outside the CDN prefixes above.
 *
 * 1.1.1.1 and 1.0.0.1 are the single most likely values a user pastes into a
 * "clean IP" box, and neither appears in the published CDN ranges. Omitting them
 * would leave the exact input most people try landing in the misleading `dead`
 * bucket the rest of this module exists to eliminate.
 */
export const CLOUDFLARE_RESOLVERS = ['1.1.1.1', '1.0.0.1', '1.1.1.2', '1.0.0.2', '1.1.1.3', '1.0.0.3'] as const;

/**
 * Hostname suffixes that resolve into Cloudflare address space.
 *
 * Domain candidates cannot be range-checked without resolving them, and resolving
 * to classify would spend a subrequest to learn something these suffixes already
 * settle. The list is deliberately short: only hostnames Cloudflare itself operates,
 * not arbitrary customer domains that happen to be proxied. A customer domain that
 * *is* proxied will still fail to connect, which the error taxonomy in `probe.ts`
 * then reports honestly as a platform block rather than as a dead endpoint.
 */
export const CLOUDFLARE_HOST_SUFFIXES = [
    '.cloudflare.com',
    '.cloudflareclient.com',
    '.cloudflare-dns.com',
    '.cloudflareaccess.com',
    '.cloudflarestorage.com',
    '.workers.dev',
    '.pages.dev',
    '.cdn.cloudflare.net',
    '.cloudflareinsights.com',
    '.cloudflarestatus.com'
] as const;

/** Exact hostnames Cloudflare operates. */
export const CLOUDFLARE_HOSTS = [
    'cloudflare.com',
    'cloudflareclient.com',
    'cloudflare-dns.com',
    'one.one.one.one',
    'speed.cloudflare.com'
] as const;

/**
 * Why an address cannot be measured from a Worker.
 *
 * Every value maps to a documented runtime restriction, so the panel can quote a
 * cause rather than shrug. `null` means "no restriction known, go ahead and probe".
 */
export type UnmeasurableReason =
    | 'cloudflare-range'
    | 'cloudflare-host'
    | 'loopback'
    | 'private-network'
    | 'link-local'
    | 'prohibited-port';

/** Port 25 is refused outright by the runtime; see the same Considerations list. */
export const PROHIBITED_PORTS = [25] as const;

/* ------------------------------------------------------------------ *
 * Address parsing
 * ------------------------------------------------------------------ */

/** Parses dotted-quad IPv4 into a uint32, or null when it is not IPv4. */
export function ipv4ToInt(address: string): number | null {
    const parts = address.split('.');
    if (parts.length !== 4) return null;

    let value = 0;
    for (const part of parts) {
        // Reject '', '01', '1e2', '+1' and anything else `Number` would tolerate.
        if (!/^\d{1,3}$/.test(part)) return null;
        const octet = Number(part);
        if (octet > 255) return null;
        value = value * 256 + octet;
    }

    return value;
}

/**
 * Expands an IPv6 literal to 32 lowercase hex digits, or null when invalid.
 *
 * Handles `::` compression and the IPv4-mapped tail (`::ffff:1.2.3.4`), because a
 * mapped address pointing into Cloudflare space is still Cloudflare space and
 * missing it would reopen the hole this module closes.
 */
export function ipv6ToHex(address: string): string | null {
    let input = address.trim();
    if (input.startsWith('[') && input.endsWith(']')) input = input.slice(1, -1);
    // A zone index (`%eth0`) is not part of the address.
    const zone = input.indexOf('%');
    if (zone !== -1) input = input.slice(0, zone);
    if (!input.includes(':')) return null;

    // An IPv4 tail contributes two groups.
    const lastColon = input.lastIndexOf(':');
    const tail = input.slice(lastColon + 1);
    if (tail.includes('.')) {
        const mapped = ipv4ToInt(tail);
        if (mapped === null) return null;
        const high = ((mapped >>> 16) & 0xffff).toString(16);
        const low = (mapped & 0xffff).toString(16);
        input = `${input.slice(0, lastColon + 1)}${high}:${low}`;
    }

    const halves = input.split('::');
    if (halves.length > 2) return null;

    const expand = (part: string): string[] | null => {
        if (part === '') return [];
        const groups = part.split(':');
        for (const group of groups) {
            if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
        }
        return groups;
    };

    const head = expand(halves[0] ?? '');
    if (head === null) return null;

    if (halves.length === 1) {
        if (head.length !== 8) return null;
        return head.map(group => group.padStart(4, '0').toLowerCase()).join('');
    }

    const rear = expand(halves[1] ?? '');
    if (rear === null) return null;
    if (head.length + rear.length > 7) return null; // '::' must cover >= 1 group

    const zeros = Array.from({ length: 8 - head.length - rear.length }, () => '0');
    return [...head, ...zeros, ...rear].map(group => group.padStart(4, '0').toLowerCase()).join('');
}

/** True when `address` falls inside the IPv4 CIDR `prefix`. */
export function ipv4InCidr(address: string, prefix: string): boolean {
    const [network, bitsText] = prefix.split('/');
    const bits = Number(bitsText);
    const target = ipv4ToInt(address);
    const base = ipv4ToInt(network);
    if (target === null || base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    if (bits === 0) return true;

    // Shift in the unsigned domain: `-1 << 32` is not 0 in JavaScript.
    const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
    return ((target >>> 0) & mask) === ((base >>> 0) & mask);
}

/** True when `address` falls inside the IPv6 CIDR `prefix`. */
export function ipv6InCidr(address: string, prefix: string): boolean {
    const [network, bitsText] = prefix.split('/');
    const bits = Number(bitsText);
    const target = ipv6ToHex(address);
    const base = ipv6ToHex(network);
    if (target === null || base === null || !Number.isInteger(bits) || bits < 0 || bits > 128) return false;
    if (bits === 0) return true;

    const fullNibbles = Math.floor(bits / 4);
    if (target.slice(0, fullNibbles) !== base.slice(0, fullNibbles)) return false;

    const remainder = bits % 4;
    if (remainder === 0) return true;

    const mask = (0xf << (4 - remainder)) & 0xf;
    const targetNibble = Number.parseInt(target[fullNibbles] ?? '0', 16);
    const baseNibble = Number.parseInt(base[fullNibbles] ?? '0', 16);
    return (targetNibble & mask) === (baseNibble & mask);
}

/* ------------------------------------------------------------------ *
 * Classification
 * ------------------------------------------------------------------ */

/** True when the literal IP belongs to Cloudflare's published ranges. */
export function isCloudflareIp(address: string): boolean {
    const bare = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;

    if (CLOUDFLARE_RESOLVERS.includes(bare as (typeof CLOUDFLARE_RESOLVERS)[number])) return true;
    if (ipv4ToInt(bare) !== null) return CLOUDFLARE_IPV4.some(prefix => ipv4InCidr(bare, prefix));
    if (ipv6ToHex(bare) !== null) return CLOUDFLARE_IPV6.some(prefix => ipv6InCidr(bare, prefix));

    return false;
}

/** True when the hostname is one Cloudflare operates. */
export function isCloudflareHost(hostname: string): boolean {
    const host = hostname.trim().toLowerCase().replace(/\.$/, '');
    if (!host) return false;
    if (CLOUDFLARE_HOSTS.includes(host as (typeof CLOUDFLARE_HOSTS)[number])) return true;
    return CLOUDFLARE_HOST_SUFFIXES.some(suffix => host.endsWith(suffix));
}

/** True for 127/8, ::1 and the unspecified addresses the runtime also refuses. */
export function isLoopback(address: string): boolean {
    const bare = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
    if (bare.toLowerCase() === 'localhost') return true;

    const v4 = ipv4ToInt(bare);
    if (v4 !== null) return ipv4InCidr(bare, '127.0.0.0/8') || v4 === 0;

    const v6 = ipv6ToHex(bare);
    if (v6 !== null) return v6 === '0'.repeat(31) + '1' || v6 === '0'.repeat(32);

    return false;
}

/** True for RFC1918, RFC6598 and IPv6 unique-local space. */
export function isPrivateNetwork(address: string): boolean {
    const bare = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;

    if (ipv4ToInt(bare) !== null) {
        return ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10'].some(prefix =>
            ipv4InCidr(bare, prefix)
        );
    }

    if (ipv6ToHex(bare) !== null) return ipv6InCidr(bare, 'fc00::/7');
    return false;
}

/** True for 169.254/16 and fe80::/10. */
export function isLinkLocal(address: string): boolean {
    const bare = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
    if (ipv4ToInt(bare) !== null) return ipv4InCidr(bare, '169.254.0.0/16');
    if (ipv6ToHex(bare) !== null) return ipv6InCidr(bare, 'fe80::/10');
    return false;
}

/**
 * Decides whether a Worker is permitted to probe this host and port at all.
 *
 * Returns the reason it cannot, or `null` when a probe is worth attempting. Called
 * *before* any connect so a blocked address costs zero connections and zero time,
 * which also means a list of 40 Cloudflare IPs no longer burns the run's whole
 * budget discovering 40 times that the platform said no.
 */
export function unmeasurableReason(hostname: string, port: number): UnmeasurableReason | null {
    if (PROHIBITED_PORTS.includes(port as (typeof PROHIBITED_PORTS)[number])) return 'prohibited-port';
    if (isLoopback(hostname)) return 'loopback';
    if (isCloudflareIp(hostname)) return 'cloudflare-range';
    if (isCloudflareHost(hostname)) return 'cloudflare-host';
    if (isPrivateNetwork(hostname)) return 'private-network';
    if (isLinkLocal(hostname)) return 'link-local';
    return null;
}

/**
 * Human-readable explanation for an unmeasurable address.
 *
 * Written to the Problem/Impact/Cause/Solution shape the diagnostics surface uses,
 * because "cannot connect to the specified address" is exactly the meaningless
 * technical error this product is trying to stop showing people.
 */
export function explainUnmeasurable(reason: UnmeasurableReason): {
    problem: string;
    impact: string;
    cause: string;
    solution: string;
} {
    switch (reason) {
        case 'cloudflare-range':
            return {
                problem: 'This address is inside Cloudflare\u2019s own network, so the panel cannot measure it.',
                impact:
                    'RayZen cannot report latency or reliability for this endpoint. That is a limit of where the panel runs, not a judgement about the address, which may work perfectly from your device.',
                cause:
                    'The Cloudflare Workers runtime blocks outbound TCP connections to Cloudflare IP ranges. Every probe fails identically no matter how healthy the endpoint is.',
                solution:
                    'Keep the address as a candidate and let your client measure it. Import a subscription containing it, then use your client\u2019s own latency test, which runs on your network and is the measurement that actually matters.'
            };
        case 'cloudflare-host':
            return {
                problem: 'This hostname resolves into Cloudflare\u2019s network, so the panel cannot measure it.',
                impact:
                    'No score can be produced here. The endpoint is not being reported as broken; it is being reported as out of reach for this measurement.',
                cause:
                    'The Workers runtime blocks outbound TCP connections to Cloudflare address space, and this hostname points there.',
                solution:
                    'Measure it from your client instead, or point the panel at a non-Cloudflare host if you are testing raw reachability.'
            };
        case 'loopback':
            return {
                problem: 'Loopback and unspecified addresses cannot be probed.',
                impact: 'This candidate will never produce a usable measurement or a working config.',
                cause: 'The Workers runtime refuses outbound connections to localhost.',
                solution: 'Remove this entry and use a publicly routable address.'
            };
        case 'private-network':
            return {
                problem: 'This is a private-network address, which the panel cannot reach.',
                impact:
                    'The candidate cannot be measured, and it would not work as a proxy endpoint for clients outside your LAN either.',
                cause: 'The Workers runtime refuses outbound connections to private network ranges.',
                solution: 'Remove this entry, or replace it with the public address that fronts it.'
            };
        case 'link-local':
            return {
                problem: 'This is a link-local address, which is not routable off the local segment.',
                impact: 'No measurement is possible and no client could use it.',
                cause: 'Link-local ranges are not routed, and the runtime refuses connections to them.',
                solution: 'Remove this entry and use a public address.'
            };
        case 'prohibited-port':
            return {
                problem: 'Port 25 cannot be probed.',
                impact: 'This candidate cannot be measured on this port.',
                cause: 'The Workers runtime prohibits outbound connections on port 25 to prevent mail abuse.',
                solution:
                    'Use the port your proxy actually listens on. For Cloudflare-fronted configs that is normally 443, 2053, 2083, 2087 or 2096.'
            };
    }
}
