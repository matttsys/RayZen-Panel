/**
 * Traffic metrics: request volume and byte counts, bucketed by hour.
 *
 * Same privacy rules as `service.ts`: no network egress, no per-request record, no
 * dimension that could identify a person. The stored unit is a count per UTC hour,
 * which is coarse enough that it cannot be tied to a session but fine enough that
 * the operator can see when their deployment is actually busy.
 *
 * Write budget is the reason this module exists as an accumulator rather than a
 * repository call. Cloudflare's free plan allows about 1,000 KV writes per day; one
 * write per request would exhaust that before lunch. Counts are therefore held in
 * isolate memory and flushed when either threshold below is crossed, so a busy
 * deployment costs at most one write per FLUSH_INTERVAL_MS and one per
 * FLUSH_REQUESTS requests. Losing the tail of an accumulator when an isolate is
 * evicted is accepted: these are trend counters, not billing records.
 */

import { PLATFORM_KV_KEYS, RETENTION } from '@platform/repositories';

/** One UTC hour of traffic. `hour` is `YYYY-MM-DDTHH`. */
export interface HourBucket {
    hour: string;
    requests: number;
    /** Bytes sent to clients, i.e. downloaded by them. */
    bytesDown: number;
    /** Bytes received from clients, i.e. uploaded by them. */
    bytesUp: number;
}

/** The busiest contiguous window in the retained series, by hour of day. */
export interface PeakPeriod {
    /** Inclusive start hour of day, 0-23, UTC. */
    fromHour: number;
    /** Inclusive end hour of day, 0-23, UTC. */
    toHour: number;
    requests: number;
    /** Share of all retained requests that fell in the window, 0-1. */
    share: number;
}

export interface TrafficSnapshot {
    bytesDownloaded: number;
    bytesUploaded: number;
    requests: number;
    /** Ascending by hour, oldest first. */
    hours: HourBucket[];
    /** Requests per hour of day, index 0-23, summed over the retained series. */
    byHourOfDay: number[];
    peakPeriod: PeakPeriod | null;
    /** Requests recorded in this hour's bucket. */
    requestsThisHour: number;
    /** Requests recorded since the start of the newest retained UTC day. */
    requestsToday: number;
    /** Counts still in isolate memory and not yet written to KV. */
    pending: number;
}

/** Width of the peak window, in hours. Three hours reads as "an evening", not "a minute". */
const PEAK_WINDOW_HOURS = 3;

/** Requests accumulated in memory before a flush is forced. */
const FLUSH_REQUESTS = 50;

/** Wall-clock gap before a flush is forced, so a quiet deployment still persists. */
const FLUSH_INTERVAL_MS = 5 * 60 * 1000;

/** `YYYY-MM-DDTHH` in UTC. */
export function utcHour(at: Date = new Date()): string {
    return at.toISOString().slice(0, 13);
}

interface Accumulator {
    hours: Map<string, HourBucket>;
    requests: number;
    lastFlushAt: number;
}

/**
 * Isolate-scoped accumulator.
 *
 * Module scope is deliberate: the isolate outlives a request, which is exactly what
 * makes batching possible. It holds counts only — no request, no header, no address.
 */
const accumulator: Accumulator = { hours: new Map(), requests: 0, lastFlushAt: 0 };

function bucketFor(hour: string): HourBucket {
    const existing = accumulator.hours.get(hour);
    if (existing) return existing;
    const created: HourBucket = { hour, requests: 0, bytesDown: 0, bytesUp: 0 };
    accumulator.hours.set(hour, created);
    return created;
}

/** Adds one request and its byte counts to the current hour's in-memory bucket. */
export function recordTraffic(bytesDown: number, bytesUp: number, at: Date = new Date()): void {
    const bucket = bucketFor(utcHour(at));
    bucket.requests += 1;
    bucket.bytesDown += Math.max(0, Math.trunc(bytesDown) || 0);
    bucket.bytesUp += Math.max(0, Math.trunc(bytesUp) || 0);
    accumulator.requests += 1;
}

/** Adds bytes to a bucket that may no longer be the current hour. */
function addBytes(hour: string, bytesDown: number, bytesUp: number): void {
    const bucket = bucketFor(hour);
    bucket.bytesDown += Math.max(0, Math.trunc(bytesDown) || 0);
    bucket.bytesUp += Math.max(0, Math.trunc(bytesUp) || 0);
}

/**
 * Counts one served request.
 *
 * Response bytes are measured by piping the body through a counting transform
 * rather than trusting `Content-Length`, because most worker responses are streamed
 * and carry no length header — a header-only count would report zero downloaded
 * bytes on exactly the traffic the operator cares about. The transform adds no
 * buffering: chunks are forwarded as they arrive.
 *
 * Two things are deliberately not counted, because they cannot be without lying:
 * WebSocket payloads, which the runtime relays outside this function, and request
 * bodies sent without a `Content-Length`.
 */
export function measureRequest(request: Request, response: Response): Response {
    const at = new Date();
    const bytesUp = Number(request.headers.get('content-length') ?? 0) || 0;

    if (response.status === 101 || !response.body) {
        recordTraffic(Number(response.headers.get('content-length') ?? 0) || 0, bytesUp, at);
        return response;
    }

    const hour = utcHour(at);
    recordTraffic(0, bytesUp, at);

    let counted = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            counted += chunk.byteLength;
            controller.enqueue(chunk);
        },
        flush() {
            addBytes(hour, counted, 0);
        }
    });

    return new Response(response.body.pipeThrough(counter), response);
}

function due(now: number): boolean {
    if (accumulator.requests === 0) return false;
    if (accumulator.requests >= FLUSH_REQUESTS) return true;
    if (accumulator.lastFlushAt === 0) return true;
    return now - accumulator.lastFlushAt >= FLUSH_INTERVAL_MS;
}

