/**
 * Unit tests for the 26 validators in `src/settings/validators.ts`.
 *
 * All 26 run unconditionally on every settings save (validators.ts:39-44) and
 * push into a shared error array, so a validator that *throws* instead of
 * pushing takes down the whole save with a 500. Every validator therefore gets
 * at least one malformed-input case in addition to accept/reject cases.
 *
 * Several assertions pin behaviour that is arguably wrong. Those are commented
 * as FINDING so that a deliberate fix shows up as an intentional test change.
 * SECURITY.md records which of them are known limitations rather than oversights.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { validateSettings, type ValidationError } from '@validators';
import { initRequestGlobals, validSettingsForm } from '../helpers/worker';
import type { PanelSettings } from '#types/settings';

beforeAll(async () => {
    // validatePorts reads httpsPorts from the module-scope request globals.
    await initRequestGlobals();
});

/** Runs the full validator suite over a form built from valid defaults. */
function validate(overrides: Record<string, unknown> = {}): ValidationError[] {
    const form = { ...validSettingsForm(), ...overrides } as unknown as PanelSettings;
    return validateSettings(form) ?? [];
}

/** True when at least one error was reported for the given field label. */
function hasError(errors: ValidationError[], field: string): boolean {
    return errors.some(error => error.field === field);
}

describe('validateSettings aggregate', () => {
    it('returns null for a null form', () => {
        expect(validateSettings(null)).toBeNull();
    });

    it('returns null when the default form is valid', () => {
        expect(validateSettings(validSettingsForm() as unknown as PanelSettings)).toBeNull();
    });

    it('reports several independent errors at once', () => {
        const errors = validate({ localDNS: 'nope', warpRemoteDNS: 'nope' });
        expect(hasError(errors, 'Local DNS')).toBe(true);
        expect(hasError(errors, 'Warp Remote DNS')).toBe(true);
    });

    it('reports a partial body as a validation error rather than throwing', () => {
        // Every validator reads its fields straight off the form, so a body missing
        // a field throws. The caller turns that into a 500, which reports a client
        // error as a server fault and records no rejection. The aggregate wraps each
        // validator so a missing field is reported as what it is.
        const errors = validateSettings({} as unknown as PanelSettings);

        expect(errors).not.toBeNull();
        expect(hasError(errors ?? [], 'Settings')).toBe(true);
    });

    it('names the failing check in the message, without putting it in the label', () => {
        // The label is a contract: `src/features/validation/service.ts` maps labels to
        // stable codes. The validator name is useful in a bug report and must not
        // become part of that contract.
        const errors = validateSettings({} as unknown as PanelSettings) ?? [];
        const generic = errors.filter(error => error.field === 'Settings');

        expect(generic.length).toBeGreaterThan(0);
        expect(generic[0].message.join(' ')).toMatch(/The check that failed was 'validate\w+'/);
    });

    it('a complete valid form is unaffected by the wrapper', () => {
        // The wrapper must be invisible on the path that matters: no validator throws
        // for a complete form, so the output is what it was before.
        expect(validateSettings(validSettingsForm() as unknown as PanelSettings)).toBeNull();
    });

    it('returns null for a non-object body rather than throwing', () => {
        expect(validateSettings('not an object' as unknown as PanelSettings)).toBeNull();
        expect(validateSettings(42 as unknown as PanelSettings)).toBeNull();
    });
});

describe('validatePorts', () => {
    it('accepts a list containing a TLS port', () => {
        expect(hasError(validate({ ports: [443] }), 'Ports')).toBe(false);
    });

    it('rejects a list with no TLS port', () => {
        expect(hasError(validate({ ports: [80] }), 'Ports')).toBe(true);
    });

    it('rejects an empty list', () => {
        expect(hasError(validate({ ports: [] }), 'Ports')).toBe(true);
    });
});

