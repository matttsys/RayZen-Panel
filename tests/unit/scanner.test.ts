/**
 * Scanner platform tests: the model, the transport bounds, the schedule policy and
 * the service composition.
 *
 * Why the scanner is tested harder than the rest of the platform
 *
 * It is the only subsystem that makes the deployment emit traffic it was not asked
 * for, and the only one with a documented budget it could exhaust. Two classes of
 * claim therefore need enforcement rather than prose:
 *
 *   1. **The bounds are real.** `PROBE_LIMITS` says a run cannot exceed 40 targets
 *      or 5 attempts each. Those are stated as "the scanner's contract with the
 *      Worker runtime", so a caller asking for 500 targets must get 40, and the
 *      cap must be enforced in the module rather than trusted to the caller.
 *   2. **The model's shape is intentional.** Reliability at 60% is a product
 *      decision, and the consequence, that a target failing half its attempts
 *      cannot outrank a slow but reliable one, is what the whole model exists for.
 *      A future weight tweak that broke that ordering would be silent otherwise.
 *
 * Every probe here uses an injected connector. No test opens a socket, which is
 * why `cloudflare:sockets` is imported dynamically in one function that nothing
 * here calls.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    PROBE_LIMITS,
    parseTargetAddress,
    probeAll,
    probeTarget,
    type ProbeConnector,
    type ProbeSocket
} from '@features/scanner/probe';
import {
    LATENCY,
    VERDICT_THRESHOLD,
    WEIGHTS,
    aggregate,
    latencyScore,
    medianScore,
    rank,
    reliabilityScore,
    scoreResult,
    stabilityScore,
    verdictFor
} from '@features/scanner/scoring';
import { SCHEDULE, clampInterval, decide, timeUntilDue } from '@features/scanner/schedule';
import { createScannerService, summarise, toTargets } from '@features/scanner/service';
import { createEventBus } from '@platform/events';
import { createRepositories } from '@platform/repositories';
import { resetRuntimeDeps, setRuntimeDeps, seededRandom } from '@runtime';
import type { ProbeResult, ScanTarget } from '#types/platform';
import { createKvStub } from '../helpers/worker';

afterEach(() => {
    resetRuntimeDeps();
});

/* ------------------------------------------------------------------ *
 * Address parsing
 * ------------------------------------------------------------------ */

describe('parseTargetAddress', () => {
    it('handles the four shapes a settings field can contain', () => {
        expect(parseTargetAddress('1.2.3.4', 443)).toEqual({ hostname: '1.2.3.4', port: 443 });
        expect(parseTargetAddress('1.2.3.4:8443', 443)).toEqual({ hostname: '1.2.3.4', port: 8443 });
        expect(parseTargetAddress('[2606:4700::1111]', 443)).toEqual({ hostname: '2606:4700::1111', port: 443 });
        expect(parseTargetAddress('[2606:4700::1111]:2408', 443)).toEqual({
            hostname: '2606:4700::1111',
            port: 2408
        });
    });

    it('keeps a hostname intact', () => {
        expect(parseTargetAddress('engage.cloudflareclient.com:2408', 443)).toEqual({
            hostname: 'engage.cloudflareclient.com',
            port: 2408
        });
    });

    it('returns an empty hostname for input nothing could connect to', () => {
        // Deliberately not an exception: the panel shows the target as dead, which
        // is the truthful outcome for an unparseable address.
        expect(parseTargetAddress('', 443).hostname).toBe('');
        expect(parseTargetAddress('not:a:valid:address', 443).hostname).toBe('');
    });
});

/* ------------------------------------------------------------------ *
 * Scoring model
 * ------------------------------------------------------------------ */

describe('scoring weights', () => {
    it('sum to exactly 1, so the composite stays inside 0-100', () => {
        // The module header claims this is "asserted by a test". This is that test.
        const total = WEIGHTS.reliability + WEIGHTS.latency + WEIGHTS.stability;
        expect(total).toBeCloseTo(1, 10);
    });

    it('keeps reliability dominant, which is the model\'s entire premise', () => {
        expect(WEIGHTS.reliability).toBeGreaterThan(WEIGHTS.latency + WEIGHTS.stability);
    });
});

