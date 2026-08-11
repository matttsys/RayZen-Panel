import { resolveIdentity, type Identity } from '@identity';
import {
    KvSettings,
    ReqSettings,
    MainSettings,
    WarpAccount,
    SharedSettings,
    Client,
    Subscription
} from '#types/settings';

Object.assign(globalThis, {
    _VL_: atob('dmxlc3M='),
    _VL_CAP_: atob('VkxFU1M='),
    _VM_: atob('dm1lc3M='),
    _VM_CAP_: atob('Vk1lc3M='),
    _TR_: atob('dHJvamFu'),
    _TR_CAP_: atob('VHJvamFu'),
    _SS_: atob('c2hhZG93c29ja3M='),
    _V2_: atob('djJyYXk='),
    _project_: atob('UmF5WmVu'),
    _project_SM_: atob('cmF5emVu'),
});

/**
 * NAT64 prefixes used when the deployment configures none. Applied here rather than
 * in the identity record so the defaults live in one place and a stored empty list
 * keeps meaning "use the defaults" rather than freezing today's values forever.
 */
const DEFAULT_PREFIXES = [
    '[2a02:898:146:64::]',
    '[2602:fc59:b0:64::]',
    '[2602:fc59:11:64::]'
];

/**
 * Populates the request-scoped globals every handler reads.
 *
 * Asynchronous because the identity may live in KV: see `src/settings/identity.ts`
 * for the three sources and why the hostname is taken from the request rather than
 * from a stored value.
 */
export async function init(request: Request, env: Env): Promise<Identity> {
    if (env.UUID || env.TR_PASS) {
        // legacy upstream 4.x read the UUID and Trojan password from plain environment
        // variables. RayZen never has, and a deployment carrying them is one whose
        // operator expects them to be in effect, so refusing is safer than silently
        // ignoring them. Rendered as HTML by `renderError`, so it stays plain.
        throw new Error(
            'This deployment sets the legacy UUID or TR_PASS environment variables, which ' +
            'RayZen does not read. Remove them: the VLESS UUID and Trojan password are ' +
            'managed in the panel, under Settings. See docs/DEPLOYMENT.md.'
        );
    }

    const identity = await resolveIdentity(request, env);
    const { pathname, origin, searchParams, hostname } = new URL(request.url);

    // Kept alongside the effective settings, un-defaulted. `getMainSettings` reports
    // what the deployment has *configured*, which is not the same as what is in
    // effect: an empty prefix list means "use the defaults", and reporting the
    // defaults back would make the settings form submit them as an explicit choice.
    // The save path compares the form against this, so defaulting here made every
    // save look like a change and, on a packaged deployment, triggered a redeploy.
    resolvedIdentity = identity;

    globalSettings = {
        ...identity,
        // Empty until the operator adds proxy IPs or runs the scanner: a fresh
        // deployment must not route retries through a third-party host. Configs
        // point at the Worker's own domain until one is set.
        proxyIPs: identity.proxyIPs,
        prefixes: identity.prefixes.length ? identity.prefixes : DEFAULT_PREFIXES,
        dohUrl: identity.dohUrl || 'https://cloudflare-dns.com/dns-query',
        deployType: env.CF_PAGES === '1' ? 'pages' : 'workers',
        httpPorts: [80, 8080, 2052, 2082, 2086, 2095, 8880],
        httpsPorts: [443, 8443, 2053, 2083, 2087, 2096],
        client: decodeURIComponent(searchParams.get('app') ?? ''),
        origin: origin,
        searchParams,
        pathname: decodeURIComponent(pathname),
        hostname: hostname
    };

    return identity;
}

/** Applies a dataset that was loaded by the settings I/O layer. */
export function applySettingsDataset(settings: KvSettings, accounts: WarpAccount[]) {
    kvSettings = settings;
    warpAccounts = accounts;
}

export const getGlobals = (): Identity & ReqSettings => globalSettings;
export const getWarpAccounts = (): WarpAccount[] => warpAccounts;
export const getKvSettings = (): KvSettings => kvSettings;

/** The deployment's configured identity fields, before any default is applied. */
export function getMainSettings(): MainSettings {
    const {
        vlUUID,
        trPass,
        securePath,
        proxyIpMode,
        proxyIPs,
        prefixes,
        fallback,
        dohUrl
    } = resolvedIdentity;

    return { vlUUID, trPass, securePath, proxyIpMode, proxyIPs, prefixes, fallback, dohUrl };
}

export function getSharedSettings(): SharedSettings {
    const {
        remoteSettings,
        customDomain,
        panelVersion,
        ...proxySettings
    } = kvSettings;

    const {
        proxyIpMode,
        proxyIPs,
        prefixes,
        fallback,
        dohUrl
    } = globalSettings;

    return {
        ...proxySettings,
        proxyIpMode,
        proxyIPs,
        prefixes,
        fallback,
        dohUrl
    };
}