describe('validateRemoteDNS', () => {
    it.each([
        'https://dns.google/dns-query',
        'tls://dns.google',
        'tcp://8.8.8.8'
    ])('accepts %s', remoteDNS => {
        expect(hasError(validate({ remoteDNS }), 'Remote DNS')).toBe(false);
    });

    it('rejects an unparseable URL', () => {
        expect(hasError(validate({ remoteDNS: 'not a url' }), 'Remote DNS')).toBe(true);
    });

    it('rejects a protocol outside tcp/https/tls', () => {
        expect(hasError(validate({ remoteDNS: 'udp://8.8.8.8' }), 'Remote DNS')).toBe(true);
    });

    it.each([
        'https://1.1.1.1/dns-query',
        'https://1.0.0.1/dns-query',
        'https://one.one.one.one/dns-query',
        'https://cloudflare-dns.com/dns-query',
        'https://family.cloudflare-dns.com/dns-query',
        'https://security.cloudflare-dns.com/dns-query'
    ])('rejects the Cloudflare resolver %s', remoteDNS => {
        // Workers cannot reach Cloudflare's own resolvers from inside the edge,
        // so accepting one produces a config whose DNS silently fails.
        expect(hasError(validate({ remoteDNS }), 'Remote DNS')).toBe(true);
    });

    it.each([
        'https://[2606:4700:4700::1111]/dns-query',
        'https://[2606:4700:4700::1001]/dns-query',
        'https://[2606:4700:4700::1112]/dns-query'
    ])('FINDING: the IPv6 Cloudflare resolver %s is NOT rejected', remoteDNS => {
        // The blocklist at validators.ts:74-89 stores IPv6 addresses bare
        // ('2606:4700:4700::1111'), but `new URL(...).hostname` returns them
        // bracketed ('[2606:4700:4700::1111]'). The six IPv6 entries can therefore
        // never match, so a user who enters Cloudflare's IPv6 resolver gets a
        // config that silently fails to resolve DNS.
        //
        // Pinned as current behaviour. The fix is to strip brackets before the
        // comparison, which only widens what is rejected and cannot invalidate
        // any DNS server that actually works.
        expect(hasError(validate({ remoteDNS }), 'Remote DNS')).toBe(false);
    });
});

describe('validateSanctionDns', () => {
    it.each(['178.22.122.100', 'dns.example.com', 'https://dns.example.com/dns-query'])(
        'accepts %s',
        antiSanctionDNS => {
            expect(hasError(validate({ antiSanctionDNS }), 'Anti Sanction DNS')).toBe(false);
        }
    );

    it('rejects a host with a port, because requirePort is false', () => {
        expect(hasError(validate({ antiSanctionDNS: 'dns.example.com:53' }), 'Anti Sanction DNS')).toBe(true);
    });

    it('rejects garbage', () => {
        expect(hasError(validate({ antiSanctionDNS: '!!!' }), 'Anti Sanction DNS')).toBe(true);
    });
});

describe('validateLocalDNS', () => {
    it.each(['8.8.8.8', '127.0.0.1', 'localhost'])('accepts %s', localDNS => {
        expect(hasError(validate({ localDNS }), 'Local DNS')).toBe(false);
    });

    it.each(['dns.example.com', '[::1]', ''])('rejects %s', localDNS => {
        expect(hasError(validate({ localDNS }), 'Local DNS')).toBe(true);
    });
});

describe('validateWarpDNS', () => {
    it('accepts an IPv4 address', () => {
        expect(hasError(validate({ warpRemoteDNS: '1.1.1.1' }), 'Warp Remote DNS')).toBe(false);
    });

    it.each(['dns.example.com', 'https://1.1.1.1/dns-query', '[2001:db8::1]'])(
        'rejects %s because WARP DNS is UDP-only',
        warpRemoteDNS => {
            expect(hasError(validate({ warpRemoteDNS }), 'Warp Remote DNS')).toBe(true);
        }
    );
});