interface MetricsDocumentShape {
    hours?: HourBucket[];
    [key: string]: unknown;
}

async function readDocument(kv: KVNamespace): Promise<MetricsDocumentShape> {
    try {
        const stored = await kv.get(PLATFORM_KV_KEYS.metrics, { type: 'json' });
        if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
            return stored as MetricsDocumentShape;
        }
    } catch {
        // A corrupt document must not take the worker down; traffic counters are derived data.
    }
    return {};
}

function mergeHours(stored: readonly HourBucket[], pending: readonly HourBucket[]): HourBucket[] {
    const merged = new Map<string, HourBucket>();
    for (const bucket of [...stored, ...pending]) {
        if (!bucket || typeof bucket.hour !== 'string') continue;
        const existing = merged.get(bucket.hour);
        if (existing) {
            existing.requests += bucket.requests ?? 0;
            existing.bytesDown += bucket.bytesDown ?? 0;
            existing.bytesUp += bucket.bytesUp ?? 0;
        } else {
            merged.set(bucket.hour, {
                hour: bucket.hour,
                requests: bucket.requests ?? 0,
                bytesDown: bucket.bytesDown ?? 0,
                bytesUp: bucket.bytesUp ?? 0
            });
        }
    }
    return [...merged.values()]
        .sort((a, b) => (a.hour < b.hour ? -1 : a.hour > b.hour ? 1 : 0))
        .slice(-RETENTION.trafficHours);
}

/**
 * Writes the accumulator into `rz:metrics` when a threshold has been crossed.
 *
 * Other fields of the document are preserved: the daily counter series in
 * `service.ts` lives in the same value, and clobbering it here would silently
 * delete the operator's history.
 */
export async function flushTraffic(kv: KVNamespace, force = false): Promise<boolean> {
    const now = Date.now();
    if (!force && !due(now)) return false;
    if (accumulator.hours.size === 0) return false;

    const pending = [...accumulator.hours.values()];
    accumulator.hours = new Map();
    accumulator.requests = 0;
    accumulator.lastFlushAt = now;

    try {
        const document = await readDocument(kv);
        const hours = mergeHours(Array.isArray(document.hours) ? document.hours : [], pending);
        await kv.put(PLATFORM_KV_KEYS.metrics, JSON.stringify({ ...document, hours }));
        return true;
    } catch {
        // The counts are gone rather than retried. A retry queue would grow without
        // bound on a deployment whose KV binding is misconfigured, and the thing being
        // protected here is the worker's ability to serve traffic, not the counters.
        return false;
    }
}

/** Requests per hour of day, and the busiest contiguous window in that profile. */
export function peakPeriodOf(hours: readonly HourBucket[]): { byHourOfDay: number[]; peakPeriod: PeakPeriod | null } {
    const byHourOfDay = new Array<number>(24).fill(0);
    let total = 0;

    for (const bucket of hours) {
        const hourOfDay = Number(bucket.hour.slice(11, 13));
        if (!Number.isInteger(hourOfDay) || hourOfDay < 0 || hourOfDay > 23) continue;
        byHourOfDay[hourOfDay] += bucket.requests;
        total += bucket.requests;
    }

    if (total === 0) return { byHourOfDay, peakPeriod: null };

    let bestStart = 0;
    let bestSum = -1;
    for (let start = 0; start < 24; start += 1) {
        let sum = 0;
        for (let offset = 0; offset < PEAK_WINDOW_HOURS; offset += 1) {
            sum += byHourOfDay[(start + offset) % 24];
        }
        if (sum > bestSum) {
            bestSum = sum;
            bestStart = start;
        }
    }

    return {
        byHourOfDay,
        peakPeriod: {
            fromHour: bestStart,
            toHour: (bestStart + PEAK_WINDOW_HOURS - 1) % 24,
            requests: bestSum,
            share: Math.round((bestSum / total) * 1000) / 1000
        }
    };
}

/**
 * The read model the panel and the Companion consume.
 *
 * The in-memory accumulator is folded in so the reader is not shown a number that
 * is up to five minutes stale on a deployment that has just started.
 */
export async function trafficSnapshot(kv: KVNamespace): Promise<TrafficSnapshot> {
    const document = await readDocument(kv);
    const stored = Array.isArray(document.hours) ? document.hours : [];
    const hours = mergeHours(stored, [...accumulator.hours.values()]);

    let bytesDownloaded = 0;
    let bytesUploaded = 0;
    let requests = 0;
    for (const bucket of hours) {
        bytesDownloaded += bucket.bytesDown;
        bytesUploaded += bucket.bytesUp;
        requests += bucket.requests;
    }

    const currentHour = utcHour();
    const today = currentHour.slice(0, 10);
    const { byHourOfDay, peakPeriod } = peakPeriodOf(hours);

    return {
        bytesDownloaded,
        bytesUploaded,
        requests,
        hours,
        byHourOfDay,
        peakPeriod,
        requestsThisHour: hours.find(bucket => bucket.hour === currentHour)?.requests ?? 0,
        requestsToday: hours
            .filter(bucket => bucket.hour.slice(0, 10) === today)
            .reduce((sum, bucket) => sum + bucket.requests, 0),
        pending: accumulator.requests
    };
}

/** Drops the retained hourly series and the accumulator. Used by the panel reset path. */
export async function clearTraffic(kv: KVNamespace): Promise<void> {
    accumulator.hours = new Map();
    accumulator.requests = 0;
    const document = await readDocument(kv);
    await kv.put(PLATFORM_KV_KEYS.metrics, JSON.stringify({ ...document, hours: [] }));
}
