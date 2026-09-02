/**
 * Backup, restore and migration safety.
 *
 * Why this exists
 *
 * The panel already exports and imports raw settings JSON. That solves "move my
 * config" and solves nothing else: a file with no version cannot be checked against
 * the panel that will read it, a file with no checksum cannot be distinguished from
 * a truncated download, and an import that applies immediately gives the operator
 * no chance to see what is about to change. The real user problem is not export, it
 * is *trusting* a restore on a deployment that currently works.
 *
 * Three invariants
 *
 *   1. **A backup never carries a secret.** `PROTECTED_KEYS` is removed at export
 *      time, not at restore time, so a leaked backup file cannot reveal the VLESS
 *      UUID, the Trojan password, the panel path, the Cloudflare API token or the
 *      account identity. Restoring therefore never rotates identity either, which
 *      is the behaviour an operator wants: their existing subscriptions keep
 *      working.
 *   2. **A restore is a plan first.** `planRestore` returns the exact list of
 *      key-level changes and never writes. Applying goes through the existing
 *      settings write path, so the validators keep their monopoly on writes.
 *   3. **A backup is self-describing.** Format version, panel version, creation
 *      time and a checksum over the payload travel with the data, so a restore can
 *      refuse a file it cannot honestly apply.
 *
 * Why no encryption library
 *
 * Encrypting a file that by construction contains no secret would add a dependency,
 * a key-management problem and a support burden to protect non-sensitive data.
 * Instead the envelope is *integrity* protected with a checksum, and operators who
 * need confidentiality at rest can encrypt the file with tools they already trust.
 * The redaction guarantee is what makes that an honest trade.
 */

import type { BackupEnvelope, BackupPlan, BackupValidation, RestoreChange } from '#types/platform';
import { runtime } from '@runtime';

/** Bumped only when the envelope shape changes in a way older readers cannot parse. */
export const BACKUP_FORMAT_VERSION = 1;

/**
 * Keys that must never leave the deployment in a backup, and must never be written
 * by a restore.
 *
 * This is intentionally the same protection the preset registry enforces, extended
 * with the storage-level secrets. Identity and secrets are properties of a
 * deployment, not of a configuration, so migrating a configuration must not carry
 * them across.
 */
export const PROTECTED_KEYS: readonly string[] = [
    'vlUUID',
    'trPass',
    'apiToken',
    'accID',
    'accEmail',
    'securePath',
    'pwd',
    'password',
    'secretKey',
    'jwtToken'
];

/** Largest backup document accepted, so a restore cannot be used to burn CPU. */
export const MAX_BACKUP_BYTES = 512 * 1024;

/** Largest number of settings keys accepted in one restore. */
export const MAX_BACKUP_KEYS = 400;

function isProtected(key: string): boolean {
    return PROTECTED_KEYS.includes(key);
}

/**
 * Canonical JSON: object keys sorted, so two payloads that differ only in key order
 * produce the same checksum. Without this, re-exporting the same settings could
 * produce a different checksum and make a valid file look tampered with.
 */
