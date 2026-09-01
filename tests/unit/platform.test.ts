/**
 * The platform-layer guarantees that `src/platform/**` claims in prose.
 *
 * The platform layer is an event bus, a service registry, two KV-backed repositories and a
 * composition root, and each of those modules states a property in its header that
 * nothing enforced. This file is the enforcement. Every `describe` below maps to a
 * claim, and the claim is quoted where the test would otherwise look arbitrary.
 *
 * Why these properties and not coverage
 *
 * The platform is small and mostly obvious; what is not obvious is the handful of
 * invariants the rest of the phase leans on:
 *
 *   - A listener that throws cannot fail the publisher, because a broken counter
 *     must not fail a settings save.
 *   - `createPlatform` performs no I/O and resolves no service, because it is
 *     created on paths that publish nothing.
 *   - The KV key names never change, because a rename orphans a deployment's data.
 *   - A request that records N facts costs one write per document, because the free
 *     plan allows 1,000 writes a day.
 *
 * Each of those is cheap to check and expensive to discover the hard way.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventBus, type EventName } from '@platform/events';
import { createServiceRegistry } from '@platform/services';
import { createRepositories, PLATFORM_KV_KEYS, RETENTION } from '@platform/repositories';
import { CORE_FEATURES, createFeatureRegistry, type CapabilityContext } from '@platform/features';
import { createPlatform } from '@platform/context';
import { protocolList, readStorageCapabilities, toCapabilityContext, toDiagnosticsContext, type CapabilityInput } from '@platform/capability';
import { withRecorder } from '@platform/record';
import { createStorage } from '@storage';
import { resetRuntimeDeps, setRuntimeDeps } from '@runtime';
import { createEnv, createKvStub } from '../helpers/worker';

afterEach(() => {
    resetRuntimeDeps();
});

/* ------------------------------------------------------------------ *
 * Event bus
 * ------------------------------------------------------------------ */

