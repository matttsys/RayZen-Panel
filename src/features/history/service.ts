/**
 * History engine: a bounded audit log of what changed in this deployment.
 *
 * Why an audit log in A single-operator panel
 *
 * The panel has no history at all today, and the absence shows up as a support
 * problem rather than a compliance one. When a deployment stops working, the first
 * question is always "what changed?", and the only available answer is the current
 * settings blob, which describes the present and says nothing about the transition
 * that broke it. Recording the transitions makes that question answerable.
 *
 * Redaction is the producer's job, and that is enforced by shape
 *
 * An audit log in a proxy panel is a liability if it is careless: the settings it
 * describes contain a UUID, a Trojan password, and proxy addresses, which are
 * exactly the values that identify a deployment to a censor. So the design refuses
 * to carry them:
 *
 *   - An entry stores *which keys changed*, never their values. `changed: ['vlUUID']`
 *     is useful and safe; the old and new UUID are neither.
 *   - `detail` is typed as flat primitives, so a caller cannot pass a settings
 *     object and hope for the best. A nested blob is a compile error.
 *   - `summary` is prose the producer writes, and every producer in this file
 *     builds it from key names and counts only.
 *
 * A test asserts that no entry produced by the built-in subscribers contains any
 * value from a settings object.
 *
 * Bounded by construction
 *
 * 100 entries, newest first, trimmed on every append. An unbounded log in a single
 * KV value would eventually exceed what is sane to read on a panel request, and KV
 * has no append primitive: every write rewrites the whole value, so the value's
 * size is also the write's cost.
 */

import type { HistoryEntry, HistoryKind } from '#types/platform';
import type { EventMap } from '@platform/events';
import type { HistoryRepository } from '@platform/repositories';
import { runtime } from '@runtime';

/** Flat, non-secret structured detail. The type is the redaction guarantee. */
export type HistoryDetail = Record<string, string | number | boolean>;

export interface HistoryService {
    /** Appends an entry, stamping id and time. */
    record(kind: HistoryKind, summary: string, detail?: HistoryDetail): Promise<void>;
    /** Newest first. */
    list(limit?: number): Promise<HistoryEntry[]>;
    listByKind(kind: HistoryKind, limit?: number): Promise<HistoryEntry[]>;
    /** Most recent entry of a kind, or null. Used by diagnostics for staleness. */
    latest(kind: HistoryKind): Promise<HistoryEntry | null>;
    clear(): Promise<void>;
}

/**
 * Builds an entry id from the timestamp plus a short random suffix.
 *
 * Time alone collides when two entries are recorded in the same millisecond, which
 * happens whenever one request records two facts. `crypto.randomUUID` would be
 * stronger and costs 36 characters per entry against a 100-entry budget; ids here
 * only need to be unique within one deployment's log, so 6 base-36 characters is
 * enough. Uses the runtime seam so tests get deterministic ids.
 */
function entryId(at: number): string {
    const suffix = Math.floor(runtime.random() * 36 ** 6)
        .toString(36)
        .padStart(6, '0');

    return `${at.toString(36)}-${suffix}`;
}

export function createHistoryService(history: HistoryRepository): HistoryService {
    return {
        record(kind, summary, detail) {
            const at = runtime.now().getTime();
            const entry: HistoryEntry = {
                id: entryId(at),
                kind,
                at,
                summary,
                ...(detail && Object.keys(detail).length > 0 ? { detail } : {})
            };

            return history.append(entry);
        },

        list(limit) {
            return history.list(limit);
        },

        listByKind(kind, limit) {
            return history.listByKind(kind, limit);
        },

        async latest(kind) {
            const entries = await history.listByKind(kind, 1);
            return entries[0] ?? null;
        },

        clear() {
            return history.clear();
        }
    };
}

/**
 * How each link action reads in the log.
 *
 * "Revoked" rather than "Disabled" because that is what the operator did: the row stays
 * so they can still see the link existed, but the link itself no longer authorises
 * anything, and a log that called that "disabled" would understate it.
 */
const LINK_SUMMARY: Record<EventMap['links.changed']['action'], string> = {
    create: 'Created',
    enable: 'Re-enabled',
    disable: 'Revoked',
    delete: 'Deleted',
    limit: 'Request limit changed',
    'reset-count': 'Request count reset'
};

/**
 * Renders a changed-keys list into a summary that stays short regardless of how
 * many keys changed.
 *
 * A settings save can touch 80 keys. Listing all of them would blow the per-entry
 * size budget and produce a summary no one reads, so the first three are named and
 * the rest are counted.
 */
export function summariseChanges(changed: readonly string[]): string {
    if (changed.length === 0) return 'Settings saved with no changes.';
    if (changed.length <= 3) return `Updated ${changed.join(', ')}.`;
    return `Updated ${changed.slice(0, 3).join(', ')} and ${changed.length - 3} more.`;
}

/**
 * Subscribes the history engine to the event bus.
 *
 * Same rationale as the analytics subscriber: the handler publishes a fact, this
 * table decides what is worth remembering. Note what is deliberately *not*
 * recorded: `auth.attempt` failures. A log of failed login times is a record of
 * when the operator was at their keyboard, and it would grow under an attack until
 * it evicted every useful entry. Successful logins are recorded because "someone
 * logged in and then things changed" is the sequence an operator needs.
 */
export function subscribeHistory(
    bus: import('@platform/events').EventBus,
    history: HistoryService
): () => void {
    // Every listener *returns* its promise rather than voiding it. `EventBus.emit`
    // only tracks a promise a listener returns (`invoke` checks `result instanceof
    // Promise`), so a voided write is invisible to `settled()` and the ordering
    // `dispose()` documents, drain listeners then flush, would be unenforced: a
    // listener whose write is gated on a real await could be flushed before it had
    // mutated anything, losing the entry for good.
    const offs = [
        bus.on('settings.updated', ({ changed, version }) =>
            history.record('settings.updated', summariseChanges(changed), {
                keys: changed.length,
                version
            })
        ),
        bus.on('settings.reset', ({ version }) =>
            history.record('settings.reset', 'Settings reset to defaults.', { version })
        ),
        bus.on('panel.updated', ({ from, to }) =>
            history.record('panel.updated', `Panel updated from ${from} to ${to}.`, { from, to })
        ),
        bus.on('warp.refreshed', ({ accounts }) =>
            history.record('warp.refreshed', `Refreshed ${accounts} WARP account(s).`, { accounts })
        ),
        bus.on('scanner.completed', ({ targets, healthy }) =>
            history.record('scanner.run', `Scanned ${targets} target(s), ${healthy} healthy.`, {
                targets,
                healthy
            })
        ),
        bus.on('auth.login', () => history.record('auth.login', 'Panel sign-in.')),
        bus.on('links.changed', ({ action, name, remaining }) =>
            history.record('links.changed', `${LINK_SUMMARY[action]} subscription link '${name}'.`, {
                action,
                remaining
            })
        )
    ];

    return () => {
        for (const off of offs) off();
    };
}
