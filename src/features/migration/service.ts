/**
 * Version detection, compatibility validation and migration planning.
 *
 * Why this exists
 *
 * RayZen updates itself in place: the operator presses "update panel" and the
 * Worker code changes underneath a settings document that was written by an older
 * release. Until now nothing checked whether the new code could read the old
 * document, and nothing checked whether a backup taken from release X could be
 * restored onto release Y. Both are silent-corruption paths, and both are exactly
 * the moment an operator is least able to diagnose a problem.
 *
 * This module answers one question with no side effects: given version A and
 * version B, is moving between them safe, and what should the operator know?
 *
 * Design choices
 *
 * - **Semver-shaped, not semver-strict.** Panel versions are `major.minor.patch`
 *   with an optional suffix. A dependency for that would be absurd, so parsing is
 *   ~20 lines and unparseable input degrades to `unknown` rather than throwing.
 * - **Downgrade is not "incompatible", it is "lossy".** Refusing a downgrade would
 *   trap an operator whose upgrade went wrong. Instead it is permitted with an
 *   explicit note, because rolling back is a recovery action.
 * - **Migrations are declared, not executed here.** `MIGRATIONS` is data. The
 *   caller decides when to run automatic steps, so this module stays pure and
 *   testable, and a migration can never fire as a side effect of rendering a page.
 */

import type { MigrationAssessment, MigrationStep, VersionRelation } from '#types/platform';

export interface SemanticVersion {
    major: number;
    minor: number;
    patch: number;
    /** Anything after the patch number, e.g. `-beta.1`. Compared only for equality. */
    suffix: string;
}

/**
 * Oldest release whose settings document this panel can read directly.
 *
 * Anything older is not refused outright; it is flagged so the operator upgrades
 * in two hops rather than discovering a half-readable document.
 */
export const MIN_SUPPORTED_VERSION = '1.0.0';

export function parseVersion(input: unknown): SemanticVersion | null {
    if (typeof input !== 'string') return null;

    const match = /^v?(\d+)\.(\d+)\.(\d+)(.*)$/.exec(input.trim());
    if (!match) return null;

    const [, major, minor, patch, suffix] = match;

    return {
        major: Number(major),
        minor: Number(minor),
        patch: Number(patch),
        suffix: (suffix ?? '').trim()
    };
}

/** -1, 0 or 1. Suffixes are ignored for ordering: a suffix is metadata, not rank. */
export function compareVersions(a: SemanticVersion, b: SemanticVersion): number {
    if (a.major !== b.major) return a.major < b.major ? -1 : 1;
    if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
    if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
    return 0;
}

export function relate(from: unknown, to: unknown): VersionRelation {
    const left = parseVersion(from);
    const right = parseVersion(to);
    if (!left || !right) return 'unknown';

    const order = compareVersions(left, right);
    if (order === 0) return 'same';
    return order < 0 ? 'upgrade' : 'downgrade';
}

/**
 * Declared migrations, keyed by the release that introduces them.
 *
 * A step is listed when moving *to* a version at or above `introducedIn` from a
 * version below it. Keeping this as data means adding a future migration is a
 * one-line change with a test, not a new branch in a growing function.
 */
export const MIGRATIONS: ReadonlyArray<MigrationStep & { introducedIn: string }> = [
    {
        // Both steps are part of the v1.0.0 baseline: RayZen's own version line
        // starts at 1.0.0 (the inherited legacy upstream 5.x numbering does not apply), so any
        // deployment below 1.0.0 predates the supported floor anyway. These entries
        // exist so a future release (1.1.0, 2.0.0, ...) carries an explicit record
        // of the steps that shipped with the first version.
        introducedIn: '1.0.0',
        id: 'platform-kv-namespaces',
        description:
            'Platform data (metrics, history, scanner runs) moved into dedicated KV keys. They are created on first write; no action is required.',
        automatic: true
    },
    {
        introducedIn: '1.0.0',
        id: 'backup-format-1',
        description:
            'Backups gained a versioned, checksummed envelope. Configuration exported before this release should be re-exported so it can be integrity checked on restore.',
        automatic: false
    }
];