export function canonicalise(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;

    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonicalise(item)}`);

    return `{${entries.join(',')}}`;
}

/**
 * FNV-1a over the canonical form, rendered as eight hex characters.
 *
 * This is an integrity check against truncation, copy-paste damage and accidental
 * edits, not a signature: a backup carries no secret, so there is nothing for an
 * attacker to gain by forging one, and a real MAC would need a key the operator
 * would then have to manage. Calling it a checksum rather than a signature keeps
 * that honest.
 */
export function checksum(value: unknown): string {
    const text = canonicalise(value);
    let hash = 0x811c9dc5;

    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    return hash.toString(16).padStart(8, '0');
}

/** Removes protected keys and anything that is not a settings-shaped scalar or array. */
export function redact(settings: Record<string, unknown>): {
    payload: Record<string, unknown>;
    removed: string[];
} {
    const payload: Record<string, unknown> = {};
    const removed: string[] = [];

    for (const [key, value] of Object.entries(settings)) {
        if (isProtected(key)) {
            removed.push(key);
            continue;
        }

        const isScalar = value === null || ['string', 'number', 'boolean'].includes(typeof value);
        const isScalarArray =
            Array.isArray(value) &&
            value.every(item => item === null || ['string', 'number', 'boolean'].includes(typeof item));

        // Anything else (functions, nested objects, class instances) is not part of
        // the settings contract and would not survive a JSON round trip intact.
        if (isScalar || isScalarArray) payload[key] = value;
        else removed.push(key);
    }

    return { payload, removed };
}

export interface BackupContext {
    /** Panel version this deployment is running. */
    panelVersion: string;
    /** Deployment kind, recorded so a restore can warn about a platform change. */
    deployType: string;
}

/** Builds a redacted, checksummed envelope. Never writes and never reads storage. */
export function createBackup(
    settings: Record<string, unknown>,
    context: BackupContext
): BackupEnvelope {
    const { payload, removed } = redact(settings);

    const envelope: Omit<BackupEnvelope, 'checksum'> = {
        format: BACKUP_FORMAT_VERSION,
        product: 'rayzen',
        panelVersion: context.panelVersion,
        deployType: context.deployType,
        createdAt: runtime.now().getTime(),
        redactedKeys: removed.sort(),
        settings: payload
    };

    return { ...envelope, checksum: checksum(envelope) };
}

/**
 * Validates an untrusted document.
 *
 * Returns issues rather than throwing, because every issue here is something the
 * panel should show the operator verbatim: "this file is from a newer RayZen" is a
 * decision for them, not an exception for us.
 */
export function validateBackup(input: unknown): BackupValidation {
    const issues: string[] = [];

    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return { ok: false, issues: ['The file is not a RayZen backup document.'], envelope: null };
    }

    const candidate = input as Partial<BackupEnvelope>;

    if (candidate.product !== 'rayzen') {
        issues.push('The file does not identify itself as a RayZen backup.');
    }

    if (typeof candidate.format !== 'number' || !Number.isInteger(candidate.format)) {
        issues.push('The backup format version is missing or invalid.');
    } else if (candidate.format > BACKUP_FORMAT_VERSION) {
        issues.push(
            `The backup was written by a newer RayZen (format ${candidate.format}); this panel understands up to ${BACKUP_FORMAT_VERSION}.`
        );
    }

    if (typeof candidate.settings !== 'object' || candidate.settings === null || Array.isArray(candidate.settings)) {
        issues.push('The backup contains no settings section.');
    } else {
        const keys = Object.keys(candidate.settings);
        if (keys.length === 0) issues.push('The backup contains no settings values.');
        if (keys.length > MAX_BACKUP_KEYS) issues.push(`The backup declares ${keys.length} settings, which exceeds the ${MAX_BACKUP_KEYS} key limit.`);

        const smuggled = keys.filter(isProtected);
        if (smuggled.length > 0) {
            // Not fatal on its own: the restore plan refuses these keys anyway. It is
            // reported because a backup that carries them was not produced by this
            // panel, and the operator should know that before trusting the file.
            issues.push(`The backup contains protected key(s) that will be ignored: ${smuggled.join(', ')}.`);
        }
    }

    if (typeof candidate.checksum !== 'string') {
        issues.push('The backup has no checksum, so its integrity cannot be verified.');
    } else {
        const { checksum: provided, ...rest } = candidate as BackupEnvelope;
        if (checksum(rest) !== provided) {
            issues.push('The backup checksum does not match its contents. The file may be truncated or edited.');
        }
    }

    const fatal = issues.some(
        issue =>
            issue.startsWith('The file does not identify') ||
            issue.startsWith('The backup format version') ||
            issue.startsWith('The backup was written by a newer') ||
            issue.startsWith('The backup contains no') ||
            issue.startsWith('The backup checksum') ||
            issue.startsWith('The backup declares')
    );

    return {
        ok: !fatal,
        issues,
        envelope: fatal ? null : (candidate as BackupEnvelope)
    };
}

/**
 * Computes what a restore would change, without changing anything.
 *
 * `requiresConfirmation` is always true when there is anything to apply. There is
 * deliberately no "apply silently" path: an operator restoring onto a working
 * deployment is exactly the person who must see the diff first.
 */
export function planRestore(
    envelope: BackupEnvelope,
    current: Record<string, unknown>
): BackupPlan {
    const changes: RestoreChange[] = [];
    const refused: string[] = [];
    const unknownKeys: string[] = [];

    for (const [key, value] of Object.entries(envelope.settings)) {
        if (isProtected(key)) {
            refused.push(key);
            continue;
        }

        if (!(key in current)) {
            // A key this panel does not know cannot be validated, so it is reported
            // and skipped rather than written blindly into the settings document.
            unknownKeys.push(key);
            continue;
        }

        const before = current[key];
        if (canonicalise(before) === canonicalise(value)) continue;

        changes.push({ key, from: before as RestoreChange['from'], to: value as RestoreChange['to'] });
    }

    changes.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    return {
        changes,
        refusedKeys: refused.sort(),
        unknownKeys: unknownKeys.sort(),
        unchanged: Object.keys(envelope.settings).length - changes.length - refused.length - unknownKeys.length,
        requiresConfirmation: changes.length > 0,
        /**
         * The patch a caller submits to the normal settings write path. Only keys
         * that actually change are included, so a restore of an identical backup is
         * a no-op rather than a rewrite of every field.
         */
        patch: Object.fromEntries(changes.map(change => [change.key, change.to]))
    };
}
