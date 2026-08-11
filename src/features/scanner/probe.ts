/**
 * Probe transport: the only part of the scanner that touches the network.
 *
 * Why A separate module with an injected connector
 *
 * Everything else in the scanner is arithmetic and can be tested directly. This
 * module cannot, because its whole job is a TCP connect. So it is kept as thin as
 * possible and its one effect is injectable: `ProbeDeps.connect` defaults to
 * `cloudflare:sockets` in production and is replaced by a fake in tests. That keeps
 * the socket import in exactly one place and out of every test's dependency graph.
 *
 * What A probe measures, and what it deliberately does not
 *
 * A probe opens a TCP connection and times how long the socket takes to become
 * usable. That is all. It does not send a TLS ClientHello, it does not send an HTTP
 * request, and it does not read a byte back. Three reasons, in order of importance:
 *
 *   1. Writing recognisable bytes to a candidate address turns the deployment into
 *      an active scanner. Traffic from a Cloudflare Worker to hundreds of edge IPs
 *      carrying identical handshakes is a fingerprint, and the fingerprint belongs
 *      to the operator.
 *   2. Connect latency is the number that actually predicts tunnel quality, because
 *      the tunnel's own handshake happens over the same path.
 *   3. A handshake costs several round trips per attempt against a CPU budget
 *      measured in tens of milliseconds.
 *
 * One target is not one sample
 *
 * A single connect tells you almost nothing: edge networks drop the first SYN
 * routinely. Every target is probed `attempts` times so reliability and jitter are
 * measurable at all, which is what the scoring model in `scoring.ts` needs.
 *
 * Budgets are enforced here, not documented here
 *
 * A Worker request has a wall-clock and a subrequest budget. The scanner is the one
 * subsystem in RayZen that could exhaust both, so the limits are constants in this
 * file and are asserted by tests rather than left to the caller's good behaviour.
 */

import type { ProbeAttempt, ProbeResult, ScanTarget } from '#types/platform';
import { runtime } from '@runtime';
import { aggregate } from './scoring';
import { unmeasurableReason } from './cloudflare';

/**
 * A socket the probe can await and close. Structurally the subset of
 * `cloudflare:sockets`' `Socket` that a probe uses, so the fake in tests is three
 * lines rather than a full mock.
 */
export interface ProbeSocket {
    /** Resolves once the connection is established. */
    opened: Promise<unknown>;
    close(): Promise<unknown> | unknown;
}

export type ProbeConnector = (options: { hostname: string; port: number }) => ProbeSocket;

export interface ProbeDeps {
    connect: ProbeConnector;
}

/**
 * Hard limits. These are the scanner's contract with the Worker runtime.
 *
 * `maxTargetsPerRun` x `maxAttempts` bounds one run at 200 outbound TCP connects.
 * Whether that is inside the platform's budget depends on a question Cloudflare's
 * documentation does not answer: the subrequest limit (50 on Free, 10,000 on Paid)
 * is defined in terms of the Fetch API and Cloudflare services such as KV, R2 and
 * D1, while `connect()` appears only in the simultaneous-open-connections list. So
 * a socket connect is neither documented as a subrequest nor documented as exempt.
 *
 * The honest position, rather than a guess in either direction: `concurrency: 4` is
 * inside the documented 6-connection simultaneous cap on both plans, the default
 * path is 3 attempts rather than 5, and a Free-plan operator should keep a run
 * under 50 connects until the behaviour is measured against a deployed Worker.
 */
export const PROBE_LIMITS = {
    /** Per-attempt connect timeout. Beyond this an endpoint is not usable anyway. */
    timeoutMs: 2000,
    /** Attempts per target. Two is too few to see jitter; five costs too much. */
    defaultAttempts: 3,
    maxAttempts: 5,
    /** Targets per run, so one call cannot consume the whole subrequest budget. */
    maxTargetsPerRun: 40,
    /** Concurrent probes. Enough to finish a run inside the CPU budget, low
     *  enough that a burst does not look like a port sweep. */
    concurrency: 4
} as const;

export interface ProbeOptions {
    /** Attempts per target, clamped to `PROBE_LIMITS.maxAttempts`. */
    attempts?: number;
    /** Per-attempt timeout, clamped to `PROBE_LIMITS.timeoutMs`. */
    timeoutMs?: number;
    /** Default port for targets that do not carry one. */
    defaultPort?: number;
}

/** Splits `host:port`, `[v6]:port`, `host` and `[v6]` into parts. */
export function parseTargetAddress(address: string, defaultPort: number): { hostname: string; port: number } {
    const match = address.match(/^(?:\[(?<v6>.+?)\]|(?<host>[^:]+))(?::(?<port>\d+))?$/);
    if (!match?.groups) return { hostname: '', port: defaultPort };

    const { v6, host, port } = match.groups;
    return {
        hostname: v6 ?? host ?? '',
        port: port ? Number(port) : defaultPort
    };
}

