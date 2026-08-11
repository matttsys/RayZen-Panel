/**
 * Event recording seam: how a handler publishes a fact without importing the
 * platform's internals or paying for it when nothing listens.
 *
 * WHY A HELPER RATHER THAN `createPlatform` AT EACH CALL SITE
 *
 * A handler that wanted to record something would otherwise have to create a
 * platform, emit, and remember to dispose. Forgetting the dispose loses the write
 * silently, which is the worst possible failure mode for an audit log: the feature
 * appears to work and the data is not there. So the correct sequence exists once,
 * here, and a handler passes a closure.
 *
 * The rule this module enforces
 *
 * **Recording must never fail the user's operation.** A settings save that succeeded
 * must return success even if the KV write for its history entry failed, the metrics
 * document was corrupt, or the analytics listener threw. The panel's job is to
 * proxy traffic; observability is strictly subordinate to that. Every path here is
 * therefore wrapped, and a failure is logged and swallowed.
 *
 * That is a deliberate asymmetry with the rest of the codebase, where a swallowed
 * error would be a defect. It is justified because the data is derived and
 * non-authoritative: losing a counter costs a number on a dashboard, while failing
 * the save costs the user their configuration.
 *
 * WHY NOT `ctx.waitUntil`
 *
 * `waitUntil` would be the ideal home for the flush, since it lets the response
 * return before the KV write completes. RayZen's `fetch` signature is
 * `fetch(request, env)` with no `ExecutionContext` (`src/worker.ts`), inherited from
 * legacy upstream, and threading a third parameter through every handler is a change to the
 * entry-point contract that belongs in its own commit. So the flush is awaited
 * inline. The cost is one KV write on the settings-save path, which already performs
 * several.
 */

import { createPlatform, type Platform } from './context';

/**
 * Runs `record` against a request-scoped platform, then flushes.
 *
 * Returns nothing: a caller must not branch on whether recording worked, because
 * doing so would reintroduce the coupling this module exists to remove.
 */
export async function withRecorder(
    env: Env,
    record: (platform: Platform) => void | Promise<void>
): Promise<void> {
    // No KV binding means nothing can be recorded. Returning early avoids
    // constructing a platform whose every repository would fail on first use.
    if (!env.kv) return;

    let platform: Platform | null = null;

    try {
        platform = createPlatform(env.kv);
        await record(platform);
    } catch (error) {
        console.log('Event recording failed:', error);
    } finally {
        try {
            const result = await platform?.dispose();
            // Listener failures are collected rather than thrown, so they would
            // otherwise be invisible. One log line per failed listener is the only
            // signal an operator can get that a counter is not being written.
            for (const failure of result?.failures ?? []) {
                console.log(`Listener for '${failure.event}' failed:`, failure.error);
            }
        } catch (error) {
            console.log('Event flush failed:', error);
        }
    }
}
