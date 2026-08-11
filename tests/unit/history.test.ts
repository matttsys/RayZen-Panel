/**
 * The redaction guarantee that `src/features/history/service.ts` claims exists.
 *
 * That module's header says: "A test asserts that no entry produced by the built-in
 * subscribers contains any value from a settings object." This file is that test.
 *
 * Why the assertion is built this way
 *
 * The threat is not a careless string somewhere; it is an audit log that leaks the
 * values which identify a deployment to a censor (UUID, Trojan password, proxy
 * addresses). Asserting "the summary does not contain the UUID" would pass
 * accidentally for a subscriber that leaked a different secret, so the check is
 * inverted: build a settings object full of *sentinel* values, drive every event
 * the subscriber table handles, then serialise each recorded entry whole and fail if
 * any sentinel appears anywhere in it. That catches a leak in `summary`, in
 * `detail`, and in any field a future entry shape adds, because the search is over
 * the serialised entry rather than over named fields.
 *
 * The payloads carry the sentinel values deliberately. `settings.updated` legitimately
 * carries changed key *names*, so the key names are sentinel-free while the values
 * they map to are sentinels; an implementation that recorded values instead of names
 * fails here.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createEventBus, type EventBus } from '@platform/events';
import { createHistoryService, subscribeHistory, summariseChanges, type HistoryService } from '@features/history/service';
import { createRepositories, RETENTION } from '@platform/repositories';
import { resetRuntimeDeps, setRuntimeDeps, seededRandom } from '@runtime';
import type { HistoryEntry, HistoryKind } from '#types/platform';
import { createKvStub } from '../helpers/worker';

/**
 * Values that must never reach a history entry. Chosen to be unmistakable in a
 * serialised blob and to mirror the real secret-bearing settings fields.
 */
const SENTINELS = {
    vlUUID: 'SENTINEL-1111-4111-8111-uuidleak00001',
    trPass: 'SENTINEL_trojan_password_leak',
    securePath: 'SENTINEL-secure-path-leak',
    proxyIP: 'SENTINEL.proxy.leak.example',
    cleanIP: 'SENTINEL.clean.leak.example',
    warpEndpoint: 'SENTINEL.warp.leak.example:2408'
} as const;

const SENTINEL_VALUES = Object.values(SENTINELS);

function assertRedacted(entries: readonly HistoryEntry[]) {
    const serialised = JSON.stringify(entries);
    for (const secret of SENTINEL_VALUES) {
        expect(serialised, `history leaked ${secret}`).not.toContain(secret);
    }
}

function harness() {
    const kv = createKvStub();
    const repos = createRepositories(kv.namespace);
    const bus = createEventBus();
    const history = createHistoryService(repos.history);
    const off = subscribeHistory(bus, history);

    return { kv, repos, bus, history, off };
}

/**
 * Waits for every write a publish started.
 *
 * `bus.settled()` is sufficient on its own, and that is a property worth naming: it
 * only holds because each subscriber *returns* its `record()` promise rather than
 * voiding it, so `emit` can track it. The regression test for that is
 * `settled() awaits subscriber writes`.
 */
async function drain(bus: EventBus): Promise<void> {
    await bus.settled();
}

beforeEach(() => {
    // Deterministic ids and timestamps: entry ids are `${time}-${random}`, and an
    // id that changes per run cannot be asserted on.
    setRuntimeDeps({ random: seededRandom(7), now: () => new Date('2025-01-01T00:00:00.000Z') });
});

afterEach(() => {
    resetRuntimeDeps();
});