/**
 * Races a promise against a timer.
 *
 * The loser is not cancelled, because `cloudflare:sockets` gives no cancellation
 * primitive for a pending connect. The socket is closed in the caller's `finally`,
 * which is the available mechanism, and a straggler resolving later is harmless
 * because its result is already discarded.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('probe timeout')), timeoutMs);

        promise.then(
            value => {
                clearTimeout(timer);
                resolve(value);
            },
            error => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}

/** One connect attempt. Never throws: a failure is data, not an exception. */
async function attemptOnce(
    deps: ProbeDeps,
    hostname: string,
    port: number,
    attempt: number,
    timeoutMs: number
): Promise<ProbeAttempt> {
    const started = runtime.now().getTime();
    let socket: ProbeSocket | null = null;

    try {
        socket = deps.connect({ hostname, port });
        await withTimeout(socket.opened, timeoutMs);
        return { attempt, ok: true, elapsedMs: Math.max(0, runtime.now().getTime() - started) };
    } catch {
        return { attempt, ok: false, elapsedMs: Math.max(0, runtime.now().getTime() - started) };
    } finally {
        // A leaked socket holds a connection open for the isolate's lifetime, and
        // an isolate serves many requests. Closing is not optional.
        try {
            await socket?.close();
        } catch {
            /* already closed or never opened */
        }
    }
}

/** Probes one target `attempts` times and aggregates the result. */
export async function probeTarget(
    deps: ProbeDeps,
    target: ScanTarget,
    options: ProbeOptions = {}
): Promise<ProbeResult> {
    const attempts = Math.min(Math.max(1, options.attempts ?? PROBE_LIMITS.defaultAttempts), PROBE_LIMITS.maxAttempts);
    const timeoutMs = Math.min(Math.max(1, options.timeoutMs ?? PROBE_LIMITS.timeoutMs), PROBE_LIMITS.timeoutMs);
    const { hostname, port } = parseTargetAddress(target.address, options.defaultPort ?? 443);

    const records: ProbeAttempt[] = [];

    // CLASSIFY BEFORE CONNECTING.
    //
    // The Workers runtime blocks outbound TCP to Cloudflare IP ranges, localhost and
    // private networks. Those refusals arrive as a rejected `opened` promise, exactly
    // like a genuinely unreachable endpoint, so probing first and interpreting later
    // is not possible: the two are indistinguishable at that point.
    //
    // Getting this wrong is not a cosmetic bug. The whole purpose of the clean-IP
    // feature is to evaluate Cloudflare edge addresses, so without this check the
    // feature's primary input is reported as `dead` with full confidence, and a user
    // acting on that discards working endpoints.
    //
    // Checking first also costs nothing: a blocked address consumes no connection
    // and no wall-clock time, so a list of 40 Cloudflare IPs no longer spends the
    // entire run's budget learning the same refusal 40 times.
    if (hostname) {
        const blocked = unmeasurableReason(hostname, port);
        if (blocked) {
            return {
                target,
                attempts: [],
                successes: 0,
                total: 0,
                avgLatencyMs: null,
                jitterMs: null,
                at: runtime.now().getTime(),
                blocked
            };
        }
    }

    if (!hostname) {
        // An unparseable address is a failed target, not an error. The panel shows
        // it as dead, which is the truthful outcome for an address nothing can
        // connect to.
        for (let index = 1; index <= attempts; index += 1) {
            records.push({ attempt: index, ok: false, elapsedMs: 0 });
        }
    } else {
        // Sequential per target on purpose: parallel attempts against the same
        // address measure the address's parallel capacity, not its latency, and
        // they cannot see jitter over time at all.
        for (let index = 1; index <= attempts; index += 1) {
            records.push(await attemptOnce(deps, hostname, port, index, timeoutMs));
        }
    }

    return {
        target,
        attempts: records,
        ...aggregate(records),
        at: runtime.now().getTime()
    };
}

/**
 * Probes many targets with bounded concurrency.
 *
 * A worker-pool rather than `Promise.all` over chunks: chunking makes every batch
 * wait for its slowest member, which on a list containing one timing-out address
 * roughly doubles the run's wall-clock time.
 */
export async function probeAll(
    deps: ProbeDeps,
    targets: readonly ScanTarget[],
    options: ProbeOptions & { concurrency?: number } = {}
): Promise<ProbeResult[]> {
    const capped = targets.slice(0, PROBE_LIMITS.maxTargetsPerRun);
    const results: ProbeResult[] = new Array(capped.length);
    const width = Math.min(Math.max(1, options.concurrency ?? PROBE_LIMITS.concurrency), PROBE_LIMITS.concurrency);

    let next = 0;
    const worker = async (): Promise<void> => {
        for (;;) {
            const index = next;
            next += 1;
            if (index >= capped.length) return;
            results[index] = await probeTarget(deps, capped[index], options);
        }
    };

    await Promise.all(Array.from({ length: Math.min(width, capped.length) }, worker));
    return results;
}

/**
 * The production connector.
 *
 * Imported dynamically so that `cloudflare:sockets`, which esbuild marks external
 * and Node cannot resolve, never enters a test's module graph. Every test supplies
 * its own connector and this function is not reached.
 */
export async function createSocketConnector(): Promise<ProbeConnector> {
    const { connect } = await import('cloudflare:sockets');
    return ({ hostname, port }) => connect({ hostname, port }) as unknown as ProbeSocket;
}
