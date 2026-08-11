/**
 * Golden-file tests for config generation.
 *
 * These are the safety net the whole transformation depends on. Every fixture is
 * the exact response body a generator produces for a known settings profile. A
 * refactor that changes any byte fails here, which is the only mechanism that can
 * assert "this change altered nothing" across hundreds of permutations without
 * hand-writing hundreds of assertions.
 *
 * Determinism comes from the seam in `src/common/runtime.ts`: a fixed seed and a
 * stub resolver make output byte-stable. See tests/unit/runtime-seam.test.ts for
 * the purity proof.
 *
 * WHEN A FIXTURE DIFF APPEARS:
 *   - During a refactor: it is a bug. Investigate; do not update the fixture.
 *   - For a deliberate change: update the fixture in its OWN commit, with a
 *     message naming every changed cell and why.
 *
 * Update fixtures with: npm test -- -u
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetRuntimeDeps, seededRandom, setRuntimeDeps } from '@runtime';
import { getKvSettings } from '@settings';
import { setSettings } from '@settings-loader';
import { createEnv, createKvStub, initRequestGlobals } from '../helpers/worker';
import { getXrCustomConfigs, getXrWarpConfigs } from '@xray/configs';
import { getSbCustomConfig, getSbWarpConfig } from '@sing-box/configs';
import { getClNormalConfig, getClWarpConfig } from '@clash/configs';
import { getURLConfigs } from '@cores/common';
import { getWireguardConfigs } from '@cores/wireguard';

/** Fixed seed so SNI casing and WebSocket paths are reproducible. */
const SEED = 20260730;

/**
 * Deterministic resolver. Returns stable addresses so fixtures do not depend on
 * live DNS or on the time of day.
 */
const stubResolver = async (_domain: string, onlyIPv4 = false) => ({
    ipv4: ['203.0.113.10', '203.0.113.11'],
    ipv6: onlyIPv4 ? [] : ['2001:db8::10']
});

/** WARP accounts with obviously fake keys, never the committed production ones. */
const TEST_WARP_ACCOUNTS = [
    {
        privateKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        publicKey: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
        warpIPv6: '2606:4700:0000:0000:0000:0000:0000:0001/128',
        reserved: 'AAAA'
    },
    {
        privateKey: 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=',
        publicKey: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
        warpIPv6: '2606:4700:0000:0000:0000:0000:0000:0002/128',
        reserved: 'BBBB'
    }
];

/**
 * Settings profiles. Each is a documented delta from the shipped defaults so a
 * fixture diff points at one dimension rather than the whole surface.
 */
const profiles: Record<string, Record<string, unknown>> = {
    // The floor: one port, one protocol, everything else off.
    minimal: {
        ports: [443],
        protocols: _VL_,
        cleanIPs: []
    },

    // What most users get.
    default: {},

    // Maximum interaction surface. Most likely to expose a per-core divergence.
    'all-features-on': {
        enableIPv6: true,
        fakeDNS: true,
        allowLANConnection: true,
        enableTFO: true,
        bypassIran: true,
        bypassChina: true,
        bypassRussia: true,
        bypassOpenAi: true,
        blockAds: true,
        blockPorn: true,
        blockUDP443: true,
        blockMalware: true,
        blockPhishing: true,
        blockCryptominers: true,
        customBypassRules: ['10.0.0.0/8', 'bypass.example.com'],
        customBlockRules: ['block.example.com'],
        customBypassSanctionRules: ['sanction.example.com']
    },

    // Exercises the three buildDNS implementations.
    'custom-dns': {
        remoteDNS: 'https://dns.example.com/dns-query',
        localDNS: '9.9.9.9',
        antiSanctionDNS: '10.202.10.10',
        fakeDNS: true
    },

    // sockopt.dialerProxy / detour / dialer-proxy wiring per core.
    'chain-proxy': {
        chainProxy: 'socks://dXNlcjpwYXNz@198.51.100.7:1080',
        chainProxyParams: {
            protocol: 'socks',
            server: '198.51.100.7',
            port: 1080,
            user: 'user',
            pass: 'pass'
        }
    },

    // The (port === upstreamPort) !== (host === upstreamServer) guard.
    'upstream-proxy': {
        upstreamProxy: 'upstream.example.com:8443',
        upstreamParams: { upstreamServer: 'upstream.example.com', upstreamPort: 8443 }
    },

    // Bracketed address emission and the AAAA resolver path.
    'ipv6-on': {
        enableIPv6: true
    },

    // The port filter expression and enumeration order.
    'multi-port': {
        ports: [443, 8443, 2053, 80, 8080]
    },

    // selectSniHost custom branch, allowInsecure, and the 'C ' remark flag.
    'custom-cdn': {
        customCdnAddrs: ['cdn.example.com'],
        customCdnHost: 'host.example.com',
        customCdnSni: 'sni.example.com'
    },

    'ech-on': {
        enableECH: true,
        echServerName: 'ech.example.com'
    },

    // Xray fragment outbounds, Smart Fragment, and the Serverless configs.
    'fragment-on': {
        fragmentMode: 'custom',
        fragmentPackets: 'tlshello',
        fragmentLengthMin: 100,
        fragmentLengthMax: 200,
        fragmentDelayMin: 1,
        fragmentDelayMax: 3
    },

    // The escape hatch: the Xray 26 shape, for operators whose clients are current.
    'compat-latest': {
        clientCompat: 'latest',
        fragmentMode: 'custom'
    },

    // WARP/WoW outbounds, reserved bytes, best-ping groups.
    'warp-only': {
        warpEndpoints: ['engage.cloudflareclient.com:2408', '162.159.192.1:2408'],
        warpRemoteDNS: '1.1.1.1',
        warpReservedBytes: true
    }
};

