/**
 * Proves the determinism seam in `src/common/runtime.ts` works.
 *
 * This is the prerequisite for golden-file testing: while config generation reads
 * `Math.random()` and the network directly, the same input produces different
 * bytes on every call and no fixture can exist.
 *
 * Two properties matter here.
 *
 *  1. **Production behaviour is unchanged.** With no overrides installed, the
 *     random helpers must still be random and `resolveDNS` must still take the
 *     DoH path. If a default were accidentally replaced with a stub, production
 *     would silently start emitting identical SNI casing and WebSocket paths
 *     across every deployment, which is an anti-fingerprinting regression.
 *  2. **A seeded run is reproducible.** Same seed, same bytes, every time.
 *
 * Note on verification method: a byte-level diff of `dist/worker.js` before and
 * after this seam is NOT a useful check, because adding a module changes
 * esbuild's identifier assignment and the minifier renames variables across the
 * whole bundle. The behavioural assertions below are the real verification.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetRuntimeDeps, runtime, seededRandom, setRuntimeDeps } from '@runtime';
import { generateWsPath, getRandomString, randomUpperCase, resolveDNS } from '@utils';

afterEach(() => {
    resetRuntimeDeps();
    vi.unstubAllGlobals();
});

describe('production defaults', () => {
    it('random() delegates to Math.random', () => {
        const spy = vi.spyOn(Math, 'random').mockReturnValue(0.42);
        expect(runtime.random()).toBe(0.42);
        expect(spy).toHaveBeenCalled();
    });

    it('now() returns the current time', () => {
        const before = Date.now();
        const value = runtime.now().getTime();
        expect(value).toBeGreaterThanOrEqual(before);
        expect(value).toBeLessThanOrEqual(Date.now());
    });

    it('resolveDNS has no override installed, so the DoH path is used', () => {
        expect(runtime.resolveDNS()).toBeNull();
    });

    it('SNI casing is still randomised in production', () => {
        // The anti-fingerprinting property this protects: 40 samples of a
        // 20-character domain must not all be identical.
        const samples = new Set(Array.from({ length: 40 }, () => randomUpperCase('rayzen-test.workers.dev')));
        expect(samples.size).toBeGreaterThan(1);
    });

    it('WebSocket paths are still random in production', () => {
        const samples = new Set(Array.from({ length: 40 }, () => generateWsPath('vless')));
        expect(samples.size).toBeGreaterThan(1);
    });
});

describe('seeded overrides', () => {
    it('randomUpperCase is reproducible for a given seed', () => {
        const run = () => {
            setRuntimeDeps({ random: seededRandom(1) });
            return randomUpperCase('rayzen-test.workers.dev');
        };

        const first = run();
        const second = run();
        expect(second).toBe(first);
    });

    it('different seeds produce different casing', () => {
        setRuntimeDeps({ random: seededRandom(1) });
        const one = randomUpperCase('rayzen-test.workers.dev');
        setRuntimeDeps({ random: seededRandom(2) });
        const two = randomUpperCase('rayzen-test.workers.dev');

        expect(two).not.toBe(one);
    });

    it('getRandomString respects the requested length bounds', () => {
        setRuntimeDeps({ random: seededRandom(7) });
        for (let i = 0; i < 50; i++) {
            const value = getRandomString(16, 32);
            expect(value.length).toBeGreaterThanOrEqual(16);
            expect(value.length).toBeLessThanOrEqual(32);
            expect(value).toMatch(/^[A-Za-z0-9]+$/);
        }
    });

    it('generateWsPath keeps the protocol prefix contract', () => {
        setRuntimeDeps({ random: seededRandom(3) });
        // The server routes on path segment 1 only, so the prefix is the part
        // that matters; the random suffix is decorative.
        expect(generateWsPath(_VL_)).toMatch(/^\/vl\/[A-Za-z0-9]{16,32}$/);
        expect(generateWsPath(_TR_)).toMatch(/^\/tr\/[A-Za-z0-9]{16,32}$/);
    });

    it('now() can be pinned', () => {
        const fixed = new Date('2020-01-02T03:04:05.000Z');
        setRuntimeDeps({ now: () => fixed });
        expect(runtime.now()).toBe(fixed);
    });

    it('resolveDNS uses the override and makes no network call', async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);

        setRuntimeDeps({
            resolveDNS: async () => ({ ipv4: ['203.0.113.1'], ipv6: ['2001:db8::1'] })
        });

        await expect(resolveDNS('example.com')).resolves.toEqual({
            ipv4: ['203.0.113.1'],
            ipv6: ['2001:db8::1']
        });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('the override receives the onlyIPv4 flag', async () => {
        const resolver = vi.fn(async () => ({ ipv4: [], ipv6: [] }));
        setRuntimeDeps({ resolveDNS: resolver });

        await resolveDNS('example.com', true);
        expect(resolver).toHaveBeenCalledWith('example.com', true);
    });

    it('resetRuntimeDeps restores every default', () => {
        setRuntimeDeps({
            random: () => 0.5,
            now: () => new Date(0),
            resolveDNS: async () => ({ ipv4: [], ipv6: [] })
        });
        resetRuntimeDeps();

        expect(runtime.resolveDNS()).toBeNull();
        const samples = new Set(Array.from({ length: 40 }, () => runtime.random()));
        expect(samples.size).toBeGreaterThan(1);
    });
});

describe('the purity property golden files depend on', () => {
    it('100 consecutive seeded runs produce byte-identical output', () => {
        // The gate that keeps the seam a test seam:
        // section 5.6. If it ever fails, an unseeded source of randomness has
        // been reintroduced and golden fixtures cannot be trusted.
        const render = () => {
            setRuntimeDeps({ random: seededRandom(20260730) });
            return JSON.stringify({
                sni: randomUpperCase('rayzen-test.workers.dev'),
                paths: [generateWsPath(_VL_), generateWsPath(_TR_)],
                token: getRandomString(16, 32)
            });
        };

        const expected = render();
        for (let run = 0; run < 100; run++) {
            expect(render()).toBe(expected);
        }
    });
});