describe('event bus', () => {
    it('delivers to every listener and reports how many ran', () => {
        const bus = createEventBus();
        const seen: string[] = [];

        bus.on('settings.reset', ({ version }) => void seen.push(`a:${version}`));
        bus.on('settings.reset', ({ version }) => void seen.push(`b:${version}`));

        expect(bus.emit('settings.reset', { version: '1' })).toBe(2);
        expect(seen).toEqual(['a:1', 'b:1']);
    });

    it('costs nothing when nobody is listening', () => {
        // Constraint 2 in the module header: `emit` is on paths that publish
        // routinely, so the no-listener case must not allocate or iterate.
        const bus = createEventBus();
        expect(bus.emit('auth.login', {})).toBe(0);
        expect(bus.listenerCount()).toBe(0);
    });

    it('a throwing sync listener is captured, not propagated', () => {
        // Constraint 1: "A broken analytics counter cannot be allowed to fail a
        // settings save."
        const bus = createEventBus();
        bus.on('auth.login', () => {
            throw new Error('boom');
        });

        expect(() => bus.emit('auth.login', {})).not.toThrow();
        expect(bus.failures()).toHaveLength(1);
        expect(bus.failures()[0].event).toBe('auth.login');
    });

    it('a rejecting async listener is captured by settled(), not thrown', async () => {
        const bus = createEventBus();
        bus.on('auth.login', async () => {
            throw new Error('async boom');
        });

        bus.emit('auth.login', {});
        const failures = await bus.settled();

        expect(failures).toHaveLength(1);
        // settled() clears, so a second call reports nothing rather than double
        // counting the same failure into a caller's log.
        expect(await bus.settled()).toEqual([]);
    });

    it('one broken listener does not starve the others', async () => {
        const bus = createEventBus();
        const ran: string[] = [];

        bus.on('warp.refreshed', () => {
            throw new Error('first is broken');
        });
        bus.on('warp.refreshed', () => void ran.push('second'));

        bus.emit('warp.refreshed', { accounts: 1 });
        await bus.settled();

        expect(ran).toEqual(['second']);
    });

    it('settled() drains listeners that publish while being drained', async () => {
        // The while-loop in `settled` exists for this: a listener whose write
        // triggers another event appends to `pending` during the await.
        const bus = createEventBus();
        const order: string[] = [];

        bus.on('auth.login', async () => {
            order.push('login');
            bus.emit('warp.refreshed', { accounts: 1 });
        });
        bus.on('warp.refreshed', async () => {
            await Promise.resolve();
            order.push('warp');
        });

        bus.emit('auth.login', {});
        await bus.settled();

        expect(order).toEqual(['login', 'warp']);
    });

    it('emitAsync awaits every listener and returns only its own failures', async () => {
        const bus = createEventBus();
        const done: string[] = [];

        bus.on('panel.updated', async () => {
            await Promise.resolve();
            done.push('slow');
        });
        bus.on('panel.updated', async () => {
            throw new Error('nope');
        });

        const failures = await bus.emitAsync('panel.updated', { from: '1', to: '2' });

        expect(done).toEqual(['slow']);
        expect(failures).toHaveLength(1);
    });

    it('unsubscribe is idempotent and prunes the empty set', () => {
        const bus = createEventBus();
        const off = bus.on('auth.login', () => undefined);

        off();
        off();

        expect(bus.listenerCount('auth.login')).toBe(0);
        expect(bus.emit('auth.login', {})).toBe(0);
    });

    it('once() delivers exactly one time', () => {
        const bus = createEventBus();
        const listener = vi.fn();

        bus.once('auth.login', listener);
        bus.emit('auth.login', {});
        bus.emit('auth.login', {});

        expect(listener).toHaveBeenCalledTimes(1);
        expect(bus.listenerCount('auth.login')).toBe(0);
    });

    it('a listener unsubscribing during delivery does not disturb the current publish', () => {
        // The `Array.from(set)` snapshot in `emit` exists for exactly this.
        const bus = createEventBus();
        const seen: string[] = [];

        const off = bus.on('auth.login', () => {
            off();
            seen.push('first');
        });
        bus.on('auth.login', () => void seen.push('second'));

        expect(bus.emit('auth.login', {})).toBe(2);
        expect(seen).toEqual(['first', 'second']);
        expect(bus.listenerCount('auth.login')).toBe(1);
    });

    it('every bus is isolated, so no listener leaks across requests', () => {
        // There is deliberately no module-level default instance: a shared bus
        // inside a long-lived isolate would recreate the P1 defect at a larger
        // scale.
        const first = createEventBus();
        const second = createEventBus();
        const listener = vi.fn();

        first.on('auth.login', listener);
        second.emit('auth.login', {});

        expect(listener).not.toHaveBeenCalled();
    });
});

/* ------------------------------------------------------------------ *
 * Service registry
 * ------------------------------------------------------------------ */

