/**
 * Unit tests for the pure predicates and formatters in `src/cores/utils.ts`.
 *
 * These feed every config generator, so a change here moves hundreds of golden
 * fixtures at once. Testing them directly turns a 250-file diff into a one-line
 * failure.
 *
 * Every assertion pins CURRENT behaviour, including behaviour that is arguably
 * wrong. Where that is the case the test says so explicitly, so that a
 * deliberate fix shows up as an intentional test change rather than a surprise.
 */
import { describe, expect, it } from 'vitest';
import {
    base64ToDecimal,
    getDomain,
    isBase64,
    isDomain,
    isHex,
    isIPv4,
    isIPv4CIDR,
    isIPv6,
    isIPv6CIDR,
    isValidUrl,
    parseHostPort,
    toRange
} from '@utils';

describe('isDomain', () => {
    it.each([
        ['example.com', true],
        ['sub.example.com', true],
        ['a.co', true],
        ['EXAMPLE.COM', true]
    ])('accepts %s', (input, expected) => {
        expect(isDomain(input)).toBe(expected);
    });

    it.each([
        ['localhost', false],
        ['example.com.', false],
        ['-example.com', false],
        ['example-.com', false],
        ['192.168.1.1', false],
        ['', false],
        ['example.c', false]
    ])('rejects %s', (input, expected) => {
        expect(isDomain(input)).toBe(expected);
    });

    it('rejects punycode/IDN top-level domains — a real limitation', () => {
        // FINDING: the TLD group is `[a-z]{2,63}`, which excludes digits and
        // hyphens, so an internationalised TLD in A-label form is rejected.
        // A user in a country using an IDN TLD (.рф -> xn--p1ai, .中国 -> xn--fiqs8s)
        // cannot enter their own domain as a custom domain, clean IP, or CDN host.
        // Pinned as current behaviour; fixing it is a deliberate change because it
        // widens what several validators accept.
        expect(isDomain('xn--p1ai.xn--p1ai')).toBe(false);
        expect(isDomain('example.xn--p1ai')).toBe(false);
        // The A-label is accepted in a non-TLD position, so the restriction is
        // specifically the last label.
        expect(isDomain('xn--p1ai.com')).toBe(true);
    });

    it('rejects a label longer than 63 characters', () => {
        expect(isDomain(`${'a'.repeat(63)}.com`)).toBe(true);
        expect(isDomain(`${'a'.repeat(64)}.com`)).toBe(false);
    });
});

describe('isIPv4', () => {
    it.each([
        ['0.0.0.0', true],
        ['192.168.1.1', true],
        ['255.255.255.255', true],
        ['10.0.0.1/8', true],
        ['10.0.0.1/32', true]
    ])('accepts %s', (input, expected) => {
        expect(isIPv4(input)).toBe(expected);
    });

    it.each([
        ['256.0.0.1', false],
        ['1.2.3', false],
        ['1.2.3.4.5', false],
        ['10.0.0.1/33', false],
        ['', false],
        ['[::1]', false]
    ])('rejects %s', (input, expected) => {
        expect(isIPv4(input)).toBe(expected);
    });

    it('accepts leading zeros, which is current behaviour', () => {
        expect(isIPv4('010.001.001.001')).toBe(true);
    });
});

describe('isIPv6', () => {
    it('requires brackets', () => {
        expect(isIPv6('[2001:db8::1]')).toBe(true);
        expect(isIPv6('2001:db8::1')).toBe(false);
    });

    it('rejects the bracketed loopback [::1] — a real bug', () => {
        // FINDING: the alternation branch for a leading `::` is
        // `::(?:[a-fA-F0-9]{1,4}:){0,7}`, which requires every group after `::`
        // to be followed by a colon. `::1` has no trailing colon, so it fails,
        // even though `[::]` and `[fe80::1]` both match other branches.
        //
        // Consequence: `[::1]` is rejected by validateNAT64Prefixes, and by
        // validateCleanIPs / validateProxyIPs / validateCustomCdn through
        // isValidHost. Pinned as current behaviour; fixing it widens accepted
        // input, so it is a deliberate change with a golden rewrite.
        expect(isIPv6('[::1]')).toBe(false);
        expect(isIPv6('[::]')).toBe(true);
        expect(isIPv6('[fe80::1]')).toBe(true);
    });

    it.each([
        ['[2001:db8:0:0:0:0:0:1]', true],
        ['[2001:db8::]', true],
        ['[2001:db8::1]', true],
        ['[::]', true],
        ['[2606:4700:110:8fd2:11f3:8e67:11d4:3704]', true],
        ['[2001:db8::1]/64', true],
        ['[2001:db8::1]/128', true]
    ])('accepts %s', (input, expected) => {
        expect(isIPv6(input)).toBe(expected);
    });

    it.each([
        ['[2001:db8::1]/129', false],
        ['[not:an:address]', false],
        ['[]', false],
        ['', false]
    ])('rejects %s', (input, expected) => {
        expect(isIPv6(input)).toBe(expected);
    });
});

describe('CIDR predicates', () => {
    it('isIPv4CIDR accepts an address with or without a prefix length', () => {
        expect(isIPv4CIDR('10.0.0.0/8')).toBe(true);
        expect(isIPv4CIDR('10.0.0.0')).toBe(true);
        expect(isIPv4CIDR('10.0.0.0/33')).toBe(false);
    });

    it('isIPv6CIDR accepts UNBRACKETED input, unlike isIPv6', () => {
        // Deliberate asymmetry in the current code: validateCustomRules feeds
        // bare CIDR strings, while validateNAT64Prefixes feeds bracketed ones.
        expect(isIPv6CIDR('2001:db8::/32')).toBe(true);
        expect(isIPv6CIDR('2001:db8::')).toBe(true);
        expect(isIPv6('2001:db8::/32')).toBe(false);
    });
});