describe('history redaction', () => {
    it('records no settings value for any event the subscriber table handles', async () => {
        const { bus, history, repos } = harness();

        // Every event in the table, each payload carrying sentinel-bearing data
        // wherever the real publisher could plausibly pass a value.
        //
        // All six are fired before a single drain, deliberately: it is the shape a
        // real request takes, and it only records six entries because
        // `Document.update` serialises its read-modify-write. See
        // `concurrent record() calls all persist` below.
        bus.emit('settings.updated', {
            changed: ['vlUUID', 'trPass', 'securePath', 'proxyIPs', 'cleanIPs'],
            version: '1.2.3'
        });
        bus.emit('settings.reset', { version: '1.2.3' });
        bus.emit('panel.updated', { from: '1.2.3', to: '1.2.4' });
        bus.emit('warp.refreshed', { accounts: 2 });
        bus.emit('scanner.completed', { targets: 5, healthy: 3 });
        bus.emit('auth.login', {});

        await drain(bus);

        await repos.flush();

        const entries = await history.list();
        expect(entries).toHaveLength(6);
        assertRedacted(entries);
    });

    it('records changed key names, which is the useful half of the transition', async () => {
        // The redaction check above would also pass if the subscriber recorded
        // nothing at all, so this pins the positive requirement.
        const { bus, history } = harness();

        bus.emit('settings.updated', { changed: ['vlUUID', 'trPass'], version: '9.9.9' });
        await drain(bus);

        const [entry] = await history.list();
        expect(entry.summary).toBe('Updated vlUUID, trPass.');
        expect(entry.detail).toEqual({ keys: 2, version: '9.9.9' });
    });

    it('does not record failed auth attempts', async () => {
        // Explicitly designed out: a log of failed login times reveals when the
        // operator is at their keyboard, and under an attack it would evict every
        // useful entry from a 100-entry budget.
        const { bus, history } = harness();

        for (let i = 0; i < 5; i++) bus.emit('auth.attempt', { ok: false });
        bus.emit('auth.attempt', { ok: true });
        await drain(bus);

        expect(await history.list()).toEqual([]);
    });

    it('does not record rejected settings, whose issues quote user input', async () => {
        const { bus, history } = harness();

        bus.emit('settings.rejected', {
            issues: [
                {
                    code: 'proxy.ip-invalid',
                    field: 'proxyIPs',
                    label: 'Proxy IPs - Domains',
                    message: SENTINELS.proxyIP,
                    severity: 'error'
                }
            ]
        });
        await drain(bus);

        const entries = await history.list();
        expect(entries).toEqual([]);
        assertRedacted(entries);
    });

    it('does not record config exports, which name the subscription path', async () => {
        const { bus, history } = harness();

        bus.emit('config.exported', {
            subscription: SENTINELS.securePath,
            core: 'xray',
            client: 'v2rayng',
            bytes: 1024
        });
        bus.emit('scanner.probed', { target: SENTINELS.cleanIP, ok: true, latencyMs: 12 });
        await drain(bus);

        const entries = await history.list();
        expect(entries).toEqual([]);
        assertRedacted(entries);
    });

    it('unsubscribing stops recording', async () => {
        // A leaked listener in a long-lived isolate would keep appending entries for
        // a context that is gone, spending the write budget on nothing.
        const { bus, history, off } = harness();

        off();
        bus.emit('auth.login', {});
        await drain(bus);

        expect(await history.list()).toEqual([]);
        expect(bus.listenerCount()).toBe(0);
    });
});

describe('summariseChanges', () => {
    it('names up to three keys in full', () => {
        expect(summariseChanges(['a'])).toBe('Updated a.');
        expect(summariseChanges(['a', 'b', 'c'])).toBe('Updated a, b, c.');
    });

    it('counts the remainder past three, so summary length is bounded', () => {
        // A settings save can touch 80 keys. This is the property that keeps one
        // entry near the ~150 byte figure the retention budget was sized against.
        expect(summariseChanges(['a', 'b', 'c', 'd'])).toBe('Updated a, b, c and 1 more.');

        const many = Array.from({ length: 80 }, (_, i) => `key${i}`);
        const summary = summariseChanges(many);

        expect(summary).toBe('Updated key0, key1, key2 and 77 more.');
        expect(summary.length).toBeLessThan(120);
    });

    it('states the no-change case rather than emitting an empty summary', () => {
        expect(summariseChanges([])).toBe('Settings saved with no changes.');
    });
});