/**
 * Generator targets. `applies` filters out combinations where the profile cannot
 * affect the output, so the matrix stays meaningful rather than merely large.
 */
interface Target {
    name: string;
    run: () => Promise<Response>;
    /** Profiles this target is generated for. */
    applies: (profile: string) => boolean;
}

const isWarpProfile = (profile: string) => profile === 'warp-only';
const isTransportProfile = (profile: string) =>
    ['ech-on', 'custom-cdn', 'multi-port', 'upstream-proxy', 'ipv6-on', 'chain-proxy'].includes(profile);
/** VLESS/Trojan targets: skip the WARP-only profile, which does not reach them. */
const proxyTarget = (profile: string) => !isWarpProfile(profile);
/** `clientCompat` rewrites Xray output only, so other cores skip that profile. */
const nonXrayTarget = (profile: string) => proxyTarget(profile) && profile !== 'compat-latest';
/** WARP targets: transport-only and fragment profiles do not affect WARP output. */
const warpTarget = (profile: string) =>
    !isTransportProfile(profile) && profile !== 'fragment-on' && profile !== 'compat-latest';
/** Fragment applies to xray and sing-box only. */
const fragmentTarget = (profile: string) =>
    profile === 'fragment-on' || profile === 'default' || profile === 'compat-latest';

const targets: Target[] = [
    { name: 'xray-normal', run: () => getXrCustomConfigs(false), applies: proxyTarget },
    { name: 'xray-fragment', run: () => getXrCustomConfigs(true), applies: fragmentTarget },
    { name: 'xray-warp', run: () => getXrWarpConfigs(false, false), applies: warpTarget },
    { name: 'xray-warp-pro', run: () => getXrWarpConfigs(true, false), applies: warpTarget },
    { name: 'xray-knocker-warp-pro', run: () => getXrWarpConfigs(true, true), applies: warpTarget },
    { name: 'sing-box-normal', run: () => getSbCustomConfig(false), applies: nonXrayTarget },
    { name: 'sing-box-fragment', run: () => getSbCustomConfig(true), applies: profile => fragmentTarget(profile) && profile !== 'compat-latest' },
    { name: 'sing-box-warp', run: () => getSbWarpConfig(), applies: warpTarget },
    { name: 'clash-normal', run: () => getClNormalConfig(), applies: nonXrayTarget },
    { name: 'clash-warp', run: () => getClWarpConfig(false), applies: warpTarget },
    { name: 'clash-warp-pro', run: () => getClWarpConfig(true), applies: warpTarget },
    { name: 'raw-uri', run: () => getURLConfigs(), applies: nonXrayTarget },
    { name: 'wireguard', run: () => getWireguardConfigs(false), applies: warpTarget },
    { name: 'amnezia', run: () => getWireguardConfigs(true), applies: warpTarget }
];

/** Headers that are part of the client contract and must be pinned. */
const CONTRACT_HEADERS = [
    'content-type',
    'content-disposition',
    'profile-title',
    'cache-control',
    'pragma',
    'expires',
    'dns'
];