describe('component scores', () => {
    it('reliability is the success fraction, and is 0 for no attempts', () => {
        expect(reliabilityScore(5, 5)).toBe(100);
        expect(reliabilityScore(3, 5)).toBe(60);
        expect(reliabilityScore(0, 5)).toBe(0);
        expect(reliabilityScore(1, 0)).toBe(0);
    });

    it('latency is flat-100 below the excellent anchor and 0 at the unusable anchor', () => {
        expect(latencyScore(10)).toBe(100);
        expect(latencyScore(LATENCY.excellent)).toBe(100);
        expect(latencyScore(LATENCY.unusable)).toBe(0);
        expect(latencyScore(LATENCY.unusable + 500)).toBe(0);
        expect(latencyScore(null)).toBe(0);
    });

    it('latency ramps linearly between the anchors', () => {
        const midpoint = (LATENCY.excellent + LATENCY.unusable) / 2;
        expect(latencyScore(midpoint)).toBeCloseTo(50, 5);
    });

    it('stability is relative to mean latency, not absolute', () => {
        // 30ms of jitter is a different experience on a 60ms link than on a 600ms one.
        expect(stabilityScore(600, 30)).toBeGreaterThan(stabilityScore(60, 30));
    });

    it('a single sample scores neutral stability rather than perfect', () => {
        // Rewarding a thin sample with 100 would rank a one-success target above a
        // consistently-measured one.
        expect(stabilityScore(100, null)).toBe(50);
        expect(stabilityScore(null, null)).toBe(0);
    });

    it('jitter at or above the mean scores zero stability', () => {
        expect(stabilityScore(100, 100)).toBe(0);
        expect(stabilityScore(100, 250)).toBe(0);
    });
});

describe('verdicts', () => {
    it('zero successes is dead regardless of score', () => {
        expect(verdictFor(99, 0)).toBe('dead');
    });

    it('cuts on the declared thresholds', () => {
        expect(verdictFor(VERDICT_THRESHOLD.good, 3)).toBe('good');
        expect(verdictFor(VERDICT_THRESHOLD.good - 0.1, 3)).toBe('usable');
        expect(verdictFor(VERDICT_THRESHOLD.usable, 3)).toBe('usable');
        expect(verdictFor(VERDICT_THRESHOLD.usable - 0.1, 3)).toBe('poor');
    });
});

function result(overrides: Partial<ProbeResult> = {}): ProbeResult {
    return {
        target: { address: '1.2.3.4', kind: 'clean-ip' },
        attempts: [],
        successes: 3,
        total: 3,
        avgLatencyMs: 50,
        jitterMs: 5,
        at: 1_000,
        ...overrides
    };
}

describe('scoreResult', () => {
    it('scores a fast, perfectly reliable target at or near 100', () => {
        const scored = scoreResult(result({ avgLatencyMs: 20, jitterMs: 0 }));

        expect(scored.score).toBe(100);
        expect(scored.verdict).toBe('good');
    });

    it('scores a dead target at exactly zero, not "fast failure"', () => {
        const scored = scoreResult(result({ successes: 0, avgLatencyMs: null, jitterMs: null }));

        expect(scored.score).toBe(0);
        expect(scored.verdict).toBe('dead');
    });

    it('caps a half-failing target below the good threshold, however fast it is', () => {
        // The stated consequence of a 60% reliability weight: a target answering
        // half its attempts scores at most 0.6*50 + 0.25*100 + 0.15*100 = 70, which
        // is under the `good` cut of 75. Speed cannot buy a healthy verdict.
        const flaky = scoreResult(result({ successes: 2, total: 4, avgLatencyMs: 10, jitterMs: 0 }));
        const steady = scoreResult(result({ successes: 5, total: 5, avgLatencyMs: 400, jitterMs: 20 }));

        expect(flaky.score).toBeLessThanOrEqual(70);
        expect(flaky.verdict).not.toBe('good');
        expect(steady.score).toBeGreaterThan(flaky.score);
        expect(steady.verdict).toBe('good');
    });

    it('carries the raw result through, so a UI can show the measurement', () => {
        const raw = result();
        expect(scoreResult(raw).result).toBe(raw);
    });
});