export function stepsBetween(from: SemanticVersion, to: SemanticVersion): MigrationStep[] {
    return MIGRATIONS.filter(entry => {
        const boundary = parseVersion(entry.introducedIn);
        if (!boundary) return false;
        return compareVersions(from, boundary) < 0 && compareVersions(to, boundary) >= 0;
    }).map(({ introducedIn: _introducedIn, ...step }) => step);
}

/**
 * Assesses a move from one version to another.
 *
 * `compatible: false` means "do not proceed automatically", never "this is
 * impossible". Every incompatibility here has an operator-visible note explaining
 * what to do instead, because a refusal without a remedy is just a dead end.
 */
export function assessMigration(from: unknown, to: unknown): MigrationAssessment {
    const relation = relate(from, to);
    const left = parseVersion(from);
    const right = parseVersion(to);
    const floor = parseVersion(MIN_SUPPORTED_VERSION);

    const notes: string[] = [];
    let compatible = true;

    if (relation === 'unknown' || !left || !right || !floor) {
        return {
            from: typeof from === 'string' ? from : 'unknown',
            to: typeof to === 'string' ? to : 'unknown',
            relation: 'unknown',
            compatible: false,
            notes: [
                'One of the versions could not be read, so compatibility cannot be confirmed. Check the panel version before continuing.'
            ],
            steps: []
        };
    }

    if (compareVersions(left, floor) < 0) {
        compatible = false;
        notes.push(
            `Version ${from} predates the oldest directly supported release (${MIN_SUPPORTED_VERSION}). Upgrade to ${MIN_SUPPORTED_VERSION} first, then continue.`
        );
    }

    if (relation === 'downgrade') {
        notes.push(
            'This is a downgrade. Settings written by the newer release may contain fields the older release ignores, and those values will be lost on the next save.'
        );
    }

    if (relation === 'upgrade' && right.major > left.major) {
        notes.push(
            'This crosses a major version. Export a backup before continuing so the current configuration can be reviewed if anything behaves differently.'
        );
    }

    if (relation === 'same' && left.suffix !== right.suffix) {
        notes.push(`Both sides report ${right.major}.${right.minor}.${right.patch} but with different build suffixes.`);
    }

    const steps = relation === 'upgrade' ? stepsBetween(left, right) : [];

    if (relation === 'upgrade' && steps.length === 0 && notes.length === 0) {
        notes.push('No migration steps are required for this upgrade.');
    }

    return { from: String(from), to: String(to), relation, compatible, notes, steps };
}

/**
 * Compatibility of a backup with the running panel.
 *
 * Separate from `assessMigration` because the two failure modes differ: restoring
 * an *older* backup is routine, while restoring a *newer* one risks writing fields
 * this release will not validate.
 */
export function assessBackupCompatibility(
    backupVersion: unknown,
    currentVersion: unknown
): MigrationAssessment {
    const assessment = assessMigration(backupVersion, currentVersion);

    if (assessment.relation === 'downgrade') {
        // The backup came from a newer panel than the one restoring it.
        return {
            ...assessment,
            compatible: false,
            notes: [
                `The backup was taken on RayZen ${assessment.from}, which is newer than this deployment (${assessment.to}). Update this panel first, then restore.`,
                ...assessment.notes.filter(note => !note.startsWith('This is a downgrade.'))
            ]
        };
    }

    if (assessment.relation === 'upgrade') {
        return {
            ...assessment,
            notes: [
                `The backup was taken on RayZen ${assessment.from} and will be restored onto ${assessment.to}. Settings introduced after ${assessment.from} keep their current values.`,
                ...assessment.notes
            ]
        };
    }

    return assessment;
}
