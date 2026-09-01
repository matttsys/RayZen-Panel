/**
 * Repositories: RayZen-native persistence, kept separate from the legacy upstream key space.
 *
 * Why A second key namespace
 *
 * `src/storage/storage.ts` owns five key names inherited from legacy upstream verbatim
 * (`proxySettings`, `warpAccounts`, `telegramBot`, `pwd`, `secretKey`). Those are a
 * compatibility contract: an existing deployment's data is found by those exact
 * strings, and a test pins them at exactly five. RayZen persists things legacy upstream never
 * had (metrics, audit history, scan results), and putting them in the
 * same flat space would blur the line between "must never change" and "ours to
 * evolve".
 *
 * So every RayZen-native key is prefixed `rz:` and lives here. The prefix means an
 * operator listing the namespace can tell at a glance which keys predate RayZen,
 * and a future migration can enumerate ours without touching theirs.
 *
 * The write budget is the design constraint
 *
 * Cloudflare's free plan allows 1,000 KV writes per day against 100,000 reads.
 * That ratio, not elegance, dictates the shape of everything below:
 *
 *   - One key per concern, not one key per record. A day of metrics is a single
 *     value that is read, incremented in memory and written once, rather than a
 *     key per counter.
 *   - Every list is bounded at write time with a hard cap, so a value can never
 *     grow past what a single KV value tolerates (25 MiB, but we stay four orders
 *     of magnitude below it).
 *   - Repositories expose `flush` semantics: a caller mutates in memory and the
 *     platform writes once at the end of the request. Ten counter bumps cost one
 *     write, not ten.
 *
 * Why repositories rather than direct KV calls
 *
 * A repository is the only place that knows a value's shape, so a shape change is
 * one file. It also gives read-modify-write a single implementation, which matters
 * because KV is eventually consistent: two concurrent isolates that both
 * read-modify-write the same key will lose one update. The mitigation is stated
 * per repository rather than assumed away: it is acceptable for counters and audit
 * entries, and would not be for anything transactional.
 */

import type { HourBucket } from '@features/analytics/traffic';
import type { BlockObservation } from '@features/scanner/blocks';
import { normaliseProfiles, type Profile } from '@features/profiles';
import type {
    DailyMetrics,
    HistoryEntry,
    MetricName,
    MetricsSnapshot,
    ScanRunSummary,
    ScanTargetKind
} from '#types/platform';

/**
 * RayZen-native KV keys. Additive only: a rename orphans data, exactly as in the
 * legacy upstream key space, so the names are pinned by a test.
 */
export const PLATFORM_KV_KEYS = {
    /** Rolling window of per-day counters. One value, not one per day. */
    metrics: 'rz:metrics',
    /** Bounded audit log, newest first. */
    history: 'rz:history',
    /** Latest scan run summaries per target kind, plus schedule state. */
    scanner: 'rz:scanner',
    /**
     * Subscription profiles: the shared links, their expiry and their use counters.
     *
     * Deliberately its own key rather than a field in `proxySettings`. Two reasons. A
     * profile's use counter is written on a schedule of its own, and folding it into the
     * settings document would mean every counter update rewrote every setting. And the
     * settings document is exportable from the panel, so tokens stored in it would travel
     * in a backup file: a token is a credential that authorises somebody else's
     * subscription, and it has no business in a settings export.
     */
    profiles: 'rz:profiles'
} as const;

export type PlatformKvKey = (typeof PLATFORM_KV_KEYS)[keyof typeof PLATFORM_KV_KEYS];

/* ------------------------------------------------------------------ *
 * Bounds
 * ------------------------------------------------------------------ */

/**
 * Retention limits, chosen so each value stays small enough that reading it on a
 * panel request is cheap and writing it is a single operation.
 *
 * Sizing, measured rather than guessed: a day of metrics is ~10 counters at ~30 bytes each plus the day key, so 30 days
 * is roughly 10 KB of JSON. A history entry with a summary is ~150 bytes, so 100
 * entries is roughly 15 KB. Both are an order of magnitude below any KV limit and
 * decode in well under a millisecond.
 */