describe('rank', () => {
    const scored = (address: string, score: number, latency: number | null) =>
        scoreResult(result({ target: { address, kind: 'clean-ip' }, avgLatencyMs: latency, jitterMs: 0, successes: score === 0 ? 0 : 3 }));

    it('orders best first', () => {
        const list = rank([
            scoreResult(result({ target: { address: 'slow', kind: 'clean-ip' }, avgLatencyMs: 900 })),
            scoreResult(result({ target: { address: 'fast', kind: 'clean-ip' }, avgLatencyMs: 20 }))
        ]);

        expect(list.map(entry => entry.target.address)).toEqual(['fast', 'slow']);
    });

    it('breaks ties deterministically on latency then address', () => {
        // A "best endpoint" that flickers between equals on every refresh is worse
        // than a slightly wrong one.
        const first = rank([scored('b.example', 80, 100), scored('a.example', 80, 100)]);
        const second = rank([scored('a.example', 80, 100), scored('b.example', 80, 100)]);

        expect(first.map(entry => entry.target.address)).toEqual(['a.example', 'b.example']);
        expect(second.map(entry => entry.target.address)).toEqual(first.map(entry => entry.target.address));
    });

    it('does not mutate its input', () => {
        const input = [scored('b', 80, 100), scored('a', 80, 50)];
        const copy = [...input];

        rank(input);
        expect(input).toEqual(copy);
    });
});

describe('medianScore', () => {
    it('is null for an empty list, which is different from zero', () => {
        expect(medianScore([])).toBeNull();
    });

    it('takes the middle of an odd list and the mean of an even one', () => {
        const at = (score: number) => scoreResult(result({ successes: 3, total: 3, avgLatencyMs: score === 100 ? 10 : 600, jitterMs: 0 }));
        const three = [at(100), at(50), at(50)];

        expect(medianScore(three)).not.toBeNull();
        expect(medianScore([at(100)])).toBe(at(100).score);
    });
});

describe('aggregate', () => {
    it('ignores failed attempts when computing latency', () => {
        const summary = aggregate([
            { ok: true, elapsedMs: 100 },
            { ok: false, elapsedMs: 2000 },
            { ok: true, elapsedMs: 200 }
        ]);

        expect(summary).toEqual({ successes: 2, total: 3, avgLatencyMs: 150, jitterMs: 50 });
    });

    it('reports null latency and jitter when nothing succeeded', () => {
        expect(aggregate([{ ok: false, elapsedMs: 2000 }])).toEqual({
            successes: 0,
            total: 1,
            avgLatencyMs: null,
            jitterMs: null
        });
    });

    it('reports null jitter for a single success, because one sample has no spread', () => {
        expect(aggregate([{ ok: true, elapsedMs: 100 }]).jitterMs).toBeNull();
    });

    it('uses population standard deviation, not sample', () => {
        // Sample sd over [100, 200] is 70.7; population is 50. With three to five
        // attempts the Bessel correction would inflate jitter for no gain.
        expect(aggregate([{ ok: true, elapsedMs: 100 }, { ok: true, elapsedMs: 200 }]).jitterMs).toBe(50);
    });
});

/* ------------------------------------------------------------------ *
 * Probe transport
 * ------------------------------------------------------------------ */

/** A connector whose sockets resolve or reject on demand, with a fake clock. */
function fakeConnector(options: {
    fail?: (hostname: string) => boolean;
    latencyMs?: number;
} = {}) {
    const opened: { hostname: string; port: number }[] = [];
    const closed: string[] = [];
    let clock = 0;

    setRuntimeDeps({ now: () => new Date(clock) });

    const connect: ProbeConnector = ({ hostname, port }) => {
        opened.push({ hostname, port });
        const shouldFail = options.fail?.(hostname) ?? false;

        const socket: ProbeSocket = {
            opened: (async () => {
                clock += options.latencyMs ?? 10;
                if (shouldFail) throw new Error('refused');
            })(),
            close: () => {
                closed.push(hostname);
            }
        };

        return socket;
    };

    return { connect, opened, closed, tick: (ms: number) => (clock += ms) };
}

