/**
 * Client compatibility for generated Xray configurations.
 *
 * The bug this fixes
 *
 * RayZen generated configurations that only the newest Xray core accepts, while
 * configurations from older panels loaded websites on the same device. Four fields were
 * responsible, and none of them is visible as an error in most clients: the core refuses
 * the profile, the tunnel comes up with no working outbound, and the browser shows a
 * blank page.
 *
 *  - `version.min: '26.2.6'`. Clients that read it reject the profile outright.
 *  - `protocol: 'mixed'` on the local inbound. Xray has `socks` (which also answers HTTP);
 *    `mixed` is sing-box vocabulary and is unknown to every core v2rayNG has shipped.
 *  - `streamSettings.finalmask`. Fragmentation moved there in Xray 26; before that it lives
 *    on the `freedom` outbound as `settings.fragment`, reached through `sockopt.dialerProxy`.
 *  - `sockopt.happyEyeballs`. Not accepted by older cores, and an unknown key inside
 *    `sockopt` fails the whole config rather than being ignored.
 *
 * So the builders keep emitting the modern shape, and this module translates one config
 * into the shape that every mainstream core accepts. `universal` is the default because a
 * config that works everywhere is worth more than one that uses the newest obfuscation on
 * the small share of installs that have it.
 */

import type {
    Config,
    FreedomSettings,
    Noise,
    Outbound,
    TCPMask,
    UDPMask
} from '#types/xray';
import { getSettings } from '@settings';

/** Legacy `freedom` fragment settings: what every core from 1.8 to 26 understands. */
function legacyFragment(mask: TCPMask): FreedomSettings['fragment'] {
    const { packets, length, delay } = mask.settings;
    return { packets, length, interval: delay };
}

/** Legacy `freedom` UDP noise entries. `rand`/`randRange` is the Xray 26 spelling. */
function legacyNoises(mask: UDPMask): Noise[] {
    return (mask.settings.noise ?? []).map(noise => noise.rand
        ? { type: 'rand', packet: noise.rand, delay: noise.delay }
        : { type: noise.type, packet: noise.packet, delay: noise.delay }
    );
}

function fragmentDialer(tag: string, mask: TCPMask, domainStrategy: FreedomSettings['domainStrategy']): Outbound {
    return {
        protocol: 'freedom',
        tag,
        settings: {
            domainStrategy,
            fragment: legacyFragment(mask)
        },
        streamSettings: {
            sockopt: {
                tcpKeepAliveIdle: 100,
                tcpNoDelay: true
            }
        }
    } as unknown as Outbound;
}

/**
 * Rewrites a config into the universally accepted shape.
 *
 * Mutates and returns the same object: it is built for this response and is not shared.
 */
export function toUniversalConfig(config: Config): Config {
    // A version floor tells a client to refuse the profile. Nothing below depends on a
    // core newer than 1.8, so there is nothing to declare.
    delete (config as { version?: unknown }).version;

    for (const inbound of config.inbounds) {
        // `socks` in Xray answers HTTP on the same port, so this is the same behaviour
        // under the name the core actually knows.
        if (inbound.protocol === 'mixed') inbound.protocol = 'socks';
    }

    const dialers: Outbound[] = [];

    for (const outbound of config.outbounds) {
        // The DNS outbound's rule syntax is Xray 25.7+. Without it the outbound still
        // hijacks the queries routed to it, which is all it is used for here.
        if (outbound.protocol === 'dns') outbound.settings = {} as Outbound['settings'];

        const stream = outbound.streamSettings;
        if (!stream) continue;

        if (stream.sockopt?.happyEyeballs) delete stream.sockopt.happyEyeballs;

        const mask = stream.finalmask;
        if (!mask) continue;
        delete stream.finalmask;

        const tcp = mask.tcp?.find(entry => entry.type === 'fragment');
        const udp = mask.udp?.find(entry => entry.settings?.noise?.length);

        if (outbound.protocol === 'freedom') {
            const settings = outbound.settings as FreedomSettings;
            if (tcp) settings.fragment = legacyFragment(tcp);
            if (udp) settings.noises = legacyNoises(udp);
            continue;
        }

        // A proxy outbound cannot fragment itself on an older core: it dials through a
        // `freedom` outbound that does. That is the chain every long-lived panel uses.
        if (tcp) {
            const tag = `${outbound.tag}-fragment`;
            stream.sockopt = { ...stream.sockopt, dialerProxy: stream.sockopt?.dialerProxy ?? tag };
            dialers.push(fragmentDialer(tag, tcp, 'UseIP'));
        }
    }

    // Dialers are appended, so no existing tag or routing reference moves.
    config.outbounds.push(...dialers);

    return config;
}

/** Applies the deployment's chosen compatibility level. `latest` is a no-op. */
export function applyClientCompat(config: Config): Config {
    const { clientCompat } = getSettings();
    return clientCompat === 'latest' ? config : toUniversalConfig(config);
}