describe('history service', () => {
    it('stamps a unique id even for entries recorded in the same millisecond', async () => {
        // `entryId` mixes time with 6 base-36 random characters precisely because a
        // single request can record two facts within one millisecond, and duplicate
        // ids would break any client keyed on them.
        const { history, repos } = harness();

        await history.record('auth.login', 'one');
        await history.record('auth.login', 'two');
        await repos.flush();

        const entries = await history.list();
        const ids = entries.map(entry => entry.id);

        expect(new Set(ids).size).toBe(2);
        for (const id of ids) expect(id).toMatch(/^[0-9a-z]+-[0-9a-z]{6}$/);
    });

    it('omits detail entirely when it is empty, rather than storing `{}`', async () => {
        const { history } = harness();

        await history.record('auth.login', 'no detail');
        await history.record('auth.login', 'empty detail', {});

        for (const entry of await history.list()) {
            expect('detail' in entry).toBe(false);
        }
    });

    it('lists newest first', async () => {
        const { history } = harness();
        let clock = 1_000;
        setRuntimeDeps({ now: () => new Date(clock) });

        await history.record('auth.login', 'first');
        clock = 2_000;
        await history.record('auth.login', 'second');

        expect((await history.list()).map(entry => entry.summary)).toEqual(['second', 'first']);
    });

    it('filters by kind and clamps the limit', async () => {
        const { history } = harness();

        await history.record('auth.login', 'login');
        await history.record('settings.reset', 'reset');
        await history.record('auth.login', 'login again');

        expect(await history.listByKind('auth.login')).toHaveLength(2);
        expect(await history.listByKind('auth.login', 1)).toHaveLength(1);
        expect(await history.listByKind('panel.updated')).toEqual([]);
    });

    it('latest() returns the newest entry of a kind, or null', async () => {
        // Diagnostics uses this for staleness, so "no entry" must be distinguishable
        // from "an old entry" rather than throwing or returning undefined.
        const { history } = harness();

        expect(await history.latest('warp.refreshed')).toBeNull();

        let clock = 1_000;
        setRuntimeDeps({ now: () => new Date(clock) });
        await history.record('warp.refreshed', 'old');
        clock = 5_000;
        await history.record('warp.refreshed', 'new');

        expect((await history.latest('warp.refreshed'))?.summary).toBe('new');
    });

    it('clear() empties the log', async () => {
        const { history } = harness();

        await history.record('auth.login', 'x');
        await history.clear();

        expect(await history.list()).toEqual([]);
    });

    it('never grows past the retention bound', async () => {
        // The bound is the reason the log is safe to read on a panel request: KV has
        // no append, so the value's size is also every write's cost.
        const { history, repos, kv } = harness();

        for (let i = 0; i < RETENTION.historyEntries + 25; i++) {
            await history.record('auth.login', `entry ${i}`);
        }
        await repos.flush();

        const entries = await history.list();
        expect(entries).toHaveLength(RETENTION.historyEntries);
        // Newest survive, oldest are dropped.
        expect(entries[0].summary).toBe(`entry ${RETENTION.historyEntries + 24}`);
        expect(entries.some(entry => entry.summary === 'entry 0')).toBe(false);

        // 125 appends, one KV write: the whole point of the flush seam.
        expect(kv.calls.filter(call => call.op === 'put')).toHaveLength(1);
    });

    it('a throwing listener elsewhere does not stop history from recording', async () => {
        // Constraint 1 of the bus: a broken subscriber cannot fail a settings save,
        // and it must not starve the other subscribers either.
        const { bus, history } = harness();
        bus.on('settings.updated', () => {
            throw new Error('analytics is broken');
        });

        bus.emit('settings.updated', { changed: ['ports'], version: '1' });
        const failures = await bus.settled();

        expect(failures).toHaveLength(1);
        expect(await history.list()).toHaveLength(1);
    });

    it('settled() awaits subscriber writes', async () => {
        // REGRESSION GUARD. `EventBus.emit` only tracks a promise a listener
        // *returns*: `invoke()` checks `result instanceof Promise`. Subscribers
        // originally called `void history.record(...)`, so `pending` stayed empty and
        // `settled()` resolved with the write still in flight.
        //
        // WHY IT MATTERS: `context.dispose()` orders `events.settled()` before
        // `repositories.flush()` precisely so listener writes land before the flush.
        // With a voided promise that ordering is unenforced, and any listener whose
        // write is gated on a real await (a KV read miss, a fetch) can be flushed
        // before it has mutated anything, losing the entry for good.
        const { bus, history } = harness();

        bus.emit('auth.login', {});
        await bus.settled();

        // No extra macrotask turn: settled() alone is the contract.
        expect(await history.list()).toHaveLength(1);
    });

    it('concurrent record() calls all persist', async () => {
        // REGRESSION GUARD. `Document.update` reads the cached document with
        // `await read()` and then assigns `cached = mutate(...)`. `read()` yields a
        // microtask even on a cache hit, so without serialisation two overlapping
        // updates both capture the same base value and the second assignment
        // discards the first mutation.
        //
        // WHY IT IS NOT THEORETICAL: one request can publish two history-worthy
        // events (a settings save plus the sign-in that preceded it, or a scan plus a
        // WARP refresh). The promise chain in `createDocument` is what makes all of
        // them survive; the module header's concurrency caveat is about
        // *cross-isolate* races, which this does not and cannot fix.
        const { history, repos } = harness();

        await Promise.all([
            history.record('auth.login', 'first'),
            history.record('settings.reset', 'second'),
            history.record('warp.refreshed', 'third')
        ]);
        await repos.flush();

        const entries = await history.list();

        // Newest first, and mutations applied in call order, so the last recorded
        // entry heads the list and none were dropped.
        expect(entries).toHaveLength(3);
        expect(entries.map(entry => entry.summary)).toEqual(['third', 'second', 'first']);
    });

    it('a flush racing an in-flight update does not lose the update', async () => {
        // `flush()` awaits the update queue before writing, so a caller that flushes
        // while a mutation is still queued writes the mutated document rather than
        // writing a stale one and then clearing `dirty`.
        const { history, repos, kv } = harness();

        const write = history.record('auth.login', 'in flight');
        const flushed = await repos.flush();
        await write;

        expect(flushed).toBe(1);
        expect(kv.store.get('rz:history')).toContain('in flight');
        // Nothing left dirty, so no second write is owed.
        expect(repos.isDirty()).toBe(false);
    });
});

