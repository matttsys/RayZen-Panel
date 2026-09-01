/**
 * Configuration comparison, change attribution and rollback planning.
 *
 * Why this exists
 *
 * The history engine already records *that* settings changed and summarises the
 * keys involved. What it could not answer is the question an operator asks after
 * something breaks: "what exactly is different from yesterday, why did it change,
 * and can I put it back?" That gap is why people avoid touching a working config
 * at all, which is the opposite of what an optimisation-heavy product needs.
 *
 * This module supplies the three missing pieces, all pure:
 *
 *   - `compareConfigurations` - a key-level diff between any two settings objects.
 *   - `attributeChange` - turns a history entry into a plain-English "why", including
 *     whether a recommendation or preset caused it.
 *   - `planRollback` - the inverse patch needed to return to an earlier state, with
 *     the same never-write, always-confirm contract as restore.
 *
 * Design choices
 *
 * - **Protected keys diff as `redacted: true` with values withheld.** An operator
 *   needs to know that the UUID changed; nobody needs the old and new UUID printed
 *   in a comparison view that may be screenshotted into a support thread.
 * - **No storage of snapshots.** Rollback works from an explicitly supplied earlier
 *   state (a backup file, or an export), not from hidden per-change snapshots. Keeping
 *   snapshots would multiply KV size by retention depth and would put credentials in
 *   a second place, which the history engine deliberately refused to do.
 */

import type { ConfigComparison, ConfigDifference, HistoryEntry, PortableValue } from '#types/platform';
import { PROTECTED_KEYS, canonicalise } from '@features/backup/service';

function isProtected(key: string): boolean {
    return PROTECTED_KEYS.includes(key);
}

function portable(value: unknown): PortableValue {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
        return value.map(item =>
            item === null || ['string', 'number', 'boolean'].includes(typeof item)
                ? (item as string | number | boolean | null)
                : String(item)
        );
    }
    return String(value);
}

/**
 * Key-level diff between two settings objects.
 *
 * `added` and `removed` describe key presence, not truthiness: a key that exists
 * with an empty value is present. This matters because a settings key disappearing
 * between versions is a migration signal, while a key being blanked is a user edit.
 */
export function compareConfigurations(
    before: Record<string, unknown>,
    after: Record<string, unknown>
): ConfigComparison {
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
    const differences: ConfigDifference[] = [];

    for (const key of keys) {
        const inBefore = key in before;
        const inAfter = key in after;

        if (inBefore && inAfter && canonicalise(before[key]) === canonicalise(after[key])) continue;

        const redacted = isProtected(key);
        const kind = !inBefore ? 'added' : !inAfter ? 'removed' : 'changed';

        differences.push({
            key,
            kind,
            // Values are withheld for protected keys; the fact of the change is not.
            from: redacted ? (inBefore ? '(hidden)' : null) : portable(before[key]),
            to: redacted ? (inAfter ? '(hidden)' : null) : portable(after[key]),
            redacted
        });
    }

    const changed = differences.filter(entry => entry.kind === 'changed').length;
    const added = differences.filter(entry => entry.kind === 'added').length;
    const removed = differences.filter(entry => entry.kind === 'removed').length;

    const summary =
        differences.length === 0
            ? 'The two configurations are identical.'
            : [
                  changed > 0 ? `${changed} value${changed === 1 ? '' : 's'} changed` : '',
                  added > 0 ? `${added} key${added === 1 ? '' : 's'} added` : '',
                  removed > 0 ? `${removed} key${removed === 1 ? '' : 's'} removed` : ''
              ]
                  .filter(Boolean)
                  .join(', ') + '.';

    return { identical: differences.length === 0, differences, summary };
}

/** Where a change came from, so history can answer "why", not only "what". */
export type ChangeSource = 'user' | 'recommendation' | 'preset' | 'profile' | 'restore' | 'system';

export interface ChangeAttribution {
    source: ChangeSource;
    /** Identifier of the recommendation, preset or profile responsible, when known. */
    sourceId: string | null;
    /** One sentence explaining the change in the operator's terms. */
    explanation: string;
}

/**
 * Derives attribution from a history entry.
 *
 * The producers already put structured detail on entries; this reads it rather than
 * parsing the human summary, because summaries are for people and parsing them would
 * make wording changes into behaviour changes.
 */
export function attributeChange(entry: HistoryEntry): ChangeAttribution {
    const detail = entry.detail ?? {};

    const recommendationId = typeof detail.recommendationId === 'string' ? detail.recommendationId : null;
    const presetId = typeof detail.presetId === 'string' ? detail.presetId : null;
    const profileId = typeof detail.profileId === 'string' ? detail.profileId : null;
    const restored = detail.restored === true;

    if (recommendationId) {
        return {
            source: 'recommendation',
            sourceId: recommendationId,
            explanation: `Applied from recommendation "${recommendationId}", which you accepted.`
        };
    }

    if (presetId) {
        return {
            source: 'preset',
            sourceId: presetId,
            explanation: `Applied by the "${presetId}" preset.`
        };
    }

    if (profileId) {
        return {
            source: 'profile',
            sourceId: profileId,
            explanation: `Applied while switching to the "${profileId}" optimisation profile.`
        };
    }

    if (restored) {
        return { source: 'restore', sourceId: null, explanation: 'Applied by restoring a backup.' };
    }

    if (entry.kind === 'settings.reset') {
        return { source: 'system', sourceId: null, explanation: 'Settings were reset to defaults.' };
    }

    if (entry.kind === 'panel.updated' || entry.kind === 'warp.refreshed') {
        return { source: 'system', sourceId: null, explanation: entry.summary };
    }

    return { source: 'user', sourceId: null, explanation: 'Changed directly in the panel.' };
}

export interface RollbackPlan {
    /** Inverse patch that returns the changed keys to their earlier values. */
    patch: Record<string, unknown>;
    differences: ConfigDifference[];
    /** Protected keys that differ and will not be rolled back. */
    refusedKeys: string[];
    /** True when there is anything to apply. Applying always needs confirmation. */
    requiresConfirmation: boolean;
    summary: string;
}

/**
 * Computes how to return from `current` to `target`.
 *
 * Keys present now but absent in the target are left alone rather than deleted: a
 * key introduced by a panel upgrade must not be removed by rolling a configuration
 * back, or the rollback becomes a downgrade of the schema itself.
 */
export function planRollback(
    current: Record<string, unknown>,
    target: Record<string, unknown>
): RollbackPlan {
    const comparison = compareConfigurations(current, target);
    const patch: Record<string, unknown> = {};
    const refusedKeys: string[] = [];

    for (const difference of comparison.differences) {
        if (difference.redacted) {
            refusedKeys.push(difference.key);
            continue;
        }
        if (difference.kind === 'removed') continue;
        patch[difference.key] = target[difference.key];
    }

    const count = Object.keys(patch).length;

    return {
        patch,
        differences: comparison.differences,
        refusedKeys: refusedKeys.sort(),
        requiresConfirmation: count > 0,
        summary:
            count === 0
                ? 'Nothing to roll back: the current configuration already matches.'
                : `Rolling back would change ${count} setting${count === 1 ? '' : 's'}.`
    };
}