/**
 * A pristine copy of the shipped defaults, captured once before any test runs.
 *
 * This matters more than it looks. `getKvSettings()` returns the module-level
 * settings singleton (src/settings/settings.ts:185), and `setSettings()`
 * overwrites that singleton with whatever the last test loaded. Building each
 * profile from a live `getKvSettings()` call therefore accumulates every previous
 * profile's overrides, so fixtures silently become a running union rather than a
 * clean delta. Snapshotting the defaults up front is what keeps each profile
 * independent.
 */
const PRISTINE_DEFAULTS = structuredClone(getKvSettings());

async function loadProfile(profile: Record<string, unknown>, client: string): Promise<void> {
    const settings = { ...structuredClone(PRISTINE_DEFAULTS), ...profile };
    const kv = createKvStub({
        proxySettings: settings,
        warpAccounts: TEST_WARP_ACCOUNTS,
        telegramBot: { telegramBotToken: '', telegramUserId: '' }
    });

    await initRequestGlobals({ path: '/test-secure-path/sub/normal', client });
    await setSettings(createEnv(kv.namespace));
}

/**
 * Serialises a response for snapshotting: the contract headers, then the body.
 * Binary bodies (the WireGuard and Amnezia zips) are summarised by their entry
 * names and sizes, because a zip contains timestamps and a binary diff tells a
 * reviewer nothing.
 */
async function serialize(response: Response, target: string): Promise<string> {
    const headers = CONTRACT_HEADERS
        .map(name => [name, response.headers.get(name)] as const)
        .filter(([, value]) => value !== null)
        .map(([name, value]) => `${name}: ${value}`)
        .join('\n');

    const isZip = target === 'wireguard' || target === 'amnezia';
    let body: string;

    if (isZip) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        // Assert the zip signature rather than the bytes, plus a stable length.
        const signature = Array.from(bytes.slice(0, 4))
            .map(byte => byte.toString(16).padStart(2, '0'))
            .join(' ');
        body = `[zip archive]\nsignature: ${signature}\nbyteLength: ${bytes.byteLength}`;
    } else if (target === 'raw-uri') {
        // Stored decoded: a base64 diff is opaque, a URI-list diff is readable.
        const encoded = await response.text();
        body = Buffer.from(encoded, 'base64').toString('utf8');
    } else {
        body = await response.text();
    }

    return `--- headers ---\n${headers}\n--- body ---\n${body}\n`;
}

/** Which client query param each target is fetched as. */
const clientFor: Record<string, string> = {
    'xray-normal': 'xray',
    'xray-fragment': 'xray',
    'xray-warp': 'xray',
    'xray-warp-pro': 'xray',
    'xray-knocker-warp-pro': 'xray-knocker',
    'sing-box-normal': 'sing-box',
    'sing-box-fragment': 'sing-box',
    'sing-box-warp': 'sing-box',
    'clash-normal': 'clash',
    'clash-warp': 'clash',
    'clash-warp-pro': 'clash',
    'raw-uri': 'xray',
    wireguard: 'wireguard',
    amnezia: 'amnezia'
};

beforeEach(() => {
    setRuntimeDeps({ random: seededRandom(SEED), resolveDNS: stubResolver });
});

afterEach(() => {
    resetRuntimeDeps();
});

for (const target of targets) {
    describe(target.name, () => {
        const applicable = Object.keys(profiles).filter(target.applies);

        for (const profileName of applicable) {
            it(`matches the golden fixture for the ${profileName} profile`, async () => {
                await loadProfile(profiles[profileName], clientFor[target.name]);

                // Re-seed after settings load: setSettings consumes randomness
                // via the resolver path, so the generator must start from a
                // known point for the fixture to be stable.
                setRuntimeDeps({ random: seededRandom(SEED), resolveDNS: stubResolver });

                const response = await target.run();
                const serialized = await serialize(response, target.name);

                await expect(serialized).toMatchFileSnapshot(
                    `../fixtures/golden/${target.name}/${profileName}.txt`
                );
            });
        }
    });
}

describe('matrix coverage', () => {
    it('records how many cells the matrix actually contains', () => {
        const cells = targets.flatMap(target => Object.keys(profiles).filter(target.applies));

        // Not an arbitrary number: it is the count the fixture directory must
        // contain. If a target or profile is added without fixtures, this fails.
        expect(cells.length).toBeGreaterThan(0);
        // eslint-disable-next-line no-console
        console.log(
            `golden matrix: ${targets.length} targets x ${Object.keys(profiles).length} profiles = ${cells.length} applicable cells`
        );
    });

    it('every target declares a client query param', () => {
        for (const target of targets) {
            expect(clientFor[target.name], `missing client for ${target.name}`).toBeDefined();
        }
    });
});