describe('validateCustomRules', () => {
    it('accepts CIDR and domain bypass rules', () => {
        const errors = validate({ customBypassRules: ['10.0.0.0/8', 'example.com', '2001:db8::/32'] });
        expect(hasError(errors, 'Routing Custom Rules')).toBe(false);
    });

    it('rejects an invalid bypass rule and names it in the message', () => {
        const errors = validate({ customBypassRules: ['example.com', 'not a rule'] });
        expect(hasError(errors, 'Routing Custom Rules')).toBe(true);
        const message = errors.find(e => e.field === 'Routing Custom Rules')!.message.join('\n');
        expect(message).toContain('not a rule');
        expect(message).not.toContain('+ example.com');
    });

    it('accepts only domains for sanction rules, not CIDRs', () => {
        expect(hasError(validate({ customBypassSanctionRules: ['example.com'] }), 'Routing Sanction Rules')).toBe(false);
        expect(hasError(validate({ customBypassSanctionRules: ['10.0.0.0/8'] }), 'Routing Sanction Rules')).toBe(true);
    });

    it('validates block rules with the same grammar as bypass rules', () => {
        expect(hasError(validate({ customBlockRules: ['ads.example.com'] }), 'Routing Custom Rules')).toBe(false);
        expect(hasError(validate({ customBlockRules: ['nope!'] }), 'Routing Custom Rules')).toBe(true);
    });
});

describe('validateCleanIPs', () => {
    it('accepts domains and IPv4 addresses', () => {
        expect(hasError(validate({ cleanIPs: ['www.speedtest.net', '1.2.3.4'] }), 'Clean IPs - Domains')).toBe(false);
    });

    it('accepts an empty list', () => {
        expect(hasError(validate({ cleanIPs: [] }), 'Clean IPs - Domains')).toBe(false);
    });

    it('rejects an invalid entry', () => {
        expect(hasError(validate({ cleanIPs: ['not a host!'] }), 'Clean IPs - Domains')).toBe(true);
    });
});

describe('validateProxyIPs', () => {
    it('accepts a host with and without a port', () => {
        expect(hasError(validate({ proxyIPs: ['proxy.example.com'] }), 'Proxy IPs - Domains')).toBe(false);
        expect(hasError(validate({ proxyIPs: ['proxy.example.com:443'] }), 'Proxy IPs - Domains')).toBe(false);
    });

    it('accepts a bracketed IPv6 address with a port', () => {
        expect(hasError(validate({ proxyIPs: ['[2001:db8::1]:443'] }), 'Proxy IPs - Domains')).toBe(false);
    });

    it('rejects garbage', () => {
        expect(hasError(validate({ proxyIPs: ['???'] }), 'Proxy IPs - Domains')).toBe(true);
    });
});

describe('validateNAT64Prefixes', () => {
    it('accepts a bracketed IPv6 prefix', () => {
        expect(hasError(validate({ prefixes: ['[2a02:898:146:64::]'] }), 'NAT64 Prefixes')).toBe(false);
    });

    it('rejects an unbracketed prefix and an IPv4 address', () => {
        expect(hasError(validate({ prefixes: ['2a02:898:146:64::'] }), 'NAT64 Prefixes')).toBe(true);
        expect(hasError(validate({ prefixes: ['10.0.0.1'] }), 'NAT64 Prefixes')).toBe(true);
    });
});

describe('validateWarpEndpoints', () => {
    it('accepts host:port forms', () => {
        expect(hasError(validate({ warpEndpoints: ['engage.cloudflareclient.com:2408'] }), 'Warp Endpoints')).toBe(false);
        expect(hasError(validate({ warpEndpoints: ['[2001:db8::1]:2408'] }), 'Warp Endpoints')).toBe(false);
    });

    it('rejects a bare host, because a port is required here', () => {
        expect(hasError(validate({ warpEndpoints: ['engage.cloudflareclient.com'] }), 'Warp Endpoints')).toBe(true);
    });
});