export const RETENTION = {
    /** Days of metrics retained. Older days are dropped on write. */
    metricDays: 30,
    /** Audit entries retained. */
    historyEntries: 100,
    /**
     * Hourly traffic buckets retained: seven days.
     *
     * Seven days is what makes a "peak period" mean anything — a single day cannot
     * distinguish a busy evening from one unusual hour — and at ~60 bytes a bucket
     * the whole series is about 10 KB, the same order as the daily counters it
     * shares a KV value with.
     */
    trafficHours: 168,
    /** Scan run summaries retained per target kind. */
    scanRunsPerKind: 20,
    /**
     * Block observations retained in total.
     *
     * 240, which is twelve blocks per scan across twenty scans. Sized against the
     * 60-day window in `src/features/scanner/blocks.ts`: a weekly scanner keeps about
     * two months of evidence, and a daily one keeps three weeks, which is longer than
     * the seven-day half-life makes useful anyway.
     */
    blockObservations: 240
} as const;

/* ------------------------------------------------------------------ *
 * Document store: the one place read-modify-write is implemented
 * ------------------------------------------------------------------ */

/**
 * A single JSON document in KV, cached for the life of the request and written at
 * most once.
 *
 * The caching is what makes the write budget work: a request that bumps three
 * counters and appends one history entry performs two reads and two writes, not
 * eight of each. It is safe because the cache lifetime equals the request
 * lifetime, so no cross-request staleness is introduced beyond KV's own eventual
 * consistency.
 */
interface Document<T> {
    read(): Promise<T>;
    /** Mutates the in-memory document and marks it dirty. */
    update(mutate: (current: T) => T): Promise<void>;
    /** Writes when dirty. Returns true when a write actually occurred. */
    flush(): Promise<boolean>;
    isDirty(): boolean;
}

function createDocument<T>(kv: KVNamespace, key: PlatformKvKey, empty: () => T): Document<T> {
    let cached: T | undefined;
    let dirty = false;

    const read = async (): Promise<T> => {
        if (cached !== undefined) return cached;

        // A corrupt or hand-edited value must not take the panel down. Treat any
        // unreadable document as empty: these are derived, non-authoritative
        // records, and losing them is strictly better than a 500 on every request.
        try {
            const stored = await kv.get(key, { type: 'json' });
            cached = (stored as T | null) ?? empty();
        } catch {
            cached = empty();
        }

        return cached;
    };

    /**
     * Serialises read-modify-write.
     *
     * Without this, two overlapping `update` calls both await `read()`, both
     * capture the same base value, and the second assignment discards the first
     * mutation. That is not a theoretical race: `subscribeHistory` and
     * `subscribeAnalytics` both call their service with `void`, so a single request
     * that publishes two events starts two unawaited updates against one document
     * and persists one of them. `read()` yields a microtask even on a cache hit, so
     * the interleaving is guaranteed rather than unlikely.
     *
     * A promise chain rather than a lock: each `update` awaits the previous one, so
     * mutations apply in call order and no caller can observe a half-applied
     * document. The chain never rejects, because a rejected link would deadlock
     * every subsequent update; a failing mutator is isolated per link instead.
     */
    let queue: Promise<void> = Promise.resolve();

    return {
        read,

        update(mutate) {
            const next = queue.then(async () => {
                const current = await read();
                cached = mutate(current);
                dirty = true;
            });

            // The chain swallows so one failed mutation cannot block the rest; the
            // returned promise still rejects, so the caller sees its own failure.
            queue = next.catch(() => undefined);
            return next;
        },

        async flush() {
            // The queue is awaited *before* the dirty check, not after. A flush that
            // raced an update which had not yet applied its mutation would otherwise
            // see `dirty === false`, return without writing, and leave the mutation
            // with nobody left to persist it: the platform flushes once per request.
            // Awaiting the queue as it stands at call time is the honest contract,
            // "write everything queued so far", and mutations queued after this point
            // belong to whoever flushes next.
            await queue;
            if (!dirty || cached === undefined) return false;

            await kv.put(key, JSON.stringify(cached));
            dirty = false;
            return true;
        },

        isDirty() {
            return dirty;
        }
    };
}

/* ------------------------------------------------------------------ *
 * Metrics repository
 * ------------------------------------------------------------------ */

interface MetricsDocument {
    days: DailyMetrics[];
    /**
     * Hourly traffic buckets, written by `src/features/analytics/traffic.ts` rather
     * than by this repository. They share one KV value with the daily counters
     * because they are the same fact at two resolutions and a second key would
     * double the read cost of the metrics view. Declared here so every mutator in
     * this file preserves the field instead of returning a fresh object that drops it.
     */
    hours?: HourBucket[];
}