describe('service registry', () => {
    it('constructs on first get and memoises after', () => {
        const registry = createServiceRegistry();
        const factory = vi.fn(() => createStorage(createKvStub().namespace));

        registry.register('storage', factory);
        expect(factory).not.toHaveBeenCalled();
        expect(registry.isResolved('storage')).toBe(false);

        const first = registry.get('storage');
        const second = registry.get('storage');

        expect(factory).toHaveBeenCalledTimes(1);
        expect(second).toBe(first);
        expect(registry.isResolved('storage')).toBe(true);
    });

    it('throws a named error for an unregistered key rather than returning undefined', () => {
        const registry = createServiceRegistry();
        expect(() => registry.get('analytics')).toThrow(/not registered/);
    });

    it('refuses to re-register a resolved service', () => {
        // Some caller already holds the old instance; replacing the factory would
        // let two callers in one request diverge.
        const registry = createServiceRegistry();
        registry.register('events', () => createEventBus());
        registry.get('events');

        expect(() => registry.register('events', () => createEventBus())).toThrow(/already resolved/);
    });

    it('names the cycle instead of overflowing the stack', () => {
        const registry = createServiceRegistry();

        registry.register('analytics', services => services.get('history') as never);
        registry.register('history', services => services.get('analytics') as never);

        expect(() => registry.get('analytics')).toThrow(/Circular service dependency: analytics -> history -> analytics/);
    });

    it('provide() seeds an already-built value and reports it resolved', () => {
        const registry = createServiceRegistry();
        const bus = createEventBus();

        registry.provide('events', bus);

        expect(registry.isResolved('events')).toBe(true);
        expect(registry.get('events')).toBe(bus);
    });

    it('keys() preserves registration order, so the catalogue reads as declared', () => {
        const registry = createServiceRegistry();
        registry
            .register('storage', () => createStorage(createKvStub().namespace))
            .register('events', () => createEventBus());

        expect(registry.keys()).toEqual(['storage', 'events']);
        expect(registry.has('analytics')).toBe(false);
    });
});

/* ------------------------------------------------------------------ *
 * Repositories
 * ------------------------------------------------------------------ */

describe('platform KV keys', () => {
    it('are pinned, because a rename orphans a deployment\'s data', () => {
        // The module header says these "are pinned by a test". This is it. Changing
        // a value here is a migration, not a rename.
        expect(PLATFORM_KV_KEYS).toEqual({
            metrics: 'rz:metrics',
            history: 'rz:history',
            scanner: 'rz:scanner',
            profiles: 'rz:profiles'
        });
    });

    it('all live under the rz: prefix, separate from the five legacy upstream keys', () => {
        for (const key of Object.values(PLATFORM_KV_KEYS)) {
            expect(key.startsWith('rz:')).toBe(true);
        }
    });

    it('declares exactly four documents, so a fifth is a deliberate addition', () => {
        // Four since v1.1: `rz:profiles` was added for subscription profiles. It is its
        // own document rather than a settings field because a settings export must not
        // carry the tokens that authorise other people's subscriptions.
        expect(Object.keys(PLATFORM_KV_KEYS)).toHaveLength(4);
    });
});

describe('repository write budget', () => {
    it('a request that records many facts costs one write per document', async () => {
        // The reason the whole flush seam exists: the free plan allows 1,000 KV
        // writes per day, so counters mutate memory and the platform writes once.
        const kv = createKvStub();
        const repos = createRepositories(kv.namespace);

        for (let i = 0; i < 10; i += 1) {
            await repos.metrics.increment('2025-01-01', 'config.exports');
        }
        await repos.history.append({ id: 'a', kind: 'auth.login', at: 1, summary: 'x' });
        await repos.scanner.recordRun({
            id: 'r', at: 1, kind: 'clean-ip', targets: 1, healthy: 1, best: null, medianScore: 10
        });

        expect(await repos.flush()).toBe(3);
        expect(kv.calls.filter(call => call.op === 'put')).toHaveLength(3);
    });

    it('flushing twice writes once, because the second flush finds nothing dirty', async () => {
        const kv = createKvStub();
        const repos = createRepositories(kv.namespace);

        await repos.metrics.increment('2025-01-01', 'auth.success');

        expect(await repos.flush()).toBe(1);
        expect(await repos.flush()).toBe(0);
        expect(kv.calls.filter(call => call.op === 'put')).toHaveLength(1);
    });

    it('reads each document at most once per request', async () => {
        const kv = createKvStub();
        const repos = createRepositories(kv.namespace);

        await repos.metrics.increment('2025-01-01', 'auth.success');
        await repos.metrics.increment('2025-01-01', 'auth.failure');
        await repos.metrics.snapshot();

        expect(kv.calls.filter(call => call.op === 'get' && call.key === 'rz:metrics')).toHaveLength(1);
    });

    it('isDirty() reports unwritten state, so a caller can skip a pointless flush', async () => {
        const repos = createRepositories(createKvStub().namespace);

        expect(repos.isDirty()).toBe(false);
        await repos.history.append({ id: 'a', kind: 'auth.login', at: 1, summary: 'x' });
        expect(repos.isDirty()).toBe(true);

        await repos.flush();
        expect(repos.isDirty()).toBe(false);
    });

    it('an increment of zero is not a mutation', async () => {
        const repos = createRepositories(createKvStub().namespace);
        await repos.metrics.increment('2025-01-01', 'auth.success', 0);

        expect(repos.isDirty()).toBe(false);
        expect(await repos.flush()).toBe(0);
    });
});