describe('validateMinMax', () => {
    it.each([
        ['Fragment Length', 'fragmentLengthMin', 'fragmentLengthMax'],
        ['Fragment Delay', 'fragmentDelayMin', 'fragmentDelayMax'],
        ['Fragment Max Split', 'fragmentMaxSplitMin', 'fragmentMaxSplitMax'],
        ['MahsaNG Noise Count', 'knockerNoiseCountMin', 'knockerNoiseCountMax'],
        ['MahsaNG Noise Size', 'knockerNoiseSizeMin', 'knockerNoiseSizeMax'],
        ['MahsaNGNoise Delay', 'knockerNoiseDelayMin', 'knockerNoiseDelayMax'],
        ['Amnezia Noise Size', 'amneziaNoiseSizeMin', 'amneziaNoiseSizeMax']
    ])('reports %s when min exceeds max', (field, minKey, maxKey) => {
        expect(hasError(validate({ [minKey]: 10, [maxKey]: 5 }), field)).toBe(true);
        expect(hasError(validate({ [minKey]: 5, [maxKey]: 5 }), field)).toBe(false);
    });

    it('note: the "MahsaNGNoise Delay" label is missing a space (cosmetic, pinned)', () => {
        // The field label is rendered in the panel, so correcting it is a UI-visible
        // change. Pinned so a fix is deliberate.
        const errors = validate({ knockerNoiseDelayMin: 9, knockerNoiseDelayMax: 1 });
        expect(errors.map(e => e.field)).toContain('MahsaNGNoise Delay');
    });

    it('FINDING: non-numeric bounds pass, because NaN comparisons are false', () => {
        // Number('abc') > Number('5') is false, so the guard never fires.
        expect(hasError(validate({ fragmentLengthMin: 'abc', fragmentLengthMax: 5 }), 'Fragment Length')).toBe(false);
    });
});

describe('validateChainProxy', () => {
    it('accepts an empty value', () => {
        expect(hasError(validate({ chainProxy: '' }), 'Chain Proxy')).toBe(false);
    });

    it.each([
        'socks://dXNlcjpwYXNz@1.2.3.4:1080',
        'socks5://user:pass@1.2.3.4:1080',
        'http://user:pass@1.2.3.4:8080'
    ])('accepts %s', chainProxy => {
        expect(hasError(validate({ chainProxy }), 'Chain Proxy')).toBe(false);
    });

    it('accepts a vless URI with an allowed security and transport', () => {
        const uri = 'vless://00000000-0000-4000-8000-000000000002@1.2.3.4:443?security=tls&type=ws';
        expect(hasError(validate({ chainProxy: uri }), 'Chain Proxy')).toBe(false);
    });

    it('rejects a vless URI with a disallowed security value', () => {
        const uri = 'vless://00000000-0000-4000-8000-000000000002@1.2.3.4:443?security=xtls&type=ws';
        expect(hasError(validate({ chainProxy: uri }), 'Chain Proxy')).toBe(true);
    });

    it('rejects a vless URI with a disallowed transport', () => {
        const uri = 'vless://00000000-0000-4000-8000-000000000002@1.2.3.4:443?security=tls&type=quic';
        expect(hasError(validate({ chainProxy: uri }), 'Chain Proxy')).toBe(true);
    });

    it('rejects a vless URI with no credential', () => {
        const uri = 'vless://@1.2.3.4:443?security=tls&type=ws';
        expect(hasError(validate({ chainProxy: uri }), 'Chain Proxy')).toBe(true);
    });

    it('reports malformed input as a field error rather than throwing', () => {
        // REGRESSION GUARD. Both regexes fail, and `new URL(chainProxy)` used to run
        // anyway, so the whole settings save became a 500 instead of a 400 with a
        // field error. The validator now returns after pushing, because everything
        // past that point inspects a URL already known not to be one.
        expect(() => validate({ chainProxy: 'garbage' })).not.toThrow();
        expect(hasError(validate({ chainProxy: 'garbage' }), 'Chain Proxy')).toBe(true);
    });
});

