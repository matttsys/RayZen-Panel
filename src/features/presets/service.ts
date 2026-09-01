/**
 * Preset framework: named, reviewable bundles of settings for a stated purpose.
 *
 * Why presets rather than more defaults
 *
 * A RayZen deployment has around 80 configurable fields, and the combinations that
 * actually work well are far fewer than the combinations that are valid. Today the
 * only guidance a user gets is the default value of each field considered in
 * isolation, which cannot express "on a restricted network, use these six settings
 * together". A preset encodes that knowledge once, in a place a reviewer can argue
 * with.
 *
 * Three properties that make A preset safe to apply
 *
 *   1. **A preset is a patch, never a settings object.** Applying "Performance"
 *      must not silently revert the user's UUID, ports or routing rules. `patch`
 *      holds only the keys the preset has an opinion about, and `preserves` names
 *      the keys it deliberately leaves alone so the intent is documented rather
 *      than inferred from absence.
 *   2. **Applying is a preview, not a write.** `apply` returns the merged object
 *      plus the list of keys that would actually change. Nothing is persisted here
 *      and nothing skips validation: the caller passes the result through the
 *      normal validation and settings write path, so a preset cannot introduce a
 *      value the validators would reject.
 *   3. **No preset touches a secret or an identity.** `FORBIDDEN_KEYS` is enforced
 *      at construction time, so a preset that tried to set `vlUUID`, `trPass`,
 *      `securePath`, or `apiToken` fails to register rather than shipping. A
 *      preset that could rotate the UUID would break every client that already has
 *      a subscription, and one that could set `securePath` would be a way to move
 *      the panel out from under its owner.
 *
 * What A preset is not
 *
 * Not remote configuration. The catalogue is compiled into the Worker; there is no
 * endpoint that fetches presets and no way for one to arrive over the network. A
 * downloadable "recommended settings" feed pointed at censorship-circumvention
 * users would be a mechanism for degrading them all at once.
 */

import type { Preset, PresetApplication, PresetAudience } from '#types/platform';

/**
 * Keys no preset may set, for the reasons in the header. Enforced by
 * `createPresetRegistry`, which throws rather than filtering: a preset author who
 * included one of these has misunderstood something, and silently dropping the key
 * would hide that.
 */
export const FORBIDDEN_KEYS: readonly string[] = [
    'vlUUID',
    'trPass',
    'securePath',
    'apiToken',
    'accID',
    'accEmail',
    'customDomain',
    'panelVersion'
];

export interface PresetRegistry {
    register(preset: Preset): PresetRegistry;
    list(): readonly Preset[];
    /** Presets for one audience, in registration order. */
    byAudience(audience: PresetAudience): readonly Preset[];
    get(id: string): Preset | null;
    /**
     * Computes the effect of a preset against current settings without writing.
     * Returns null when the id is unknown, so a caller distinguishes "no such
     * preset" from "preset that changes nothing".
     */
    apply(id: string, current: Record<string, unknown>): PresetApplication | null;
}

/**
 * Compares a preset value with the current one.
 *
 * Arrays are compared by their JSON form because every array in the settings shape
 * is a list of scalars (ports, addresses, rules) where order is meaningful. Deep
 * structural comparison would be more general and would also silently accept a
 * nested object, which no preset is allowed to contain.
 */
function differs(next: unknown, current: unknown): boolean {
    if (Array.isArray(next) || Array.isArray(current)) {
        return JSON.stringify(next) !== JSON.stringify(current);
    }

    return next !== current;
}

export function createPresetRegistry(presets: readonly Preset[] = []): PresetRegistry {
    const catalogue = new Map<string, Preset>();

    const registry: PresetRegistry = {
        register(preset) {
            if (catalogue.has(preset.id)) {
                throw new Error(`Preset '${preset.id}' is already registered.`);
            }

            const forbidden = Object.keys(preset.patch).filter(key => FORBIDDEN_KEYS.includes(key));
            if (forbidden.length > 0) {
                throw new Error(
                    `Preset '${preset.id}' may not set protected key(s): ${forbidden.join(', ')}.`
                );
            }

            catalogue.set(preset.id, preset);
            return registry;
        },

        list() {
            return Array.from(catalogue.values());
        },

        byAudience(audience) {
            return Array.from(catalogue.values()).filter(preset => preset.audience === audience);
        },

        get(id) {
            return catalogue.get(id) ?? null;
        },

        apply(id, current) {
            const preset = catalogue.get(id);
            if (!preset) return null;

            const changed = Object.keys(preset.patch).filter(key => differs(preset.patch[key], current[key]));

            return {
                preset,
                changed,
                // Spread order matters: the preset wins over the current value for
                // the keys it names, and every other key survives untouched.
                result: { ...current, ...preset.patch }
            };
        }
    };

    for (const preset of presets) registry.register(preset);
    return registry;
}