describe('metrics repository', () => {
    it('accumulates per day and per counter', async () => {
        const repos = createRepositories(createKvStub().namespace);

        await repos.metrics.increment('2025-01-01', 'auth.success');
        await repos.metrics.increment('2025-01-01', 'auth.success', 2);
        await repos.metrics.increment('2025-01-02', 'auth.failure');

        const { days, totals } = await repos.metrics.snapshot();

        expect(days.map(day => day.day)).toEqual(['2025-01-01', '2025-01-02']);
        expect(days[0].counters['auth.success']).toBe(3);
        expect(totals).toEqual({ 'auth.success': 3, 'auth.failure': 1 });
    });

    it('sorts days ascending on write, so the read path does no work', async () => {
        const repos = createRepositories(createKvStub().namespace);

        await repos.metrics.increment('2025-03-01', 'auth.success');
        await repos.metrics.increment('2025-01-01', 'auth.success');
        await repos.metrics.increment('2025-02-01', 'auth.success');

        const { days } = await repos.metrics.snapshot();
        expect(days.map(day => day.day)).toEqual(['2025-01-01', '2025-02-01', '2025-03-01']);
    });

    it('retains only the newest window, dropping the oldest days', async () => {
        const repos = createRepositories(createKvStub().namespace);

        for (let i = 0; i < RETENTION.metricDays + 5; i += 1) {
            const day = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
            await repos.metrics.increment(day, 'auth.success');
        }

        const { days } = await repos.metrics.snapshot();
        expect(days).toHaveLength(RETENTION.metricDays);
        expect(days[0].day).toBe('2025-01-06');
    });

    it('treats a corrupt document as empty rather than failing the request', async () => {
        const kv = createKvStub({ 'rz:metrics': '{{{ not json' });
        const repos = createRepositories(kv.namespace);

        expect(await repos.metrics.snapshot()).toEqual({ days: [], totals: {} });
    });

    it('survives a KV read that throws', async () => {
        // Derived, non-authoritative data: a namespace error must degrade the
        // counter, not 500 the panel.
        const namespace = {
            get: async () => {
                throw new Error('kv unavailable');
            },
            put: async () => undefined
        } as unknown as KVNamespace;

        const repos = createRepositories(namespace);
        await repos.metrics.increment('2025-01-01', 'auth.success');

        expect((await repos.metrics.snapshot()).totals['auth.success']).toBe(1);
    });
});