describe('validateCustomCdn', () => {
    it('accepts all three fields empty', () => {
        const errors = validate({ customCdnAddrs: [], customCdnHost: '', customCdnSni: '' });
        expect(hasError(errors, 'Custom CDN')).toBe(false);
    });

    it('accepts all three fields set and valid', () => {
        const errors = validate({
            customCdnAddrs: ['cdn.example.com'],
            customCdnHost: 'host.example.com',
            customCdnSni: 'sni.example.com'
        });
        expect(hasError(errors, 'Custom CDN')).toBe(false);
    });

    it('rejects a partially filled group', () => {
        expect(hasError(validate({ customCdnHost: 'host.example.com' }), 'Custom CDN')).toBe(true);
    });

    it('rejects a non-domain SNI or host', () => {
        const errors = validate({
            customCdnAddrs: ['cdn.example.com'],
            customCdnHost: '1.2.3.4',
            customCdnSni: 'sni.example.com'
        });
        expect(hasError(errors, 'Custom CDN Host')).toBe(true);
    });

    it('rejects an invalid address in the list', () => {
        const errors = validate({
            customCdnAddrs: ['bad host!'],
            customCdnHost: 'host.example.com',
            customCdnSni: 'sni.example.com'
        });
        expect(hasError(errors, 'Custom CDN Addresses')).toBe(true);
    });
});

describe('validateKnockerNoise', () => {
    it.each(['none', 'quic', 'random', '00ff'])('accepts %s', knockerNoiseMode => {
        expect(hasError(validate({ knockerNoiseMode }), 'MahsaNG Noise')).toBe(false);
    });

    it('rejects a non-hex word', () => {
        expect(hasError(validate({ knockerNoiseMode: 'xyz' }), 'MahsaNG Noise')).toBe(true);
    });

    it('FINDING: odd-length hex is accepted, unlike isHex elsewhere', () => {
        // The regex is [0-9A-Fa-f]+ with no even-length constraint, so '0ff' passes
        // here but would fail isHex(). Inconsistent, pinned.
        expect(hasError(validate({ knockerNoiseMode: '0ff' }), 'MahsaNG Noise')).toBe(false);
    });
});

describe('validateXrayNoises', () => {
    it('accepts a valid rand range', () => {
        const noises = [{ type: 'rand', packet: '50-100', delay: '1-5', count: 5 }];
        expect(hasError(validate({ xrayUdpNoises: noises }), 'Xray Noise Packet')).toBe(false);
    });

    it('rejects a rand packet that is not a range', () => {
        const noises = [{ type: 'rand', packet: 'abc', delay: '1-5', count: 5 }];
        expect(hasError(validate({ xrayUdpNoises: noises }), 'Xray Noise Packet')).toBe(true);
    });

    it('rejects a rand range whose min exceeds max', () => {
        const noises = [{ type: 'rand', packet: '100-50', delay: '1-5', count: 5 }];
        expect(hasError(validate({ xrayUdpNoises: noises }), 'Xray Noise Packet')).toBe(true);
    });

    it('rejects invalid base64, hex, and array packets', () => {
        expect(hasError(validate({ xrayUdpNoises: [{ type: 'base64', packet: 'a', delay: '1-1', count: 1 }] }), 'Xray Noise Packet')).toBe(true);
        expect(hasError(validate({ xrayUdpNoises: [{ type: 'hex', packet: '0f0', delay: '1-1', count: 1 }] }), 'Xray Noise Packet')).toBe(true);
        expect(hasError(validate({ xrayUdpNoises: [{ type: 'array', packet: '1,300', delay: '1-1', count: 1 }] }), 'Xray Noise Packet')).toBe(true);
    });

    it('accepts a valid array packet at the 0-255 boundaries', () => {
        const noises = [{ type: 'array', packet: '0,128,255', delay: '1-1', count: 1 }];
        expect(hasError(validate({ xrayUdpNoises: noises }), 'Xray Noise Packet')).toBe(false);
    });

    it('reports a delay whose min exceeds max', () => {
        const noises = [{ type: 'rand', packet: '1-2', delay: '9-1', count: 1 }];
        expect(hasError(validate({ xrayUdpNoises: noises }), 'Xray Noise Delay')).toBe(true);
    });

    it('FINDING: an unknown noise type skips packet validation entirely', () => {
        // The switch has no default branch, so a typo'd type is silently accepted
        // with an arbitrary packet.
        const noises = [{ type: 'randm', packet: 'totally invalid', delay: '1-1', count: 1 }];
        expect(hasError(validate({ xrayUdpNoises: noises }), 'Xray Noise Packet')).toBe(false);
    });
});

