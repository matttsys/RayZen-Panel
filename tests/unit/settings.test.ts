/**
 * Unit tests for `src/settings/kv.ts` and `src/settings/settings.ts`.
 *
 * The most valuable test in this file is the merge-table coverage check. The
 * `fields` array in `updateDataset` (kv.ts:84-163) is hand-maintained: adding a
 * setting to `KvSettings` and to the defaults but forgetting that array produces
 * a field that appears to work until the first save and then silently reverts.
 * That failure is invisible to golden fixtures, because goldens are generated
 * from a settings object that never round-trips through `updateDataset`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEnv, createKvStub, initRequestGlobals } from '../helpers/worker';
import {
    getKvSettings,
    getMainSettings,
    getSharedSettings,
    getSettings,
    getGlobals,
    init
} from '@settings';
import { setSettings } from '@settings-loader';
import { getDataset, updateDataset } from '@kv';
import { invalidateIdentityCache } from '@identity';
import { TEST_EMAIL, TEST_MAIN_DOMAIN, TEST_EMBEDED_SETTINGS } from '../setup/globals';

// `getDataset` calls fetchWarpAccounts when the warpAccounts key is absent,
// which would hit api.cloudflareclient.com. Stub the module so no test reaches
// the network; the suite must stay hermetic.
vi.mock('@api/warp', () => ({
    fetchWarpAccounts: vi.fn(async () => [
        {
            privateKey: 'test-private-key',
            publicKey: 'test-public-key',
            warpIPv6: '2606:4700:0000:0000:0000:0000:0000:0001/128',
            reserved: 'TEST'
        }
    ])
}));

// setCustomDomain performs a Cloudflare API mutation from inside the settings
// merge loop (kv.ts:96). Stub it so a settings write cannot make a network call.
vi.mock('@main', () => ({
    setCustomDomain: vi.fn(async (domain: string) => domain),
    buildScript: vi.fn(),
    updateMainSettings: vi.fn()
}));

// getDnsParams resolves the DoH host through the network when it is a domain.
vi.mock('@utils', async importOriginal => {
    const actual = await importOriginal<typeof import('@utils')>();
    return {
        ...actual,
        resolveDNS: vi.fn(async () => ({ ipv4: ['203.0.113.1'], ipv6: [] }))
    };
});

beforeEach(async () => {
    await initRequestGlobals();
});

describe('the merge table covers every setting', () => {
    it('every KvSettings key survives a save', async () => {
        // Round-trip the shipped defaults through updateDataset. Any key the
        // `fields` array omits will be missing from the result.
        const defaults = getKvSettings();
        const kv = createKvStub({ proxySettings: defaults });

        const saved = await updateDataset(
            createEnv(kv.namespace),
            { ...defaults } as never
        );

        const declared = Object.keys(defaults).sort();
        const persisted = Object.keys(saved).sort();
        const dropped = declared.filter(key => !persisted.includes(key));

        expect(dropped).toEqual([]);
    });

    it('a changed value is persisted rather than reverting to the default', async () => {
        const defaults = getKvSettings();
        const kv = createKvStub({ proxySettings: defaults });

        const saved = await updateDataset(
            createEnv(kv.namespace),
            { ...defaults, bestPingInterval: 90, enableIPv6: true } as never
        );

        expect(saved.bestPingInterval).toBe(90);
        expect(saved.enableIPv6).toBe(true);
    });

    it('panelVersion is always overwritten with the build version', async () => {
        const defaults = getKvSettings();
        const kv = createKvStub({ proxySettings: { ...defaults, panelVersion: 'stale' } });

        const saved = await updateDataset(
            createEnv(kv.namespace),
            { ...defaults, panelVersion: 'attacker-supplied' } as never
        );

        expect(saved.panelVersion).not.toBe('attacker-supplied');
        expect(saved.panelVersion).not.toBe('stale');
    });

    it('falls back to the stored value when a field is absent from the submission', async () => {
        const defaults = getKvSettings();
        const stored = { ...defaults, bestPingInterval: 45 };
        const kv = createKvStub({ proxySettings: stored });

        const submitted = { ...defaults } as Record<string, unknown>;
        delete submitted.bestPingInterval;

        const saved = await updateDataset(createEnv(kv.namespace), submitted as never);

        expect(saved.bestPingInterval).toBe(45);
    });
});

describe('updateDataset with no submission', () => {
    it('writes the shipped defaults, which is the reset path', async () => {
        const kv = createKvStub({ proxySettings: { bestPingInterval: 999 } });
        const saved = await updateDataset(createEnv(kv.namespace));

        expect(saved.bestPingInterval).toBe(getKvSettings().bestPingInterval);
        expect(kv.store.has('proxySettings')).toBe(true);
    });
});

describe('getDataset', () => {
    it('reads the three keys it needs', async () => {
        const defaults = getKvSettings();
        const kv = createKvStub({
            proxySettings: defaults,
            warpAccounts: [],
            telegramBot: { telegramBotToken: '', telegramUserId: '' }
        });

        await getDataset(createEnv(kv.namespace));

        const reads = kv.calls.filter(call => call.op === 'get').map(call => call.key);
        expect(reads).toContain('proxySettings');
        expect(reads).toContain('warpAccounts');
        expect(reads).toContain('telegramBot');
    });

    it('FINDING: a read path performs writes when a key is missing', async () => {
        // kv.ts:20 and :35 put defaults during what is nominally a read. On the
        // free plan the write budget is far smaller than the read budget, so this
        // is a quota hazard as well as a layering one.
        const kv = createKvStub({});
        await getDataset(createEnv(kv.namespace));

        const writes = kv.calls.filter(call => call.op === 'put').map(call => call.key);
        expect(writes).toContain('proxySettings');
        expect(writes).toContain('telegramBot');
    });

    it('FINDING: the three reads are issued serially, not in parallel', async () => {
        // kv.ts:17,18,32 each await in turn, so a panel render pays three
        // sequential KV round trips. Pinned; parallelising them is a safe
        // improvement that this test will then need updating for.
        const order: string[] = [];
        const kv = createKvStub({
            proxySettings: getKvSettings(),
            warpAccounts: [],
            telegramBot: { telegramBotToken: '', telegramUserId: '' }
        });

        const wrapped = new Proxy(kv.namespace, {
            get(target, prop, receiver) {
                if (prop === 'get') {
                    return async (key: string, options?: unknown) => {
                        order.push(`start:${key}`);
                        const result = await (target as KVNamespace).get(key, options as never);
                        order.push(`end:${key}`);
                        return result;
                    };
                }
                return Reflect.get(target, prop, receiver);
            }
        });

        await getDataset(createEnv(wrapped));

        // Serial execution means each read ends before the next begins.
        const proxyEnd = order.indexOf('end:proxySettings');
        const warpStart = order.indexOf('start:warpAccounts');
        expect(proxyEnd).toBeLessThan(warpStart);
    });

    it('migrates when the stored panelVersion differs from the build version', async () => {
        const defaults = getKvSettings();
        const kv = createKvStub({
            proxySettings: { ...defaults, panelVersion: '0.0.0-ancient' },
            warpAccounts: [],
            telegramBot: { telegramBotToken: '', telegramUserId: '' }
        });

        const { settings } = await getDataset(createEnv(kv.namespace));

        expect(settings.panelVersion).not.toBe('0.0.0-ancient');
        expect(kv.calls.some(call => call.op === 'put' && call.key === 'proxySettings')).toBe(true);
    });

    it('does not rewrite settings when the version already matches', async () => {
        const defaults = getKvSettings();
        const kv = createKvStub({
            proxySettings: defaults,
            warpAccounts: [],
            telegramBot: { telegramBotToken: '', telegramUserId: '' }
        });

        await getDataset(createEnv(kv.namespace));

        expect(kv.calls.some(call => call.op === 'put' && call.key === 'proxySettings')).toBe(false);
    });

    it('wraps a KV failure in a descriptive error', async () => {
        const failing = {
            async get() {
                throw new Error('kv exploded');
            },
            async put() {}
        } as unknown as KVNamespace;

        await expect(getDataset(createEnv(failing))).rejects.toThrow(/error occurred while getting KV/i);
    });
});

describe('init', () => {
    const withoutEmbedded = async <T>(run: () => Promise<T>): Promise<T> => {
        const saved = (globalThis as Record<string, unknown>).EMBEDED_SETTINGS;
        try {
            delete (globalThis as Record<string, unknown>).EMBEDED_SETTINGS;
            invalidateIdentityCache();
            return await run();
        } finally {
            (globalThis as Record<string, unknown>).EMBEDED_SETTINGS = saved;
            invalidateIdentityCache();
        }
    };

    /**
     * The legacy guard. legacy upstream 4.x read the UUID and Trojan password from plain
     * environment variables; RayZen never has. A deployment that sets them expects
     * them to be in effect, so refusing is safer than ignoring them, and the message
     * has to say where those values actually live now.
     */
    const LEGACY_ENV = /managed in the panel/;

    it('refuses the legacy env.UUID variable rather than ignoring it', async () => {
        const kv = createKvStub().namespace;
        await expect(
            init(new Request(`https://${TEST_MAIN_DOMAIN}/`), createEnv(kv, { UUID: 'x' } as never))
        ).rejects.toThrow(LEGACY_ENV);
    });

    it('refuses the legacy env.TR_PASS variable rather than ignoring it', async () => {
        const kv = createKvStub().namespace;
        await expect(
            init(new Request(`https://${TEST_MAIN_DOMAIN}/`), createEnv(kv, { TR_PASS: 'x' } as never))
        ).rejects.toThrow(LEGACY_ENV);
    });

    it('bootstraps an identity into KV when the script carries none', async () => {
        // The Deploy to Cloudflare path: nothing is embedded, so the first request
        // generates the identity and stores it. A deployment that could not do this
        // would have no panel URL to hand anybody.
        await withoutEmbedded(async () => {
            const kv = createKvStub();
            await init(new Request(`https://my-panel.workers.dev/`), createEnv(kv.namespace));

            const globals = getGlobals();
            expect(globals.source).toBe('kv');
            expect(globals.accEmail).toBe('');
            expect(globals.securePath).toMatch(/^[A-Za-z0-9]{24}$/);
            expect(globals.vlUUID).toMatch(/^[0-9a-f-]{36}$/);
            expect(kv.store.has('rz:identity')).toBe(true);
        });
    });

    it('reuses the stored identity instead of generating a second one', async () => {
        await withoutEmbedded(async () => {
            const kv = createKvStub();
            await init(new Request(`https://my-panel.workers.dev/`), createEnv(kv.namespace));
            const first = getGlobals().securePath;

            invalidateIdentityCache();
            await init(new Request(`https://my-panel.workers.dev/`), createEnv(kv.namespace));

            expect(getGlobals().securePath).toBe(first);
            // One write, on the bootstrap only. A second write per cold start would
            // burn the free plan's 1,000-writes-a-day budget on nothing.
            expect(kv.calls.filter(entry => entry.op === 'put')).toHaveLength(1);
        });
    });

    it('takes the hostname from the request, not from a stored value', async () => {
        // A Worker reachable on both its workers.dev address and a custom domain must
        // generate configs for whichever one the client actually asked for.
        await withoutEmbedded(async () => {
            const kv = createKvStub();
            await init(new Request(`https://first.workers.dev/`), createEnv(kv.namespace));
            expect(getGlobals().mainDomain).toBe('first.workers.dev');

            await init(new Request(`https://panel.example.com/`), createEnv(kv.namespace));
            expect(getGlobals().mainDomain).toBe('panel.example.com');
        });
    });

    it('lets environment variables override the stored identity', async () => {
        await withoutEmbedded(async () => {
            const kv = createKvStub();
            await init(
                new Request(`https://my-panel.workers.dev/`),
                createEnv(kv.namespace, {
                    RAYZEN_SECURE_PATH: 'pinnedPath',
                    RAYZEN_ADMIN_EMAIL: 'Owner@Example.Invalid',
                    RAYZEN_CF_API_TOKEN: 'env-token',
                    RAYZEN_WORKER_NAME: 'declared-name'
                } as never)
            );

            const globals = getGlobals();
            expect(globals.securePath).toBe('pinnedPath');
            expect(globals.accEmail).toBe('owner@example.invalid');
            expect(globals.apiToken).toBe('env-token');
            expect(globals.workerName).toBe('declared-name');
        });
    });

    it('never writes the Cloudflare credentials to KV', async () => {
        // A token in KV is a token in every settings export and every backup.
        await withoutEmbedded(async () => {
            const kv = createKvStub();
            await init(
                new Request(`https://my-panel.workers.dev/`),
                createEnv(kv.namespace, {
                    RAYZEN_CF_ACCOUNT_ID: 'account-id-value',
                    RAYZEN_CF_API_TOKEN: 'secret-token-value'
                } as never)
            );

            const stored = kv.store.get('rz:identity') ?? '';
            expect(stored).not.toContain('secret-token-value');
            expect(stored).not.toContain('account-id-value');
        });
    });

    it('explains itself when there is neither an identity block nor a KV binding', async () => {
        // Rendered as HTML by renderError, so the message must stay plain and must
        // name the binding the operator has to create.
        await withoutEmbedded(async () => {
            let message = '';
            try {
                await init(new Request(`https://${TEST_MAIN_DOMAIN}/`), {} as Env);
            } catch (error) {
                message = (error as Error).message;
            }

            expect(message).toContain('kv');
            expect(message).toContain('Deploy to Cloudflare');
            expect(message).not.toContain('legacy upstream');
            expect(message).not.toContain('<a ');
        });
    });

    it('prefers the embedded identity block when the script carries one', async () => {
        expect(getGlobals().source).toBe('embedded');
        expect(getGlobals().securePath).toBe(TEST_EMBEDED_SETTINGS.securePath);
    });

    it('lower-cases the account email', async () => {
        const kv = createKvStub().namespace;
        const saved = (globalThis as Record<string, unknown>).EMBEDED_SETTINGS;
        try {
            (globalThis as Record<string, unknown>).EMBEDED_SETTINGS = {
                ...TEST_EMBEDED_SETTINGS,
                accEmail: TEST_EMAIL.toUpperCase()
            };
            invalidateIdentityCache();
            await init(new Request(`https://${TEST_MAIN_DOMAIN}/`), createEnv(kv));
            expect(getGlobals().accEmail).toBe(TEST_EMAIL);
        } finally {
            (globalThis as Record<string, unknown>).EMBEDED_SETTINGS = saved;
            invalidateIdentityCache();
        }
    });

    it('derives the worker name from the hostname when none is declared', async () => {
        expect(getGlobals().workerName).toBe(TEST_MAIN_DOMAIN.split('.')[0]);
    });

    it('leaves proxy IPs empty when none are configured', () => {
        // A fresh deployment must not route retries through a third-party host.
        // Configs point at the Worker's own domain until the operator adds proxy IPs
        // or runs a scan.
        expect(getGlobals().proxyIPs).toEqual([]);
    });

    it('supplies three NAT64 prefix defaults when none are configured', () => {
        const { prefixes } = getGlobals();
        expect(prefixes).toHaveLength(3);
        expect(prefixes.every(prefix => prefix.startsWith('[') && prefix.endsWith(']'))).toBe(true);
    });

    it('defaults the DoH URL to Cloudflare when unset', () => {
        expect(getGlobals().dohUrl).toBe('https://cloudflare-dns.com/dns-query');
    });

    it('reports deployType workers by default and pages under CF_PAGES', async () => {
        expect(getGlobals().deployType).toBe('workers');

        const kv = createKvStub().namespace;
        await init(new Request(`https://${TEST_MAIN_DOMAIN}/`), createEnv(kv, { CF_PAGES: '1' }));
        expect(getGlobals().deployType).toBe('pages');
    });

    it('reads the client from the app query parameter and decodes it', async () => {
        const kv = createKvStub().namespace;
        await init(
            new Request(`https://${TEST_MAIN_DOMAIN}/sub/normal?app=sing-box`),
            createEnv(kv)
        );
        expect(getGlobals().client).toBe('sing-box');
    });

    it('decodes a percent-encoded pathname', async () => {
        const kv = createKvStub().namespace;
        await init(new Request(`https://${TEST_MAIN_DOMAIN}/a%20b/panel`), createEnv(kv));
        expect(getGlobals().pathname).toBe('/a b/panel');
    });

    it('exposes the documented HTTP and HTTPS port lists', () => {
        const { httpPorts, httpsPorts } = getGlobals();
        expect(httpsPorts).toContain(443);
        expect(httpPorts).toContain(80);
        // No overlap: a port is either the TLS set or the plaintext set.
        expect(httpPorts.filter(port => httpsPorts.includes(port))).toEqual([]);
    });
});