describe('scanner repository', () => {
    const summary = (kind: 'clean-ip' | 'warp-endpoint', at: number, id: string) => ({
        id, at, kind, targets: 2, healthy: 1,
        best: { address: '1.2.3.4', score: 80 },
        medianScore: 60
    });

    it('keeps runs newest first, per kind, and records the last run time', async () => {
        const repos = createRepositories(createKvStub().namespace);

        await repos.scanner.recordRun(summary('clean-ip', 1_000, 'a'));
        await repos.scanner.recordRun(summary('clean-ip', 2_000, 'b'));
        await repos.scanner.recordRun(summary('warp-endpoint', 3_000, 'c'));

        expect((await repos.scanner.listRuns('clean-ip')).map(run => run.id)).toEqual(['b', 'a']);
        expect((await repos.scanner.listRuns('warp-endpoint')).map(run => run.id)).toEqual(['c']);
        expect(await repos.scanner.lastRunAt('clean-ip')).toBe(2_000);
        expect(await repos.scanner.lastRunAt('proxy-ip')).toBeNull();
    });

    it('bounds retained runs per kind', async () => {
        const repos = createRepositories(createKvStub().namespace);

        for (let i = 0; i < RETENTION.scanRunsPerKind + 4; i += 1) {
            await repos.scanner.recordRun(summary('clean-ip', i, `run-${i}`));
        }

        const runs = await repos.scanner.listRuns('clean-ip');
        expect(runs).toHaveLength(RETENTION.scanRunsPerKind);
        expect(runs[0].id).toBe(`run-${RETENTION.scanRunsPerKind + 3}`);
    });

    it('clear() drops runs and schedule state together', async () => {
        const repos = createRepositories(createKvStub().namespace);
        await repos.scanner.recordRun(summary('clean-ip', 1, 'a'));

        await repos.scanner.clear();

        expect(await repos.scanner.listRuns('clean-ip')).toEqual([]);
        expect(await repos.scanner.lastRunAt('clean-ip')).toBeNull();
    });
});

/* ------------------------------------------------------------------ *
 * Feature registry
 * ------------------------------------------------------------------ */

function capabilities(overrides: Partial<CapabilityContext> = {}): CapabilityContext {
    return {
        deployType: 'workers',
        hasPassword: true,
        hasTelegramBot: true,
        hasWarpAccounts: true,
        hasApiToken: true,
        hasKv: true,
        hasCustomDomain: true,
        protocols: ['vless', 'trojan'],
        ...overrides
    };
}

describe('feature registry', () => {
    it('evaluates every shipped feature and never throws on a bare deployment', () => {
        const registry = createFeatureRegistry(CORE_FEATURES);
        const statuses = registry.evaluateAll(
            capabilities({
                hasPassword: false, hasTelegramBot: false, hasWarpAccounts: false,
                hasApiToken: false, hasKv: false, hasCustomDomain: false, protocols: []
            })
        );

        expect(statuses).toHaveLength(CORE_FEATURES.length);
        for (const status of statuses) {
            expect(status.state).not.toBe('available');
            // The whole point of the registry: an unavailable feature explains
            // itself rather than silently disappearing from the UI.
            expect(status.reason).toBeTruthy();
            expect(status.requires.length).toBeGreaterThan(0);
        }
    });

    it('reports every feature available on a fully configured deployment', () => {
        const registry = createFeatureRegistry(CORE_FEATURES);

        for (const status of registry.evaluateAll(capabilities())) {
            expect(status.state, status.id).toBe('available');
            expect(status.reason).toBeUndefined();
        }
    });

    it('distinguishes degraded from unavailable', () => {
        // A password-less panel works and is dangerous; a KV-less one cannot store
        // history at all. Collapsing the two would lose the distinction the UI needs.
        const registry = createFeatureRegistry(CORE_FEATURES);

        expect(registry.evaluate('panel.auth', capabilities({ hasPassword: false }))?.state).toBe('degraded');
        expect(registry.evaluate('panel.auth', capabilities({ hasKv: false }))?.state).toBe('unavailable');
        expect(registry.evaluate('platform.history', capabilities({ hasKv: false }))?.state).toBe('unavailable');
        expect(registry.evaluate('platform.scanner', capabilities({ hasKv: false }))?.state).toBe('degraded');
    });

    it('returns null for an unknown id rather than inventing a status', () => {
        const registry = createFeatureRegistry(CORE_FEATURES);

        expect(registry.evaluate('does.not.exist', capabilities())).toBeNull();
        expect(registry.isAvailable('does.not.exist', capabilities())).toBe(false);
    });

    it('rejects a duplicate id at registration', () => {
        const definition = {
            id: 'dup', title: 'Dup', requires: ['x'],
            evaluate: () => ({ state: 'available' as const })
        };

        expect(() => createFeatureRegistry([definition, definition])).toThrow(/already registered/);
    });

    it('every shipped feature id is unique and dot-namespaced', () => {
        const ids = CORE_FEATURES.map(feature => feature.id);

        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(id).toMatch(/^[a-z]+\.[a-z-]+$/);
    });
});