export interface MetricsRepository {
    /** Adds `by` to a counter for the given UTC day. In memory until flushed. */
    increment(day: string, metric: MetricName, by?: number): Promise<void>;
    /** Everything retained, plus computed totals. */
    snapshot(): Promise<MetricsSnapshot>;
    /** Drops all metrics. Used by the panel's reset path. */
    clear(): Promise<void>;
}

/**
 * Concurrency note: two isolates incrementing on the same day can lose one
 * increment, because both read the same base value. That is accepted for counters
 * used to display trends, and it is documented rather than papered over. A
 * counter that mattered for correctness (quota enforcement, rate limiting) would
 * need a consistent counter built on Durable Objects, not this.
 */
function createMetricsRepository(doc: Document<MetricsDocument>): MetricsRepository {
    return {
        async increment(day, metric, by = 1) {
            if (by === 0) return;

            await doc.update(current => {
                const days = current.days.slice();
                const index = days.findIndex(entry => entry.day === day);

                if (index === -1) {
                    days.push({ day, counters: { [metric]: by } });
                } else {
                    const existing = days[index];
                    days[index] = {
                        day: existing.day,
                        counters: {
                            ...existing.counters,
                            [metric]: (existing.counters[metric] ?? 0) + by
                        }
                    };
                }

                // Sort ascending then keep the newest window. Sorting on write
                // rather than read means the read path, which the panel hits, does
                // no work.
                days.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
                return { ...current, days: days.slice(-RETENTION.metricDays) };
            });
        },

        async snapshot() {
            const { days } = await doc.read();
            const totals: Partial<Record<MetricName, number>> = {};

            for (const day of days) {
                for (const [metric, value] of Object.entries(day.counters) as [MetricName, number][]) {
                    totals[metric] = (totals[metric] ?? 0) + value;
                }
            }

            return { days, totals };
        },

        async clear() {
            await doc.update(current => ({ ...current, days: [] }));
        }
    };
}

/* ------------------------------------------------------------------ *
 * History repository
 * ------------------------------------------------------------------ */

interface HistoryDocument {
    entries: HistoryEntry[];
}

export interface HistoryRepository {
    /** Prepends an entry and trims to the retention bound. */
    append(entry: HistoryEntry): Promise<void>;
    /** Newest first. `limit` clamps to the retained window. */
    list(limit?: number): Promise<HistoryEntry[]>;
    /** Newest first, filtered by kind. */
    listByKind(kind: HistoryEntry['kind'], limit?: number): Promise<HistoryEntry[]>;
    clear(): Promise<void>;
}

function createHistoryRepository(doc: Document<HistoryDocument>): HistoryRepository {
    return {
        async append(entry) {
            await doc.update(current => ({
                entries: [entry, ...current.entries].slice(0, RETENTION.historyEntries)
            }));
        },

        async list(limit = RETENTION.historyEntries) {
            const { entries } = await doc.read();
            return entries.slice(0, Math.max(0, limit));
        },

        async listByKind(kind, limit = RETENTION.historyEntries) {
            const { entries } = await doc.read();
            return entries.filter(entry => entry.kind === kind).slice(0, Math.max(0, limit));
        },

        async clear() {
            await doc.update(() => ({ entries: [] }));
        }
    };
}

/* ------------------------------------------------------------------ *
 * Scanner repository
 * ------------------------------------------------------------------ */

interface ScannerDocument {
    /** Run summaries per target kind, newest first. */
    runs: Partial<Record<ScanTargetKind, ScanRunSummary[]>>;
    /** Epoch ms of the last completed run per kind, for the scheduler. */
    lastRunAt: Partial<Record<ScanTargetKind, number>>;
    /**
     * Per-/24 observations from device-side scans, newest first.
     *
     * Stored separately from `runs` because they answer a different question and have a
     * different lifetime. A run summary is "what happened in this scan"; a block
     * observation is one input to "what does this network route well", which is only
     * meaningful across scans. See src/features/scanner/blocks.ts.
     *
     * Optional so an existing deployment's document deserialises unchanged: this key did
     * not exist before v1.1 and a missing one must read as "no history", not as a fault.
     */
    blocks?: BlockObservation[];
}