export const getSettings = () => ({
    ...kvSettings,
    ...globalSettings
});

let globalSettings: Identity & ReqSettings;
let resolvedIdentity: Identity;

/**
 * WARP account material is deployment-specific and is never shipped in source.
 * A fresh deployment registers its own pair and stores it in KV. If registration
 * fails, this stays empty and the UI directs the operator to retry; silently using
 * shared private keys would be a credential leak and an unsafe trust boundary.
 */
let warpAccounts: WarpAccount[] = [];

export const subscriptions: Subscription = {
    'normal': {
        label: 'Normal',
        categories: [
            { core: 'xray', clients: [`${_V2_}N(G)`, 'MahsaNG', 'Streisand'] },
            { core: 'sing-box', clients: ['sing-box', 'husi'] },
            { core: 'clash', clients: ['Clash Meta', 'Clash Verge', 'FlClash', 'Stash'] },
        ]
    },
    'fragment': {
        label: 'Fragment',
        categories: [
            { core: 'xray', clients: [`${_V2_}N(G)`, 'MahsaNG', 'Streisand'] },
            { core: 'sing-box', clients: ['sing-box', 'husi'] },
        ]
    },
    'raw': {
        label: 'Raw',
        categories: [
            { core: 'xray', clients: [`${_V2_}N(G)`, 'MahsaNG', 'Shadowrocket', 'Streisand', 'PassWall'] },
            { core: 'sing-box', clients: ['husi', 'NekoBox', 'Hiddify', 'Karing'] },
        ]
    },
    'warp': {
        label: 'Warp',
        categories: [
            { core: 'xray', clients: [`${_V2_}N(G)`, 'Streisand'] },
            { core: 'sing-box', clients: ['sing-box', 'husi'] },
            { core: 'clash', clients: ['Clash Meta', 'Clash Verge', 'FlClash', 'Stash'] },
            { core: 'wireguard', clients: ['Wireguard'] },
        ]
    },
    'warp-pro': {
        label: 'Warp Pro',
        categories: [
            { core: 'xray', clients: [`${_V2_}N(G)`, 'Streisand'] },
            { core: 'xray-knocker', clients: ['MahsaNG', 'v2rayN-PRO'] },
            { core: 'clash', clients: ['Clash Meta', 'Clash Verge', 'FlClash', 'Stash'] },
            { core: 'amnezia', clients: ['Amnezia', 'WG Tunnel'] },
        ]
    }
};

export const clients: Client[] = [
    { name: `${_V2_}NG`, minVer: '2.2.3', source: 'Github', b64Url: 'aHR0cHM6Ly9naXRodWIuY29tLzJkdXN0L3YycmF5TkcvcmVsZWFzZXMvbGF0ZXN0' },
    { name: `${_V2_}N`, minVer: '7.22.5', source: 'Github', b64Url: 'aHR0cHM6Ly9naXRodWIuY29tLzJkdXN0L3YycmF5Ti9yZWxlYXNlcy9sYXRlc3Q=' },
    { name: 'MahsaNG', minVer: '17', source: 'Google Play', b64Url: 'aHR0cHM6Ly9wbGF5Lmdvb2dsZS5jb20vc3RvcmUvYXBwcy9kZXRhaWxzP2lkPWNvbS5NYWhzYU5ldC5NYWhzYU5HJmhsPWVu' },
    { name: 'Streisand', minVer: '1.6.71', source: 'App Store', b64Url: 'aHR0cHM6Ly9hcHBzLmFwcGxlLmNvbS91cy9hcHAvc3RyZWlzYW5kL2lkNjQ1MDUzNDA2NA==' },
    { name: 'sing-box', minVer: '1.12.0', source: 'Github', b64Url: 'aHR0cHM6Ly9naXRodWIuY29tL1NhZ2VyTmV0L3NpbmctYm94L3JlbGVhc2VzL2xhdGVzdA==' },
    { name: 'husi', minVer: '1.3.2', source: 'Codeberg', b64Url: 'aHR0cHM6Ly9jb2RlYmVyZy5vcmcveGNoYWNoYTIwLXBvbHkxMzA1L2h1c2kvcmVsZWFzZXMvbGF0ZXN0' },
    { name: 'NekoBox', minVer: '1.3.2', source: 'Github', b64Url: 'aHR0cHM6Ly9naXRodWIuY29tL01hdHN1cmlkYXlvL05la29Cb3hGb3JBbmRyb2lkL3JlbGVhc2VzL2xhdGVzdA==' },
    { name: 'Clash Meta', minVer: '2.11.31', source: 'Github', b64Url: 'aHR0cHM6Ly9naXRodWIuY29tL01ldGFDdWJlWC9DbGFzaE1ldGFGb3JBbmRyb2lkL3JlbGVhc2VzL2xhdGVzdA==' },
    { name: 'Clash verge rev', minVer: '2.5.1', source: 'Github', b64Url: 'aHR0cHM6Ly9naXRodWIuY29tL2NsYXNoLXZlcmdlLXJldi9jbGFzaC12ZXJnZS1yZXYvcmVsZWFzZXMvbGF0ZXN0' },
    { name: 'FlClash', minVer: '0.8.94', source: 'Github', b64Url: 'aHR0cHM6Ly9naXRodWIuY29tL2NoZW4wODIwOS9GbENsYXNoL3JlbGVhc2VzL2xhdGVzdA==' },
    { name: 'Stash', minVer: '3.4.1', source: 'App Store', b64Url: 'aHR0cHM6Ly9hcHBzLmFwcGxlLmNvbS91cy9hcHAvc3Rhc2gtcnVsZS1iYXNlZC1wcm94eS9pZDE1OTYwNjMzNDk=' },
    { name: 'Amnezia', minVer: '4.8.21.0', source: 'Github', b64Url: 'aHR0cHM6Ly9naXRodWIuY29tL2FtbmV6aWEtdnBuL2FtbmV6aWEtY2xpZW50L3JlbGVhc2VzL2xhdGVzdA==' },
    { name: 'Wireguard', minVer: 'Stable', source: 'Official Website', b64Url: 'aHR0cHM6Ly93d3cud2lyZWd1YXJkLmNvbS9pbnN0YWxsLw==' },
    { name: 'WG Tunnel', minVer: '5.1.0', source: 'Github', b64Url: 'aHR0cHM6Ly9naXRodWIuY29tL3dndHVubmVsL2FuZHJvaWQvcmVsZWFzZXMvbGF0ZXN0' },
];