/* ------------------------------------------------------------------ *
 * Capability assembly
 * ------------------------------------------------------------------ */

describe('capability assembly', () => {
    it('an empty protocol string is no protocols, not one', () => {
        // `''.split(',')` is `['']`, which would turn the protocols-enabled check
        // into a false pass.
        expect(protocolList('')).toEqual([]);
        expect(protocolList(' vless , trojan ')).toEqual(['vless', 'trojan']);
        expect(protocolList(',,')).toEqual([]);
    });

    const input = (overrides: Partial<CapabilityInput> = {}): CapabilityInput => ({
        settings: {
            protocols: 'vless,trojan',
            ports: [443, 80],
            remoteDNS: 'https://8.8.8.8/dns-query',
            localDNS: '8.8.8.8',
            antiSanctionDNS: 'https://1.1.1.1/dns-query',
            enableIPv6: true,
            allowLANConnection: false,
            logLevel: 'warning',
            fakeDNS: false,
            enableECH: false,
            cleanIPs: ['1.2.3.4'],
            customCdnAddrs: [],
            warpEndpoints: ['engage.cloudflareclient.com:2408'],
            blockAds: true,
            blockMalware: true,
            blockPhishing: true,
            customBypassRules: [],
            customBlockRules: [],
            panelVersion: '1.0.0',
            customDomain: 'panel.example'
        },
        deployType: 'workers',
        hasKv: true,
        hasApiToken: true,
        hasPassword: true,
        hasTelegramBot: false,
        hasWarpAccounts: true,
        ...overrides
    });

    it('derives hasCustomDomain from the setting rather than taking it on trust', () => {
        expect(toCapabilityContext(input()).hasCustomDomain).toBe(true);

        const without = input();
        without.settings = { ...without.settings, customDomain: '' };
        expect(toCapabilityContext(without).hasCustomDomain).toBe(false);
    });

    it('the diagnostics context carries no credential-bearing field', () => {
        // The narrowing is the guarantee: a check cannot read what it is not given.
        const context = toDiagnosticsContext(input(), '1.0.0', null);
        const serialised = JSON.stringify(context);

        for (const secret of ['vlUUID', 'trPass', 'securePath', 'apiToken', 'accEmail', 'accID']) {
            expect(serialised).not.toContain(secret);
        }

        expect(context.currentVersion).toBe('1.0.0');
        expect(context.statistics).toBeNull();
    });

    it('a stored Telegram record with an empty token is not a configured bot', async () => {
        // `getDataset` writes `{ telegramBotToken: '', telegramUserId: '' }` on
        // first run, so presence of the record is not presence of a bot.
        const kv = createKvStub({ telegramBot: { telegramBotToken: '', telegramUserId: '' } });
        const facts = await readStorageCapabilities(createStorage(kv.namespace));

        expect(facts).toEqual({ hasPassword: false, hasTelegramBot: false });
    });

    it('reads both storage facts, and reports them when present', async () => {
        const kv = createKvStub({
            pwd: 'hashed-or-plain',
            telegramBot: { telegramBotToken: 'token', telegramUserId: '1' }
        });

        expect(await readStorageCapabilities(createStorage(kv.namespace))).toEqual({
            hasPassword: true,
            hasTelegramBot: true
        });
    });
});

/* ------------------------------------------------------------------ *
 * Composition root
 * ------------------------------------------------------------------ */