describe('validateEchConfig', () => {
    it('accepts an empty value and a domain', () => {
        expect(hasError(validate({ echServerName: '' }), 'ECH Server Name')).toBe(false);
        expect(hasError(validate({ echServerName: 'ech.example.com' }), 'ECH Server Name')).toBe(false);
    });

    it('rejects an IP address', () => {
        expect(hasError(validate({ echServerName: '1.2.3.4' }), 'ECH Server Name')).toBe(true);
    });
});

describe('validateUpstreamProxy', () => {
    it('accepts an empty value and host:port', () => {
        expect(hasError(validate({ upstreamProxy: '' }), 'Upstream Proxy')).toBe(false);
        expect(hasError(validate({ upstreamProxy: 'up.example.com:8443' }), 'Upstream Proxy')).toBe(false);
    });

    it('rejects a bare host', () => {
        expect(hasError(validate({ upstreamProxy: 'up.example.com' }), 'Upstream Proxy')).toBe(true);
    });
});

describe('validateUUID', () => {
    it('accepts a v4 UUID in either case', () => {
        expect(hasError(validate({ vlUUID: '00000000-0000-4000-8000-000000000003' }), 'VLESS UUID')).toBe(false);
        expect(hasError(validate({ vlUUID: '00000000-0000-4000-8000-00000000000A'.toUpperCase() }), 'VLESS UUID')).toBe(false);
    });

    it('rejects a non-v4 UUID, a wrong variant nibble, and an empty value', () => {
        expect(hasError(validate({ vlUUID: '00000000-0000-1000-8000-000000000003' }), 'VLESS UUID')).toBe(true);
        expect(hasError(validate({ vlUUID: '00000000-0000-4000-7000-000000000003' }), 'VLESS UUID')).toBe(true);
        expect(hasError(validate({ vlUUID: '' }), 'VLESS UUID')).toBe(true);
    });
});

describe('validateTrPass', () => {
    it('accepts the documented charset', () => {
        expect(hasError(validate({ trPass: 'Abc123!@$&*_-+;:,.' }), 'Trojan Password')).toBe(false);
    });

    it('rejects a space and a character outside the charset', () => {
        expect(hasError(validate({ trPass: 'has space' }), 'Trojan Password')).toBe(true);
        expect(hasError(validate({ trPass: 'has#hash' }), 'Trojan Password')).toBe(true);
    });

    it('FINDING: the empty string is accepted', () => {
        // [...''].every() is vacuously true, so an empty Trojan password passes
        // validation and is then hashed into a usable credential.
        expect(hasError(validate({ trPass: '' }), 'Trojan Password')).toBe(false);
    });
});

