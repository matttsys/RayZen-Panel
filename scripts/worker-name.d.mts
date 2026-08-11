/**
 * Types for scripts/worker-name.mjs.
 *
 * The script is plain ESM because the installer runs it with bare `node`, with no build
 * step and no loader, which is the point: someone deploying without a repository should not
 * need a toolchain. The declarations exist so the test that holds its behaviour can be
 * type-checked like the rest of the suite. Same arrangement as scripts/make-favicon.d.mts.
 */

/** Cloudflare's own rule for a Worker name. */
export declare const WORKER_NAME_RULE: RegExp;

/** Whether a proposed name matches the syntax and naming policy. */
export declare function isSafeWorkerName(name: string): boolean;

/** A fresh name, e.g. `rayzen-swift-harbor-a91f`. `random` is injectable for tests only. */
export declare function generateWorkerName(random?: () => number): string;

/** A name none of `taken` uses, falling back to a numeric suffix rather than looping. */
export declare function uniqueWorkerName(taken: readonly string[], random?: () => number): string;