describe('composition root', () => {
    it('performs no I/O and resolves no service when constructed', () => {
        // The header's claim, verbatim: "it is asserted by a test that checks
        // `isResolved` is false for every service after construction."
        const kv = createKvStub();
        const platform = createPlatform(kv.namespace);

        expect(kv.calls).toEqual([]);
        for (const key of platform.services.keys()) {
            expect(platform.services.isResolved(key), key).toBe(false);
        }
    });

    it('registers the whole catalogue, so a lookup is a compile-time question only', () => {
        const platform = createPlatform(createKvStub().namespace);

        expect(platform.services.keys()).toEqual([
            'storage', 'events', 'repositories', 'analytics', 'history', 'diagnostics', 'optimization', 'scanner'
        ]);
    });

    it('attaches subscribers eagerly, because a late listener has already missed the event', () => {
        const platform = createPlatform(createKvStub().namespace);

        // Analytics and history both listen to settings.updated.
        expect(platform.events.listenerCount('settings.updated')).toBe(2);
        expect(platform.events.listenerCount('auth.attempt')).toBe(1);
        expect(platform.events.listenerCount()).toBeGreaterThan(0);
    });

    it('resolves a service only when an event actually reaches a listener', async () => {
        const kv = createKvStub();
        const platform = createPlatform(kv.namespace);

        expect(platform.services.isResolved('repositories')).toBe(false);

        platform.events.emit('auth.login', {});
        await platform.events.settled();

        expect(platform.services.isResolved('history')).toBe(true);
        expect(platform.services.isResolved('repositories')).toBe(true);
        // Analytics has no auth.login subscriber, so it stayed unbuilt.
        expect(platform.services.isResolved('analytics')).toBe(false);
    });

    it('dispose flushes once, detaches every listener, and is safe to repeat', async () => {
        setRuntimeDeps({ now: () => new Date('2025-01-01T00:00:00.000Z') });
        const kv = createKvStub();
        const platform = createPlatform(kv.namespace);

        platform.events.emit('settings.updated', { changed: ['ports'], version: '1' });

        const first = await platform.dispose();
        // One settings.updated reaches history (rz:history) and analytics
        // (rz:metrics), so two documents are dirty and two writes happen.
        expect(first.writes).toBe(2);
        expect(first.failures).toEqual([]);
        expect(platform.events.listenerCount()).toBe(0);

        const second = await platform.dispose();
        expect(second).toEqual({ writes: 0, failures: [] });
        expect(kv.calls.filter(call => call.op === 'put')).toHaveLength(2);
    });

    it('dispose reports listener failures instead of throwing them at the caller', async () => {
        const platform = createPlatform(createKvStub().namespace);
        platform.events.on('auth.login', () => {
            throw new Error('subscriber is broken');
        });

        platform.events.emit('auth.login', {});
        const { failures } = await platform.dispose();

        expect(failures).toHaveLength(1);
        expect(failures[0].event).toBe('auth.login');
    });

    it('asking for the scanner without a transport fails with an actionable message', () => {
        // Registered either way on purpose: creating a platform without a probe is
        // the normal case, and asking for the scanner is the error.
        const platform = createPlatform(createKvStub().namespace);

        expect(() => platform.services.get('scanner')).toThrow(/Pass `probe` to createPlatform/);
    });

    it('omits the scanner recommendation provider when no transport exists', () => {
        // Otherwise `scanner.best` would throw on the recommendation path, and a
        // list that fails because scanning is unavailable is worse than one with no
        // scan-derived advice.
        const withoutProbe = createPlatform(createKvStub().namespace);
        expect(withoutProbe.recommendations.providers()).toEqual(['diagnostics', 'presets', 'optimization']);

        const withProbe = createPlatform(createKvStub().namespace, {
            probe: { connect: () => ({ opened: Promise.resolve(), close: () => undefined }) }
        });
        expect(withProbe.recommendations.providers()).toEqual(['diagnostics', 'presets', 'optimization', 'scanner']);
    });

    it('exposes the shipped feature and preset catalogues', () => {
        const platform = createPlatform(createKvStub().namespace);

        expect(platform.features.list()).toHaveLength(CORE_FEATURES.length);
        expect(platform.presets.list().length).toBeGreaterThan(0);
    });

    it('two platforms over one namespace share no state', () => {
        // Request-scoped by construction: this is the property that keeps a
        // KV-bound repository from leaking into the next request.
        const kv = createKvStub();
        const first = createPlatform(kv.namespace);
        const second = createPlatform(kv.namespace);

        expect(first.services.get('repositories')).not.toBe(second.services.get('repositories'));
        expect(first.events).not.toBe(second.events);
    });
});