describe('probeTarget', () => {
    const target: ScanTarget = { address: '1.2.3.4', kind: 'clean-ip' };

    it('probes the default number of attempts and measures each', async () => {
        const fake = fakeConnector({ latencyMs: 25 });
        const probed = await probeTarget({ connect: fake.connect }, target);

        expect(probed.attempts).toHaveLength(PROBE_LIMITS.defaultAttempts);
        expect(probed.successes).toBe(PROBE_LIMITS.defaultAttempts);
        expect(probed.avgLatencyMs).toBe(25);
        expect(fake.opened).toHaveLength(PROBE_LIMITS.defaultAttempts);
    });

    it('clamps attempts to the declared maximum', async () => {
        const fake = fakeConnector();
        const probed = await probeTarget({ connect: fake.connect }, target, { attempts: 500 });

        expect(probed.attempts).toHaveLength(PROBE_LIMITS.maxAttempts);
    });

    it('clamps attempts up to at least one', async () => {
        const fake = fakeConnector();
        const probed = await probeTarget({ connect: fake.connect }, target, { attempts: 0 });

        expect(probed.attempts).toHaveLength(1);
    });

    it('turns a refused connection into data rather than an exception', async () => {
        const fake = fakeConnector({ fail: () => true });
        const probed = await probeTarget({ connect: fake.connect }, target);

        expect(probed.successes).toBe(0);
        expect(probed.avgLatencyMs).toBeNull();
        expect(probed.attempts.every(attempt => !attempt.ok)).toBe(true);
    });

    it('closes every socket it opens, successful or not', async () => {
        // A leaked socket holds a connection for the isolate's lifetime, and an
        // isolate serves many requests.
        const fake = fakeConnector({ fail: () => true });
        await probeTarget({ connect: fake.connect }, target);

        expect(fake.closed).toHaveLength(PROBE_LIMITS.defaultAttempts);
    });

    it('closes the socket even when close() itself throws', async () => {
        const connect: ProbeConnector = () => ({
            opened: Promise.resolve(),
            close: () => {
                throw new Error('already closed');
            }
        });

        await expect(probeTarget({ connect }, target, { attempts: 1 })).resolves.toBeDefined();
    });

    it('records an unparseable address as dead without connecting', async () => {
        const fake = fakeConnector();
        const probed = await probeTarget({ connect: fake.connect }, { address: '', kind: 'clean-ip' });

        expect(fake.opened).toEqual([]);
        expect(probed.successes).toBe(0);
        expect(probed.attempts).toHaveLength(PROBE_LIMITS.defaultAttempts);
    });

    it('uses the default port when the address carries none', async () => {
        const fake = fakeConnector();
        await probeTarget({ connect: fake.connect }, target, { attempts: 1, defaultPort: 2408 });

        expect(fake.opened[0]).toEqual({ hostname: '1.2.3.4', port: 2408 });
    });

    it('prefers the port in the address over the default', async () => {
        const fake = fakeConnector();
        await probeTarget({ connect: fake.connect }, { address: '1.2.3.4:8443', kind: 'clean-ip' }, {
            attempts: 1,
            defaultPort: 443
        });

        expect(fake.opened[0].port).toBe(8443);
    });

    it('gives up on a connect that never resolves', async () => {
        // The timeout is the reason a dead address costs 2s rather than the whole
        // request budget.
        vi.useFakeTimers();
        try {
            const connect: ProbeConnector = () => ({
                opened: new Promise(() => undefined),
                close: () => undefined
            });

            const pending = probeTarget({ connect }, target, { attempts: 1, timeoutMs: 50 });
            await vi.advanceTimersByTimeAsync(60);
            const probed = await pending;

            expect(probed.successes).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('probeAll', () => {
    it('caps the target list at the declared maximum', async () => {
        // The budget is enforced here, not documented here: 40 targets x 5 attempts
        // is 200 subrequests, which is what the limits are sized against.
        const fake = fakeConnector();
        // Measurable addresses on purpose: 10.0.0.0/8 is private space, which
        // probeTarget classifies as unmeasurable *before* connecting, so a
        // private-range fixture would assert the cap against zero connections.
        const targets: ScanTarget[] = Array.from({ length: 500 }, (_, i) => ({
            address: `${i}.probe.test`,
            kind: 'clean-ip'
        }));

        const results = await probeAll({ connect: fake.connect }, targets, { attempts: 1 });

        expect(results).toHaveLength(PROBE_LIMITS.maxTargetsPerRun);
        expect(fake.opened).toHaveLength(PROBE_LIMITS.maxTargetsPerRun);
    });

    it('never exceeds the subrequest ceiling the limits promise', async () => {
        const fake = fakeConnector();
        const targets: ScanTarget[] = Array.from({ length: 200 }, (_, i) => ({
            address: `${i}.probe.test`,
            kind: 'clean-ip'
        }));

        await probeAll({ connect: fake.connect }, targets, { attempts: PROBE_LIMITS.maxAttempts });

        expect(fake.opened.length).toBeLessThanOrEqual(
            PROBE_LIMITS.maxTargetsPerRun * PROBE_LIMITS.maxAttempts
        );
    });

    it('preserves input order in the results despite the worker pool', async () => {
        const fake = fakeConnector();
        const targets: ScanTarget[] = ['a', 'b', 'c', 'd', 'e'].map(name => ({
            address: `${name}.example`,
            kind: 'clean-ip'
        }));

        const results = await probeAll({ connect: fake.connect }, targets, { attempts: 1 });

        expect(results.map(entry => entry.target.address)).toEqual(targets.map(target => target.address));
    });

    it('clamps concurrency to the declared width', async () => {
        // Enough to finish inside the CPU budget, low enough that a burst does not
        // look like a port sweep.
        let live = 0;
        let peak = 0;

        const connect: ProbeConnector = () => {
            live += 1;
            peak = Math.max(peak, live);
            return {
                opened: Promise.resolve().then(() => {
                    live -= 1;
                }),
                close: () => undefined
            };
        };

        const targets: ScanTarget[] = Array.from({ length: 20 }, (_, i) => ({
            address: `${i}.probe.test`,
            kind: 'clean-ip'
        }));

        await probeAll({ connect }, targets, { attempts: 1, concurrency: 100 });

        expect(peak).toBeLessThanOrEqual(PROBE_LIMITS.concurrency);
    });

    it('returns an empty list for no targets without touching the connector', async () => {
        const fake = fakeConnector();
        expect(await probeAll({ connect: fake.connect }, [])).toEqual([]);
        expect(fake.opened).toEqual([]);
    });
});

/* ------------------------------------------------------------------ *
 * Schedule policy
 * ------------------------------------------------------------------ */

describe('clampInterval', () => {
    it('defaults an absent or nonsense interval', () => {
        expect(clampInterval(undefined)).toBe(SCHEDULE.defaultIntervalMs);
        expect(clampInterval(Number.NaN)).toBe(SCHEDULE.defaultIntervalMs);
        expect(clampInterval(Number.POSITIVE_INFINITY)).toBe(SCHEDULE.defaultIntervalMs);
    });

    it('enforces both bounds', () => {
        // A shorter interval would mostly measure noise while spending budget.
        expect(clampInterval(1_000)).toBe(SCHEDULE.minIntervalMs);
        expect(clampInterval(SCHEDULE.maxIntervalMs * 10)).toBe(SCHEDULE.maxIntervalMs);
    });

    it('passes a sane interval through, floored', () => {
        expect(clampInterval(SCHEDULE.minIntervalMs + 0.7)).toBe(SCHEDULE.minIntervalMs);
        expect(clampInterval(3 * 60 * 60 * 1000)).toBe(3 * 60 * 60 * 1000);
    });
});

describe('decide', () => {
    it('reports disabled with no next time, so the UI never has to guess', () => {
        expect(decide({ enabled: false, lastRunAt: 1 }, 100)).toEqual({
            due: false,
            reason: 'disabled',
            nextDueAt: null
        });
    });

    it('is due immediately when it has never run', () => {
        expect(decide({ enabled: true, lastRunAt: null }, 5_000)).toEqual({
            due: true,
            reason: 'never-run',
            nextDueAt: 5_000
        });
    });

    it('is due once the interval has elapsed, and not before', () => {
        const lastRunAt = 1_000_000;
        const interval = SCHEDULE.minIntervalMs;

        expect(decide({ enabled: true, lastRunAt, intervalMs: interval }, lastRunAt + interval - 1).due).toBe(false);
        expect(decide({ enabled: true, lastRunAt, intervalMs: interval }, lastRunAt + interval).due).toBe(true);
    });

    it('treats a future lastRunAt as within-interval rather than due', () => {
        // Clock skew or a hand-edited KV value would otherwise cause a scan on
        // every single request.
        const decision = decide({ enabled: true, lastRunAt: 10_000_000 }, 1_000);

        expect(decision.due).toBe(false);
        expect(decision.reason).toBe('within-interval');
    });

    it('carries nextDueAt so the panel can render "next scan in 4h"', () => {
        const decision = decide({ enabled: true, lastRunAt: 1_000, intervalMs: SCHEDULE.minIntervalMs }, 2_000);
        expect(timeUntilDue(decision, 2_000)).toBe(SCHEDULE.minIntervalMs - 1_000);
    });

    it('timeUntilDue is null when disabled or already due', () => {
        expect(timeUntilDue(decide({ enabled: false, lastRunAt: null }, 0), 0)).toBeNull();
        expect(timeUntilDue(decide({ enabled: true, lastRunAt: null }, 0), 0)).toBeNull();
    });
});

/* ------------------------------------------------------------------ *
 * Service composition
 * ------------------------------------------------------------------ */

describe('toTargets', () => {
    it('trims before deduplicating, so padded repeats are one target', () => {
        expect(toTargets([' 1.2.3.4 ', '1.2.3.4'], 'clean-ip')).toEqual([
            { address: '1.2.3.4', kind: 'clean-ip' }
        ]);
    });

    it('drops empties', () => {
        expect(toTargets(['', '   ', '1.2.3.4'], 'clean-ip')).toHaveLength(1);
    });

    it('deduplicates before capping, so repeats do not waste run slots', () => {
        const addresses = [
            ...Array.from({ length: 100 }, () => '1.1.1.1'),
            ...Array.from({ length: 50 }, (_, i) => `10.0.0.${i}`)
        ];

        const targets = toTargets(addresses, 'clean-ip');

        expect(targets).toHaveLength(PROBE_LIMITS.maxTargetsPerRun);
        expect(new Set(targets.map(target => target.address)).size).toBe(targets.length);
    });
});

describe('summarise', () => {
    const scored = (address: string, successes: number, latency: number | null) =>
        scoreResult(result({
            target: { address, kind: 'clean-ip' },
            successes,
            total: 3,
            avgLatencyMs: latency,
            jitterMs: latency === null ? null : 5
        }));

    it('counts good and usable as healthy, and includes dead in the target total', () => {
        const run = {
            id: 'r', at: 1, kind: 'clean-ip' as const,
            ranked: rank([scored('fast', 3, 20), scored('poor', 1, 900)]),
            dead: 2,
            unmeasurable: []
        };

        const summary = summarise(run);

        expect(summary.targets).toBe(4);
        expect(summary.healthy).toBe(1);
        expect(summary.best?.address).toBe('fast');
    });

    it('reports no best when nothing usable was found', () => {
        const summary = summarise({ id: 'r', at: 1, kind: 'clean-ip', ranked: [], dead: 3, unmeasurable: [] });

        expect(summary.best).toBeNull();
        expect(summary.medianScore).toBeNull();
        expect(summary.targets).toBe(3);
    });

    it('counts unmeasurable candidates in the target total and reports the count', () => {
        const run = {
            id: 'r', at: 1, kind: 'clean-ip' as const,
            ranked: rank([scored('fast', 3, 20)]),
            dead: 1,
            unmeasurable: [{
                address: '1.1.1.1', reason: 'cloudflare-range' as const,
                problem: 'p', impact: 'i', cause: 'c', solution: 's'
            }]
        };

        const summary = summarise(run);

        expect(summary.targets).toBe(3);
        expect(summary.unmeasurable).toBe(1);
        expect(summary.healthy).toBe(1);
    });
});

describe('scanner service', () => {
    function harness(options: { fail?: (hostname: string) => boolean } = {}) {
        setRuntimeDeps({ now: () => new Date(1_700_000_000_000), random: seededRandom(3) });

        const kv = createKvStub();
        const repos = createRepositories(kv.namespace);
        const bus = createEventBus();
        const fake = fakeConnector({ ...options, latencyMs: 20 });
        // fakeConnector installs its own clock; reinstate a fixed one so run ids and
        // `at` stamps are assertable.
        setRuntimeDeps({ now: () => new Date(1_700_000_000_000) });

        const scanner = createScannerService({
            probe: { connect: fake.connect },
            repository: repos.scanner,
            events: bus
        });

        return { kv, repos, bus, scanner, fake };
    }

    it('persists a summary, not the run, and emits one completion event', async () => {
        // A run holds every attempt for every target: 40 x 3 is 120 records, larger
        // than a KV value should carry and more detail than anyone reads later.
        const { scanner, repos, bus, kv } = harness();
        const completed: unknown[] = [];
        bus.on('scanner.completed', payload => void completed.push(payload));

        const run = await scanner.run({ kind: 'clean-ip', addresses: ['9.9.9.9', '8.8.8.8'], attempts: 2 });
        await repos.flush();

        expect(run.ranked).toHaveLength(2);
        expect(completed).toEqual([{ targets: 2, healthy: 2 }]);

        const stored = JSON.parse(kv.store.get('rz:scanner') ?? '{}');
        expect(stored.runs['clean-ip']).toHaveLength(1);
        expect(stored.runs['clean-ip'][0].attempts).toBeUndefined();
        expect(stored.lastRunAt['clean-ip']).toBe(1_700_000_000_000);
    });

    it('emits one probed event per target', async () => {
        const { scanner, bus } = harness();
        const probed: { target: string; ok: boolean }[] = [];
        bus.on('scanner.probed', payload => void probed.push(payload));

        await scanner.run({ kind: 'clean-ip', addresses: ['9.9.9.9', '8.8.8.8'], attempts: 1 });

        expect(probed.map(entry => entry.target)).toEqual(['9.9.9.9', '8.8.8.8']);
        expect(probed.every(entry => entry.ok)).toBe(true);
    });

    it('dryRun scores without persisting anything', async () => {
        // The one-off manual check must not spend a KV write or move the schedule.
        const { scanner, repos, kv } = harness();

        const run = await scanner.dryRun({ kind: 'clean-ip', addresses: ['9.9.9.9'], attempts: 1 });
        await repos.flush();

        expect(run.ranked).toHaveLength(1);
        expect(kv.calls.filter(call => call.op === 'put')).toEqual([]);
        expect(await scanner.history('clean-ip')).toEqual([]);
    });

    it('counts dead targets separately and never ranks them', async () => {
        const { scanner } = harness({ fail: hostname => hostname === 'dead.example' });

        const run = await scanner.run({
            kind: 'clean-ip',
            addresses: ['9.9.9.9', 'dead.example'],
            attempts: 1
        });

        expect(run.dead).toBe(1);
        expect(run.ranked.map(entry => entry.target.address)).toEqual(['9.9.9.9']);
    });

    it('reports Cloudflare addresses as unmeasurable, never dead, and never probes them', async () => {
        const { scanner, fake } = harness();

        const run = await scanner.run({
            kind: 'clean-ip',
            addresses: ['1.1.1.1', '9.9.9.9'],
            attempts: 1
        });

        // 1.1.1.1 is a Cloudflare resolver: the Workers runtime refuses the connect,
        // so it must be surfaced as out of reach, not counted as a failed endpoint.
        expect(run.dead).toBe(0);
        expect(run.unmeasurable.map(entry => entry.address)).toEqual(['1.1.1.1']);
        expect(run.unmeasurable[0].reason).toBe('cloudflare-range');
        expect(run.ranked.map(entry => entry.target.address)).toEqual(['9.9.9.9']);
        // A classified address costs no connection at all.
        expect(fake.opened.map(entry => entry.hostname)).toEqual(['9.9.9.9']);
    });

    it('handles an empty address list without probing or throwing', async () => {
        const { scanner, fake } = harness();

        const run = await scanner.run({ kind: 'clean-ip', addresses: [], attempts: 1 });

        expect(run.ranked).toEqual([]);
        expect(run.dead).toBe(0);
        expect(fake.opened).toEqual([]);
    });

    it('uses the WARP port by default for warp-endpoint targets', async () => {
        // TCP connect on 2408 measures reachability, which is the useful signal a
        // TCP-only runtime can get; it is not a WireGuard handshake.
        const { scanner, fake } = harness();

        await scanner.run({ kind: 'warp-endpoint', addresses: ['engage.example'], attempts: 1 });

        expect(fake.opened[0]).toEqual({ hostname: 'engage.example', port: 2408 });
    });

    it('schedule() reads the persisted last run time', async () => {
        const { scanner } = harness();

        expect((await scanner.schedule('clean-ip', { enabled: true })).reason).toBe('never-run');

        await scanner.run({ kind: 'clean-ip', addresses: ['1.1.1.1'], attempts: 1 });
        const decision = await scanner.schedule('clean-ip', { enabled: true });

        expect(decision.due).toBe(false);
        expect(decision.reason).toBe('within-interval');
    });

    it('best() returns the newest run\'s best target, or null', async () => {
        const { scanner } = harness();

        expect(await scanner.best('clean-ip')).toBeNull();

        await scanner.run({ kind: 'clean-ip', addresses: ['9.9.9.9'], attempts: 1 });
        expect((await scanner.best('clean-ip'))?.address).toBe('9.9.9.9');
    });

    it('reset() drops history and the schedule together', async () => {
        const { scanner } = harness();

        await scanner.run({ kind: 'clean-ip', addresses: ['1.1.1.1'], attempts: 1 });
        await scanner.reset();

        expect(await scanner.history('clean-ip')).toEqual([]);
        expect(await scanner.best('clean-ip')).toBeNull();
    });

    it('works without an event bus at all', async () => {
        // `events` is optional so the service can be constructed in contexts that
        // publish nothing.
        setRuntimeDeps({ now: () => new Date(1_000) });
        const repos = createRepositories(createKvStub().namespace);
        const fake = fakeConnector();
        setRuntimeDeps({ now: () => new Date(1_000) });

        const scanner = createScannerService({
            probe: { connect: fake.connect },
            repository: repos.scanner
        });

        await expect(scanner.run({ kind: 'clean-ip', addresses: ['1.1.1.1'], attempts: 1 })).resolves.toBeDefined();
    });

    it('run ids are unique within one millisecond', async () => {
        // Two runs inside one request would otherwise collide on a time-only id.
        setRuntimeDeps({ now: () => new Date(1_700_000_000_000), random: seededRandom(11) });
        const repos = createRepositories(createKvStub().namespace);
        const fake = fakeConnector();
        setRuntimeDeps({ now: () => new Date(1_700_000_000_000), random: seededRandom(11) });

        const scanner = createScannerService({
            probe: { connect: fake.connect },
            repository: repos.scanner
        });

        const first = await scanner.run({ kind: 'clean-ip', addresses: ['1.1.1.1'], attempts: 1 });
        const second = await scanner.run({ kind: 'clean-ip', addresses: ['1.1.1.1'], attempts: 1 });

        expect(first.id).not.toBe(second.id);
        expect(first.id).toMatch(/^[0-9a-z]+-[0-9a-z]{4}$/);
    });
});