let kvSettings: KvSettings = {
    localDNS: '8.8.8.8',
    antiSanctionDNS: '178.22.122.100',
    fakeDNS: false,
    enableIPv6: false,
    allowLANConnection: false,
    logLevel: 'warning',
    clientCompat: 'universal',
    customDomain: '',
    protocols: `${_VL_},${_TR_}`,
    remoteDNS: 'https://8.8.8.8/dns-query',
    remoteDnsHost: {
        isDomain: false,
        host: '8.8.8.8',
        ipv4: [],
        ipv6: []
    },
    upstreamProxy: '',
    upstreamParams: {
        upstreamServer: '',
        upstreamPort: 0
    },
    chainProxy: '',
    chainProxyParams: {},
    cleanIPs: ['www.speedtest.net'],
    ports: [443],
    fingerprint: 'chrome',
    bestPingInterval: 30,
    enableTFO: false,
    enableECH: false,
    echServerName: '',
    remarkSeparator: '•',
    remarkSuffix: '💮',
    customCdnAddrs: [],
    customCdnHost: '',
    customCdnSni: '',
    fragmentMode: 'custom',
    fragmentPackets: 'tlshello',
    fragmentLengthMin: 100,
    fragmentLengthMax: 200,
    fragmentDelayMin: 1,
    fragmentDelayMax: 1,
    fragmentMaxSplitMin: 0,
    fragmentMaxSplitMax: 0,
    customSubs: [],
    customConfigs: [],
    warpRemoteDNS: '1.1.1.1',
    warpEndpoints: ['engage.cloudflareclient.com:2408'],
    warpBestPingInterval: 30,
    warpReservedBytes: true,
    xrayUdpNoises: [{
        type: 'rand',
        packet: '50-100',
        delay: '1-5',
        count: 5
    }],
    knockerNoiseMode: 'quic',
    knockerNoiseCountMin: 10,
    knockerNoiseCountMax: 15,
    knockerNoiseSizeMin: 5,
    knockerNoiseSizeMax: 10,
    knockerNoiseDelayMin: 1,
    knockerNoiseDelayMax: 1,
    amneziaNoiseCount: 5,
    amneziaNoiseSizeMin: 50,
    amneziaNoiseSizeMax: 100,
    bypassIran: false,
    bypassChina: false,
    bypassRussia: false,
    bypassOpenAi: false,
    bypassGoogleAi: false,
    bypassMicrosoft: false,
    bypassOracle: false,
    bypassDocker: false,
    bypassAdobe: false,
    bypassEpicGames: false,
    bypassIntel: false,
    bypassAmd: false,
    bypassNvidia: false,
    bypassAsus: false,
    bypassHp: false,
    bypassLenovo: false,
    blockAds: false,
    blockPorn: false,
    blockUDP443: false,
    blockMalware: false,
    blockPhishing: false,
    blockCryptominers: false,
    customBypassRules: [],
    customBlockRules: [],
    customBypassSanctionRules: [],
    remoteSettings: '',
    panelVersion: VERSION
};
