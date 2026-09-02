/**
 * The client-compatibility contract.
 *
 * RayZen used to generate configurations that only Xray 26 accepts: a `version.min`
 * floor, a `mixed` inbound, `finalmask` fragmentation and `sockopt.happyEyeballs`. On the
 * cores people actually have installed the profile is refused or comes up with no working
 * outbound, which looks to the user like "the config connects but no website loads".
 *
 * These tests assert the translated shape, because it is the only thing standing between
 * a generated subscription and that failure mode.
 */
import { describe, expect, it } from 'vitest';
import { toUniversalConfig } from '../../src/cores/xray/compat';
import type { Config } from '../../src/types/xray';

function config(): Config {
    return {
        remarks: 'test',
        version: { min: '26.2.6' },
        log: { loglevel: 'warning' },
        dns: {} as Config['dns'],
        inbounds: [
            {
                listen: '127.0.0.1',
                port: 10808,
                protocol: 'mixed',
                settings: { auth: 'noauth', udp: true },
                sniffing: { destOverride: ['http', 'tls'], enabled: true, routeOnly: true },
                tag: 'mixed-in'
            }
        ],
        outbounds: [
            {
                protocol: 'vless',
                tag: 'proxy',
                settings: { vnext: [{ address: 'a.workers.dev', port: 443, users: [{ id: 'u', encryption: 'none' }] }] },
                streamSettings: {
                    network: 'ws',
                    security: 'tls',
                    sockopt: {
                        domainStrategy: 'UseIP',
                        happyEyeballs: { tryDelayMs: 250, prioritizeIPv6: false, interleave: 2, maxConcurrentTry: 4 }
                    },
                    finalmask: {
                        tcp: [{ type: 'fragment', settings: { packets: 'tlshello', length: '10-20', delay: '10-16' } }]
                    }
                }
            },
            {
                protocol: 'freedom',
                tag: 'udp-noise',
                settings: { domainStrategy: 'UseIPv4' },
                streamSettings: {
                    finalmask: {
                        udp: [{ type: 'noise', settings: { reset: '30-60', noise: [{ rand: '50-100', randRange: '0-255', delay: '1-2' }] } }]
                    }
                }
            },
            { protocol: 'dns', tag: 'dns-out', settings: { rules: [{ action: 'hijack' }] } as never }
        ],
        policy: {} as Config['policy'],
        routing: {} as Config['routing'],
        stats: {}
    } as Config;
}

describe('universal compatibility', () => {
    it('declares no version floor', () => {
        expect(toUniversalConfig(config()).version).toBeUndefined();
    });

    it('names the local inbound protocol the core knows', () => {
        // Xray has `socks`, which answers HTTP on the same port. `mixed` is sing-box's word.
        expect(toUniversalConfig(config()).inbounds[0]?.protocol).toBe('socks');
    });

    it('removes sockopt keys older cores reject', () => {
        const proxy = toUniversalConfig(config()).outbounds.find(out => out.tag === 'proxy');

        expect(proxy?.streamSettings?.sockopt).not.toHaveProperty('happyEyeballs');
    });

    it('moves proxy fragmentation onto a freedom dialer', () => {
        const result = toUniversalConfig(config());
        const proxy = result.outbounds.find(out => out.tag === 'proxy');
        const dialer = result.outbounds.find(out => out.tag === 'proxy-fragment');

        expect(proxy?.streamSettings).not.toHaveProperty('finalmask');
        expect(proxy?.streamSettings?.sockopt?.dialerProxy).toBe('proxy-fragment');
        expect(dialer?.protocol).toBe('freedom');
        // `interval` is the pre-26 name for what `finalmask` calls `delay`.
        expect((dialer?.settings as { fragment?: unknown }).fragment).toEqual({
            packets: 'tlshello',
            length: '10-20',
            interval: '10-16'
        });
    });

    it('keeps freedom fragmentation and noise on the freedom outbound itself', () => {
        const noise = toUniversalConfig(config()).outbounds.find(out => out.tag === 'udp-noise');

        expect(noise?.streamSettings).not.toHaveProperty('finalmask');
        expect((noise?.settings as { noises?: unknown[] }).noises).toEqual([
            { type: 'rand', packet: '50-100', delay: '1-2' }
        ]);
    });

    it('drops the DNS outbound rule syntax that needs a 25.7+ core', () => {
        const dns = toUniversalConfig(config()).outbounds.find(out => out.tag === 'dns-out');

        expect(dns?.settings).toEqual({});
    });

    it('adds no outbound that nothing references', () => {
        const result = toUniversalConfig(config());
        const tags = new Set(result.outbounds.map(out => out.tag));
        const referenced = result.outbounds
            .map(out => out.streamSettings?.sockopt?.dialerProxy)
            .filter((tag): tag is string => Boolean(tag));

        for (const tag of referenced) expect(tags.has(tag)).toBe(true);
    });
});