describe('validatePath', () => {
    it('accepts the documented charset', () => {
        expect(hasError(validate({ securePath: 'Abc123-_' }), 'Panel - Subscriptions Path')).toBe(false);
    });

    it('rejects a slash', () => {
        expect(hasError(validate({ securePath: 'a/b' }), 'Panel - Subscriptions Path')).toBe(true);
    });

    it('FINDING: the empty string is accepted, collapsing every route', () => {
        // Same vacuous-every hole as validateTrPass. An empty securePath makes
        // every route resolve as //panel.
        expect(hasError(validate({ securePath: '' }), 'Panel - Subscriptions Path')).toBe(false);
    });

    it('FINDING: a single character is accepted, so there is no entropy floor', () => {
        expect(hasError(validate({ securePath: 'a' }), 'Panel - Subscriptions Path')).toBe(false);
    });
});

describe('validateFallback', () => {
    it('accepts an empty value and a domain', () => {
        expect(hasError(validate({ fallback: '' }), 'Fallback Domain')).toBe(false);
        expect(hasError(validate({ fallback: 'example.com' }), 'Fallback Domain')).toBe(false);
    });

    it('rejects an IP address', () => {
        expect(hasError(validate({ fallback: '1.2.3.4' }), 'Fallback Domain')).toBe(true);
    });
});

describe('validateDoH', () => {
    it('accepts an empty value', () => {
        expect(hasError(validate({ dohUrl: '' }), 'Underlying DoH URL')).toBe(false);
    });

    it('accepts an https URL ending in /dns-query', () => {
        expect(hasError(validate({ dohUrl: 'https://doh.example.com/dns-query' }), 'Underlying DoH URL')).toBe(false);
    });

    it('rejects http, a wrong path, and an unparseable value', () => {
        expect(hasError(validate({ dohUrl: 'http://doh.example.com/dns-query' }), 'Underlying DoH URL')).toBe(true);
        expect(hasError(validate({ dohUrl: 'https://doh.example.com/resolve' }), 'Underlying DoH URL')).toBe(true);
        expect(hasError(validate({ dohUrl: 'not a url' }), 'Underlying DoH URL')).toBe(true);
    });
});

describe('validateCustomDomain', () => {
    it('accepts an empty value and a domain', () => {
        expect(hasError(validate({ customDomain: '' }), 'Custom Domain')).toBe(false);
        expect(hasError(validate({ customDomain: 'panel.example.com' }), 'Custom Domain')).toBe(false);
    });

    it('rejects a host with a port', () => {
        expect(hasError(validate({ customDomain: 'panel.example.com:443' }), 'Custom Domain')).toBe(true);
    });
});

describe('validateExtSubs', () => {
    it('accepts http and https URLs and an empty list', () => {
        expect(hasError(validate({ customSubs: [] }), 'External Raw subscriptions')).toBe(false);
        expect(hasError(validate({ customSubs: ['https://example.com/sub', 'http://example.com/sub'] }), 'External Raw subscriptions')).toBe(false);
    });

    it('rejects a non-http scheme and garbage', () => {
        expect(hasError(validate({ customSubs: ['ftp://example.com/sub'] }), 'External Raw subscriptions')).toBe(true);
        expect(hasError(validate({ customSubs: ['nope'] }), 'External Raw subscriptions')).toBe(true);
    });
});

describe('validateRemoteSettings', () => {
    it('accepts an empty value', () => {
        expect(hasError(validate({ remoteSettings: '' }), 'Remote Settings URL')).toBe(false);
    });

    it('accepts a URL whose path is sub/share-settings under a secure path', () => {
        const url = 'https://panel.example.com/anysecurepath/sub/share-settings';
        expect(hasError(validate({ remoteSettings: url }), 'Remote Settings URL')).toBe(false);
    });

    it('rejects an unparseable URL and a wrong path', () => {
        expect(hasError(validate({ remoteSettings: 'nope' }), 'Remote Settings URL')).toBe(true);
        expect(hasError(validate({ remoteSettings: 'https://panel.example.com/x/sub/other' }), 'Remote Settings URL')).toBe(true);
    });
});