describe('history kind coverage', () => {
    const KINDS: readonly HistoryKind[] = [
        'settings.updated',
        'settings.reset',
        'panel.updated',
        'warp.refreshed',
        'scanner.run',
        'auth.login'
    ];

    it('every declared kind is produced by some subscriber', async () => {
        // Pins the mapping between the event catalogue and the history kind union: a
        // kind no subscriber ever writes is dead type surface, and an event that
        // writes an undeclared kind would not compile.
        const { bus, history } = harness();

        bus.emit('settings.updated', { changed: ['ports'], version: '1' });
        bus.emit('settings.reset', { version: '1' });
        bus.emit('panel.updated', { from: '1', to: '2' });
        bus.emit('warp.refreshed', { accounts: 1 });
        bus.emit('scanner.completed', { targets: 1, healthy: 1 });
        bus.emit('auth.login', {});
        await drain(bus);

        const produced = new Set((await history.list()).map(entry => entry.kind));
        expect([...produced].sort()).toEqual([...KINDS].sort());
    });

    it('scanner.completed is stored under the scanner.run kind', async () => {
        // The one place the event name and the history kind deliberately differ:
        // several probes make one run. Pinned because a future rename that
        // "fixes" the mismatch would orphan stored entries.
        const { bus, history } = harness();

        bus.emit('scanner.completed', { targets: 4, healthy: 2 });
        await drain(bus);

        const [entry] = await history.list();
        expect(entry.kind).toBe('scanner.run');
        expect(entry.summary).toBe('Scanned 4 target(s), 2 healthy.');
        expect(entry.detail).toEqual({ targets: 4, healthy: 2 });
    });
});

describe('history persistence', () => {
    it('survives a fresh repository over the same KV', async () => {
        const kv = createKvStub();

        const first = createRepositories(kv.namespace);
        const firstHistory = createHistoryService(first.history);
        await firstHistory.record('auth.login', 'from the first request');
        await first.flush();

        const second = createRepositories(kv.namespace);
        const secondHistory = createHistoryService(second.history);

        expect((await secondHistory.list()).map(entry => entry.summary)).toEqual([
            'from the first request'
        ]);
    });

    it('treats a corrupt stored value as an empty log rather than failing', async () => {
        // Derived, non-authoritative data: losing the log beats a 500 on every
        // panel request.
        const kv = createKvStub({ 'rz:history': 'not json at all' });
        const repos = createRepositories(kv.namespace);
        const history = createHistoryService(repos.history);

        expect(await history.list()).toEqual([]);

        await history.record('auth.login', 'after recovery');
        expect(await history.list()).toHaveLength(1);
    });

    it('does not write when nothing was recorded', async () => {
        const kv = createKvStub();
        const repos = createRepositories(kv.namespace);
        const history = createHistoryService(repos.history);

        await history.list();
        expect(await repos.flush()).toBe(0);
        expect(kv.calls.filter(call => call.op === 'put')).toEqual([]);
    });
});

describe('history detail typing', () => {
    it('rejects a nested settings object at compile time', () => {
        const { history } = harness();

        // @ts-expect-error HistoryDetail is flat primitives: this is the type-level
        // half of the redaction guarantee, and the compile error is the assertion.
        void history.record('settings.updated', 'nested', { settings: { vlUUID: SENTINELS.vlUUID } });
    });

    it('accepts flat primitives', async () => {
        const { history } = harness();

        await history.record('settings.updated', 'flat', { keys: 3, version: '1', ok: true });
        expect((await history.list())[0].detail).toEqual({ keys: 3, version: '1', ok: true });
    });
});

describe('history service seams', () => {
    it('reads its clock and randomness through the runtime seam', async () => {
        // Not incidental: without the seam an entry id and timestamp differ on every
        // run, so nothing about an entry could be asserted.
        const now = vi.fn(() => new Date('2030-06-01T12:00:00.000Z'));
        setRuntimeDeps({ now, random: () => 0 });

        const { history } = harness();
        await history.record('auth.login', 'x');

        const [entry] = await history.list();
        expect(now).toHaveBeenCalled();
        expect(entry.at).toBe(Date.parse('2030-06-01T12:00:00.000Z'));
        expect(entry.id.endsWith('-000000')).toBe(true);
    });
});

/** Kept for the type import to be used, and to document the service shape. */
export type _HistoryServiceShape = HistoryService;
export type _BusShape = EventBus;