describe('settings accessors', () => {
    it('getMainSettings withholds the account credentials', () => {
        const main = getMainSettings() as unknown as Record<string, unknown>;

        for (const secret of ['accID', 'accEmail', 'apiToken', 'mainDomain']) {
            expect(main).not.toHaveProperty(secret);
        }
        expect(main).toHaveProperty('securePath');
    });

    it('getSharedSettings withholds credentials and deployment-local fields', async () => {
        const kv = createKvStub({
            proxySettings: getKvSettings(),
            warpAccounts: [],
            telegramBot: { telegramBotToken: '', telegramUserId: '' }
        });
        await setSettings(createEnv(kv.namespace));

        const shared = getSharedSettings() as unknown as Record<string, unknown>;

        // This payload is what /sub/share-settings exports, so a credential
        // leaking in here is a disclosure.
        for (const withheld of ['accID', 'accEmail', 'apiToken', 'vlUUID', 'trPass', 'securePath', 'remoteSettings', 'customDomain', 'panelVersion']) {
            expect(shared).not.toHaveProperty(withheld);
        }
        // But it does carry the non-secret deployment shape.
        expect(shared).toHaveProperty('proxyIpMode');
        expect(shared).toHaveProperty('dohUrl');
    });

    it('getSettings lets request globals win over stored settings', () => {
        const merged = getSettings() as unknown as Record<string, unknown>;
        expect(merged.securePath).toBe(TEST_EMBEDED_SETTINGS.securePath);
        expect(merged).toHaveProperty('httpsPorts');
        expect(merged).toHaveProperty('protocols');
    });
});
