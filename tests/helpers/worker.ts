/**
 * Shared test helpers for constructing the request-scoped state that
 * `src/settings/settings.ts` keeps in module scope.
 *
 * `init(request, env)` populates a module-level singleton that `getGlobals()`,
 * `getSettings()` and several validators read. Until that singleton becomes an
 * explicit per-request context, any test touching those code paths has to call
 * `init` first, and tests in the same file share the resulting state.
 *
 * `init` also resolves the deployment identity, which is cached per isolate
 * (`src/settings/identity.ts`). The cache is dropped here on every call, so one
 * test's identity cannot leak into the next.
 */
import { init } from '@settings';
import { invalidateIdentityCache } from '@identity';
import { TEST_API_TOKEN, TEST_MAIN_DOMAIN, TEST_EMBEDED_SETTINGS } from '../setup/globals';

/** A KVNamespace stub that records every operation, for read/write assertions. */
export interface KvStub {
    store: Map<string, string>;
    calls: { op: 'get' | 'put' | 'delete' | 'list'; key: string }[];
    namespace: KVNamespace;
}

export function createKvStub(initial: Record<string, unknown> = {}): KvStub {
    const store = new Map<string, string>();
    for (const [key, value] of Object.entries(initial)) {
        store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    }

    const calls: KvStub['calls'] = [];

    const namespace = {
        async get(key: string, options?: { type?: string } | string) {
            calls.push({ op: 'get', key });
            const raw = store.get(key);
            if (raw === undefined) return null;
            const type = typeof options === 'string' ? options : options?.type;
            return type === 'json' ? JSON.parse(raw) : raw;
        },
        async put(key: string, value: string) {
            calls.push({ op: 'put', key });
            store.set(key, value);
        },
        async delete(key: string) {
            calls.push({ op: 'delete', key });
            store.delete(key);
        },
        async list() {
            calls.push({ op: 'list', key: '' });
            return { keys: [...store.keys()].map(name => ({ name })), list_complete: true, cacheStatus: null };
        }
    } as unknown as KVNamespace;

    return { store, calls, namespace };
}

export function createEnv(kv: KVNamespace, overrides: Partial<Env> = {}): Env {
    return { CF_PAGES: '0', kv, ...overrides } as Env;
}

/**
 * Initialises the module-scope request globals so that `getGlobals()` and the
 * validators depending on it behave as they would inside a real request.
 */
export async function initRequestGlobals(options: {
    path?: string;
    client?: string;
    env?: Partial<Env>;
} = {}): Promise<void> {
    const { path = `/${TEST_EMBEDED_SETTINGS.securePath}/panel`, client } = options;
    const url = new URL(`https://${TEST_MAIN_DOMAIN}${path}`);
    if (client) url.searchParams.set('app', client);

    const kv = createKvStub().namespace;
    invalidateIdentityCache();
    await init(new Request(url.toString()), createEnv(kv, { RAYZEN_CF_API_TOKEN: TEST_API_TOKEN, ...options.env }));
}

/**
 * A complete, valid `PanelSettings`-shaped object built from the shipped
 * defaults. Tests mutate one field at a time so a failure names exactly one
 * validator.
 *
 * Deliberately constructed by hand rather than imported from the defaults, so
 * that a change to the shipped defaults does not silently change what the
 * validator tests consider valid.
 */
export function validSettingsForm(): Record<string, unknown> {
    return {
        localDNS: '8.8.8.8',
        antiSanctionDNS: '178.22.122.100',
        fakeDNS: false,
        enableIPv6: false,
        allowLANConnection: false,
        logLevel: 'warning',
        customDomain: '',
        protocols: 'vless,trojan',
        remoteDNS: 'https://8.8.8.8/dns-query',
        remoteDnsHost: { isDomain: false, host: '8.8.8.8', ipv4: [], ipv6: [] },
        upstreamProxy: '',
        upstreamParams: { upstreamServer: '', upstreamPort: 0 },
        chainProxy: '',
        chainProxyParams: {},
        cleanIPs: ['www.speedtest.net'],
        ports: [443],
        fingerprint: 'chrome',
        bestPingInterval: 30,
        enableTFO: false,
        enableECH: false,
        echServerName: '',
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
        xrayUdpNoises: [{ type: 'rand', packet: '50-100', delay: '1-5', count: 5 }],
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
        panelVersion: '0.0.0-test',
        // MainSettings half of PanelSettings
        vlUUID: TEST_EMBEDED_SETTINGS.vlUUID,
        trPass: TEST_EMBEDED_SETTINGS.trPass,
        securePath: TEST_EMBEDED_SETTINGS.securePath,
        proxyIpMode: 'proxyip',
        proxyIPs: [],
        prefixes: [],
        fallback: '',
        dohUrl: ''
    };
}