/**
 * Every preset RayZen ships.
 *
 * Each `description` states the trade-off rather than selling the preset, because
 * every one of these costs something. A user who reads only the description should
 * understand what they are giving up.
 */
export const CORE_PRESETS: readonly Preset[] = [
    {
        id: 'balanced',
        title: 'Balanced',
        description:
            'Sensible defaults for a working connection: encrypted DNS, TLS ports, quiet client logs, ' +
            'and ad and malware blocking. Start here if you are unsure.',
        audience: 'general',
        patch: {
            remoteDNS: 'https://8.8.8.8/dns-query',
            localDNS: '8.8.8.8',
            logLevel: 'warning',
            allowLANConnection: false,
            fakeDNS: false,
            blockAds: true,
            blockMalware: true,
            blockPhishing: true
        },
        preserves: ['ports', 'protocols', 'cleanIPs', 'customCdnAddrs', 'warpEndpoints']
    },
    {
        id: 'restricted-network',
        title: 'Restricted network',
        description:
            'For networks that actively interfere with traffic. Enables fragmentation and ECH so the ' +
            'TLS handshake is harder to classify, and keeps logs off the device. Costs some throughput ' +
            'and adds connection setup latency.',
        audience: 'restricted-network',
        patch: {
            fragmentMode: 'medium',
            fragmentPackets: 'tlshello',
            enableECH: true,
            logLevel: 'none',
            allowLANConnection: false,
            remoteDNS: 'https://8.8.8.8/dns-query',
            blockUDP443: true
        },
        preserves: ['ports', 'cleanIPs', 'customCdnAddrs', 'customBypassRules']
    },
    {
        id: 'performance',
        title: 'Performance',
        description:
            'Prioritises throughput and latency: no fragmentation, TCP Fast Open, IPv6 enabled, and a ' +
            'short best-ping interval. Easier for a middlebox to classify, so use it on a network that ' +
            'does not interfere.',
        audience: 'performance',
        patch: {
            fragmentMode: 'low',
            enableTFO: true,
            enableIPv6: true,
            bestPingInterval: 30,
            blockUDP443: false,
            logLevel: 'error'
        },
        preserves: ['ports', 'protocols', 'remoteDNS', 'cleanIPs']
    },
    {
        id: 'privacy',
        title: 'Privacy first',
        description:
            'Minimises what is recorded and what leaks: no client logging, encrypted DNS only, no LAN ' +
            'sharing, no fake DNS, and tracker blocking. Debugging a problem in this mode is harder ' +
            'because the client keeps no log.',
        audience: 'privacy',
        patch: {
            logLevel: 'none',
            fakeDNS: false,
            allowLANConnection: false,
            remoteDNS: 'https://1.1.1.1/dns-query',
            localDNS: '1.1.1.1',
            blockAds: true,
            blockMalware: true,
            blockPhishing: true,
            blockCryptominers: true
        },
        preserves: ['ports', 'protocols', 'customBypassRules', 'warpEndpoints']
    }
,
    { id: 'smart-low-latency', title: 'Low Latency', description: 'Reduces avoidable setup delay while preserving endpoint and identity choices.', audience: 'latency', patch: { fragmentMode: 'low', enableTFO: true, bestPingInterval: 30, logLevel: 'error' }, preserves: ['ports', 'protocols', 'cleanIPs', 'warpEndpoints'] },
    { id: 'smart-stability', title: 'Maximum Stability', description: 'Uses conservative fragmentation and transport behavior to favor consistent connectivity.', audience: 'stability', patch: { fragmentMode: 'medium', blockUDP443: true, bestPingInterval: 60, logLevel: 'warning' }, preserves: ['ports', 'protocols', 'cleanIPs', 'warpEndpoints'] },
    { id: 'smart-streaming', title: 'Streaming', description: 'Favors sustained throughput over heavy fragmentation while retaining encrypted DNS.', audience: 'streaming', patch: { fragmentMode: 'low', enableTFO: true, blockUDP443: false, logLevel: 'error' }, preserves: ['ports', 'protocols', 'cleanIPs', 'customBypassRules'] },
    { id: 'smart-gaming', title: 'Gaming', description: 'Favors low jitter and faster setup without changing user-selected endpoints.', audience: 'gaming', patch: { fragmentMode: 'low', enableTFO: true, bestPingInterval: 30, blockUDP443: false }, preserves: ['ports', 'protocols', 'cleanIPs', 'warpEndpoints'] },
    { id: 'smart-mobile', title: 'Mobile', description: 'Balances roaming resilience and route availability for changing networks.', audience: 'mobile', patch: { enableIPv6: true, enableTFO: true, bestPingInterval: 45, blockUDP443: true }, preserves: ['ports', 'protocols', 'cleanIPs', 'customBypassRules'] }
];