describe('isValidUrl', () => {
    it.each([
        ['https://example.com', true],
        ['http://example.com', true],
        ['https://example.com/path?q=1', true]
    ])('accepts %s', (input, expected) => {
        expect(isValidUrl(input)).toBe(expected);
    });

    it.each([
        ['ftp://example.com', false],
        ['ws://example.com', false],
        ['example.com', false],
        ['', false]
    ])('rejects %s', (input, expected) => {
        expect(isValidUrl(input)).toBe(expected);
    });
});

describe('isBase64', () => {
    it('requires a length divisible by four', () => {
        expect(isBase64('YWJj')).toBe(true);
        expect(isBase64('YWJ')).toBe(false);
    });

    it('does not verify decodability, only the character set', () => {
        // '====' is length-4 and matches the character class, so the current
        // implementation accepts it even though it decodes to nothing useful.
        expect(isBase64('====')).toBe(true);
    });

    it('rejects an empty string and out-of-alphabet characters', () => {
        expect(isBase64('')).toBe(false);
        expect(isBase64('YWJ!')).toBe(false);
    });
});

describe('isHex', () => {
    it('requires an even number of hex digits', () => {
        expect(isHex('00ff')).toBe(true);
        expect(isHex('00FF')).toBe(true);
        expect(isHex('0ff')).toBe(false);
    });

    it('rejects an empty string and non-hex characters', () => {
        expect(isHex('')).toBe(false);
        expect(isHex('00gg')).toBe(false);
    });
});

describe('parseHostPort', () => {
    it('splits host and port', () => {
        expect(parseHostPort('example.com:443')).toEqual({ host: 'example.com', port: 443 });
    });

    it('returns port 0 when absent', () => {
        expect(parseHostPort('example.com')).toEqual({ host: 'example.com', port: 0 });
    });

    it('strips IPv6 brackets by default and keeps them when asked', () => {
        expect(parseHostPort('[2001:db8::1]:443')).toEqual({ host: '2001:db8::1', port: 443 });
        expect(parseHostPort('[2001:db8::1]:443', true)).toEqual({ host: '[2001:db8::1]', port: 443 });
    });

    it('returns an empty host for unparseable input', () => {
        expect(parseHostPort('')).toEqual({ host: '', port: 0 });
    });
});

describe('getDomain', () => {
    it('extracts the hostname and reports whether it is a domain', () => {
        expect(getDomain('https://example.com/dns-query')).toEqual({
            host: 'example.com',
            isHostDomain: true
        });
    });

    it('reports isHostDomain false for an IP literal', () => {
        expect(getDomain('https://8.8.8.8/dns-query')).toEqual({
            host: '8.8.8.8',
            isHostDomain: false
        });
    });

    it('returns an empty host for a bare host that is not a URL', () => {
        expect(getDomain('example.com')).toEqual({ host: '', isHostDomain: false });
    });
});

describe('toRange', () => {
    it('collapses an equal pair to a single value', () => {
        expect(toRange(5, 5)).toBe('5');
    });

    it('renders a differing pair as min-max', () => {
        expect(toRange(1, 5)).toBe('1-5');
    });

    it('returns undefined when either bound is falsy, INCLUDING zero', () => {
        // Current behaviour: the guard is `if (!min || !max)`, so a legitimate
        // range starting at 0 is discarded. Pinned deliberately; changing it
        // would alter generated fragment and noise values.
        expect(toRange(0, 10)).toBeUndefined();
        expect(toRange(10, 0)).toBeUndefined();
        expect(toRange(undefined, 10)).toBeUndefined();
        expect(toRange(10, undefined)).toBeUndefined();
    });
});

describe('base64ToDecimal', () => {
    it('converts base64 to a byte array', () => {
        // 'AAEC' -> 0x00 0x01 0x02
        expect(base64ToDecimal('AAEC')).toEqual([0, 1, 2]);
    });

    it('round-trips a known Warp-style reserved value', () => {
        const bytes = base64ToDecimal(Buffer.from([1, 2, 3]).toString('base64'));
        expect(bytes).toEqual([1, 2, 3]);
    });

    it('throws on an empty string, which is current behaviour', () => {
        // The non-null assertion on `.match()` makes this a TypeError rather
        // than a graceful empty result.
        expect(() => base64ToDecimal('')).toThrow();
    });
});

describe('global prototype extensions', () => {
    it('concatIf appends a scalar when the condition holds', () => {
        expect([1, 2].concatIf(true, 3)).toEqual([1, 2, 3]);
    });

    it('concatIf spreads an array when the condition holds', () => {
        expect([1].concatIf(true, [2, 3])).toEqual([1, 2, 3]);
    });

    it('concatIf returns the receiver unchanged when the condition is false', () => {
        const input = [1, 2];
        expect(input.concatIf(false, 3)).toEqual([1, 2]);
    });

    it('omitEmpty returns undefined for an empty object and the object otherwise', () => {
        expect(({}).omitEmpty()).toBeUndefined();
        expect(({ a: 1 }).omitEmpty()).toEqual({ a: 1 });
    });

    it('does not make omitEmpty enumerable on plain objects', () => {
        // Guards against for-in loops anywhere in the codebase, or in a future
        // dependency, picking up a phantom key.
        const keys: string[] = [];
        for (const key in { a: 1 }) keys.push(key);
        expect(keys).toEqual(['a']);
    });
});