export interface ScannerRepository {
    recordRun(summary: ScanRunSummary): Promise<void>;
    listRuns(kind: ScanTargetKind, limit?: number): Promise<ScanRunSummary[]>;
    lastRunAt(kind: ScanTargetKind): Promise<number | null>;
    /**
     * Appends block observations from one scan.
     *
     * Bounded per write rather than per block: a Deep scan touches ~900 distinct blocks,
     * and storing every one of them would put the document past what a KV value should
     * carry within a handful of scans. Only the blocks worth learning from are kept, so
     * the caller passes the best ones and this enforces the ceiling.
     */
    recordBlocks(observations: readonly BlockObservation[]): Promise<void>;
    /** Every retained observation, newest first. */
    listBlocks(): Promise<BlockObservation[]>;
    clear(): Promise<void>;
}

function createScannerRepository(doc: Document<ScannerDocument>): ScannerRepository {
    return {
        async recordBlocks(observations) {
            if (!observations.length) return;
            await doc.update(current => ({
                ...current,
                blocks: [...observations, ...(current.blocks ?? [])].slice(0, RETENTION.blockObservations)
            }));
        },

        async listBlocks() {
            const { blocks } = await doc.read();
            return blocks ?? [];
        },

        async recordRun(summary) {
            await doc.update(current => {
                const existing = current.runs[summary.kind] ?? [];
                return {
                    ...current,
                    runs: {
                        ...current.runs,
                        [summary.kind]: [summary, ...existing].slice(0, RETENTION.scanRunsPerKind)
                    },
                    lastRunAt: { ...current.lastRunAt, [summary.kind]: summary.at }
                };
            });
        },

        async listRuns(kind, limit = RETENTION.scanRunsPerKind) {
            const { runs } = await doc.read();
            return (runs[kind] ?? []).slice(0, Math.max(0, limit));
        },

        async lastRunAt(kind) {
            const { lastRunAt } = await doc.read();
            return lastRunAt[kind] ?? null;
        },

        async clear() {
            await doc.update(() => ({ runs: {}, lastRunAt: {}, blocks: [] }));
        }
    };
}

/* ------------------------------------------------------------------ *
 * Aggregate
 * ------------------------------------------------------------------ */

export interface Repositories {
    metrics: MetricsRepository;
    history: HistoryRepository;
    scanner: ScannerRepository;
    profiles: ProfilesRepository;
    /**
     * Writes every dirty document. Returns the number of KV writes performed, so
     * a test can assert the write budget rather than trusting it.
     *
     * Intended caller: the request tail, or `ctx.waitUntil`. A handler that
     * mutates and never flushes loses the mutation, which is why the platform
     * context flushes for its callers.
     */
    flush(): Promise<number>;
    /** True when at least one document has unwritten changes. */
    isDirty(): boolean;
}

interface ProfilesDocument {
    profiles: Profile[];
}

export interface ProfilesRepository {
    /** Every stored profile, validated on read. */
    list(): Promise<Profile[]>;
    /** Replaces the list wholesale. The caller owns the mutation. */
    replace(profiles: readonly Profile[]): Promise<void>;
}

function createProfilesRepository(doc: Document<ProfilesDocument>): ProfilesRepository {
    return {
        async list() {
            const { profiles } = await doc.read();
            // Validated on every read rather than only on write: this document can be
            // hand-edited in the Cloudflare dashboard, and a malformed entry must not
            // become a token that matches nothing or, worse, matches everything.
            return normaliseProfiles(profiles);
        },

        async replace(profiles) {
            await doc.update(() => ({ profiles: normaliseProfiles([...profiles]) }));
        }
    };
}

export function createRepositories(kv: KVNamespace): Repositories {
    const metricsDoc = createDocument<MetricsDocument>(kv, PLATFORM_KV_KEYS.metrics, () => ({ days: [] }));
    const historyDoc = createDocument<HistoryDocument>(kv, PLATFORM_KV_KEYS.history, () => ({ entries: [] }));
    const scannerDoc = createDocument<ScannerDocument>(kv, PLATFORM_KV_KEYS.scanner, () => ({
        runs: {},
        lastRunAt: {}
    }));
    const profilesDoc = createDocument<ProfilesDocument>(kv, PLATFORM_KV_KEYS.profiles, () => ({ profiles: [] }));

    const docs = [metricsDoc, historyDoc, scannerDoc, profilesDoc];

    return {
        metrics: createMetricsRepository(metricsDoc),
        history: createHistoryRepository(historyDoc),
        scanner: createScannerRepository(scannerDoc),
        profiles: createProfilesRepository(profilesDoc),

        async flush() {
            const written = await Promise.all(docs.map(doc => doc.flush()));
            return written.filter(Boolean).length;
        },

        isDirty() {
            return docs.some(doc => doc.isDirty());
        }
    };
}
