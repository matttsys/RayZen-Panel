/**
 * Injectable runtime dependencies.
 *
 * Config generation currently reads `Math.random()` and the network directly,
 * which makes its output different on every call. That is fine in production and
 * fatal for testing: golden fixtures cannot exist while the same input produces
 * different bytes each time.
 *
 * This module is the seam. Production behaviour is unchanged by construction:
 * the defaults are exactly the implementations that were inlined before, and
 * nothing in `src/` calls the override functions. Only tests do.
 *
 * Deliberately minimal. It is not a DI container, and it is not a place to put
 * anything a caller could pass as a parameter instead.
 */

export interface DnsResult {
    ipv4: string[];
    ipv6: string[];
}

export interface RuntimeDeps {
    /** Uniform random in [0, 1). Production: `Math.random`. */
    random(): number;
    /** Current time. Production: `new Date()`. */
    now(): Date;
    /**
     * Resolves a hostname to A and AAAA records.
     *
     * `null` means "use the built-in DoH resolver", which is the production
     * path. Tests supply a function so config generation never touches the
     * network and always yields the same addresses.
     */
    resolveDNS: ((domain: string, onlyIPv4?: boolean) => Promise<DnsResult>) | null;
}

const productionDeps: RuntimeDeps = {
    random: () => Math.random(),
    now: () => new Date(),
    resolveDNS: null
};

let deps: RuntimeDeps = { ...productionDeps };

/** The seam every caller in `src/` goes through. */
export const runtime = {
    random: (): number => deps.random(),
    now: (): Date => deps.now(),
    resolveDNS: () => deps.resolveDNS
};

/**
 * Overrides one or more dependencies. Test-only: no code under `src/` calls
 * this, and a lint rule should keep it that way.
 */
export function setRuntimeDeps(overrides: Partial<RuntimeDeps>): void {
    deps = { ...deps, ...overrides };
}

/** Restores production behaviour. Call in `afterEach`. */
export function resetRuntimeDeps(): void {
    deps = { ...productionDeps };
}

/**
 * A small deterministic PRNG for tests. Not cryptographically secure and not
 * used in production; it exists so a seeded run reproduces byte-for-byte.
 *
 * mulberry32: 32-bit state, good enough distribution for generating stable
 * fixture values, and short enough to audit at a glance.
 */
export function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