/* ------------------------------------------------------------------ *
 * Recording seam
 * ------------------------------------------------------------------ */

describe('withRecorder', () => {
    beforeEach(() => {
        setRuntimeDeps({ now: () => new Date('2025-01-01T00:00:00.000Z') });
    });

    it('records and flushes in one call', async () => {
        const kv = createKvStub();

        await withRecorder(createEnv(kv.namespace), platform => {
            platform.events.emit('auth.login', {});
        });

        const stored = JSON.parse(kv.store.get('rz:history') ?? '{}');
        expect(stored.entries).toHaveLength(1);
        expect(stored.entries[0].summary).toBe('Panel sign-in.');
    });

    it('records every event of a multi-fact publish', async () => {
        // The serialised document queue is what makes this hold: two events against
        // one document used to persist one.
        const kv = createKvStub();

        await withRecorder(createEnv(kv.namespace), platform => {
            platform.events.emit('auth.attempt', { ok: true });
            platform.events.emit('auth.login', {});
            platform.events.emit('warp.refreshed', { accounts: 2 });
        });

        const history = JSON.parse(kv.store.get('rz:history') ?? '{}');
        const metrics = JSON.parse(kv.store.get('rz:metrics') ?? '{}');

        expect(history.entries.map((entry: { kind: string }) => entry.kind)).toEqual([
            'warp.refreshed', 'auth.login'
        ]);
        expect(metrics.days[0].counters).toEqual({ 'auth.success': 1, 'warp.refreshes': 1 });
    });

    it('does nothing at all without a KV binding', async () => {
        // Every repository would fail on first use, so there is nothing to record.
        await expect(withRecorder({ CF_PAGES: '0' } as Env, () => {
            throw new Error('must not run');
        })).resolves.toBeUndefined();
    });

    it('never lets a recording failure reach the caller', async () => {
        // The rule this module exists to enforce: a settings save that succeeded
        // returns success even if its history write failed.
        const namespace = {
            get: async () => null,
            put: async () => {
                throw new Error('kv write failed');
            }
        } as unknown as KVNamespace;

        await expect(withRecorder(createEnv(namespace), platform => {
            platform.events.emit('auth.login', {});
        })).resolves.toBeUndefined();
    });

    it('swallows a throwing recorder callback and still disposes', async () => {
        const kv = createKvStub();

        await expect(withRecorder(createEnv(kv.namespace), () => {
            throw new Error('caller bug');
        })).resolves.toBeUndefined();

        // Nothing was recorded, so nothing was written.
        expect(kv.calls.filter(call => call.op === 'put')).toEqual([]);
    });

    it('logs one line per failed listener, which is the only signal an operator gets', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        await withRecorder(createEnv(createKvStub().namespace), platform => {
            platform.events.on('auth.login', () => {
                throw new Error('counter is broken');
            });
            platform.events.emit('auth.login', {});
        });

        expect(log.mock.calls.some(([message]) => String(message).includes("Listener for 'auth.login' failed"))).toBe(true);
    });
});

/** Kept so the event-name union is exercised as a type, not just as strings. */
export type _EventNameShape = EventName;
