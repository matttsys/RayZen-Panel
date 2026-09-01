import { describe, expect, it } from 'vitest';
import {
    BACKUP_FORMAT_VERSION,
    canonicalise,
    checksum,
    createBackup,
    planRestore,
    redact,
    validateBackup
} from '@features/backup/service';
import {
    assessBackupCompatibility,
    assessMigration,
    compareVersions,
    parseVersion,
    relate,
    stepsBetween
} from '@features/migration/service';

const settings = {
    remoteDNS: 'https://dns.google/dns-query',
    cleanIPs: '1.1.1.1,1.0.0.1',
    fragmentLengthMin: 100,
    bypassIran: true,
    vlUUID: '11111111-2222-3333-4444-555555555555',
    trPass: 'super-secret',
    apiToken: 'cf-token',
    securePath: 'a-long-secure-path'
};

const context = { panelVersion: '1.0.0', deployType: 'workers' };

describe('backup redaction', () => {
    it('never carries a secret out of the deployment', () => {
        const { payload, removed } = redact(settings);

        expect(payload.vlUUID).toBeUndefined();
        expect(payload.trPass).toBeUndefined();
        expect(payload.apiToken).toBeUndefined();
        expect(payload.securePath).toBeUndefined();
        expect(removed).toEqual(expect.arrayContaining(['vlUUID', 'trPass', 'apiToken', 'securePath']));

        expect(payload.remoteDNS).toBe('https://dns.google/dns-query');
        expect(payload.fragmentLengthMin).toBe(100);
        expect(payload.bypassIran).toBe(true);
    });

    it('serialises the whole envelope without a secret anywhere in the text', () => {
        const text = JSON.stringify(createBackup(settings, context));

        expect(text).not.toContain('super-secret');
        expect(text).not.toContain('cf-token');
        expect(text).not.toContain('11111111-2222');
        expect(text).not.toContain('a-long-secure-path');
    });
});

describe('backup integrity', () => {
    it('is stable across key ordering', () => {
        expect(canonicalise({ a: 1, b: 2 })).toBe(canonicalise({ b: 2, a: 1 }));
        expect(checksum({ a: 1, b: [1, 2] })).toBe(checksum({ b: [1, 2], a: 1 }));
    });

    it('accepts a backup it produced', () => {
        const validation = validateBackup(createBackup(settings, context));

        expect(validation.ok).toBe(true);
        expect(validation.issues).toEqual([]);
        expect(validation.envelope?.format).toBe(BACKUP_FORMAT_VERSION);
    });

    it('rejects a tampered backup', () => {
        const envelope = createBackup(settings, context);
        const tampered = { ...envelope, settings: { ...envelope.settings, remoteDNS: 'http://evil.example' } };
        const validation = validateBackup(tampered);

        expect(validation.ok).toBe(false);
        expect(validation.issues.join(' ')).toContain('checksum');
    });

    it('rejects a document from a newer format', () => {
        const envelope = createBackup(settings, context);
        const validation = validateBackup({ ...envelope, format: BACKUP_FORMAT_VERSION + 1 });

        expect(validation.ok).toBe(false);
        expect(validation.issues.join(' ')).toContain('newer RayZen');
    });

    it('rejects anything that is not a backup', () => {
        expect(validateBackup(null).ok).toBe(false);
        expect(validateBackup('{}').ok).toBe(false);
        expect(validateBackup([]).ok).toBe(false);
        expect(validateBackup({ product: 'something-else' }).ok).toBe(false);
    });
});

describe('restore planning', () => {
    const current = {
        remoteDNS: 'https://cloudflare-dns.com/dns-query',
        cleanIPs: '1.1.1.1,1.0.0.1',
        fragmentLengthMin: 40,
        bypassIran: true,
        vlUUID: 'existing-uuid'
    };

    it('reports exactly what would change and writes nothing', () => {
        const plan = planRestore(createBackup(settings, context), current);

        expect(plan.changes.map(change => change.key)).toEqual(['fragmentLengthMin', 'remoteDNS']);
        expect(plan.patch).toEqual({ fragmentLengthMin: 100, remoteDNS: 'https://dns.google/dns-query' });
        expect(plan.requiresConfirmation).toBe(true);

        expect(current.remoteDNS).toBe('https://cloudflare-dns.com/dns-query');
    });

    it('refuses protected keys even when a hand-edited file contains them', () => {
        const envelope = createBackup(settings, context);
        const hostile = { ...envelope, settings: { ...envelope.settings, vlUUID: 'attacker-uuid' } };
        const plan = planRestore(hostile, current);

        expect(plan.refusedKeys).toContain('vlUUID');
        expect(plan.patch.vlUUID).toBeUndefined();
        expect(plan.changes.some(change => change.key === 'vlUUID')).toBe(false);
    });

    it('skips keys this panel version does not know', () => {
        const envelope = createBackup({ ...settings, futureFlag: 'yes' }, context);
        const plan = planRestore(envelope, current);

        expect(plan.unknownKeys).toContain('futureFlag');
        expect(plan.patch.futureFlag).toBeUndefined();
    });

    it('needs no confirmation when nothing would change', () => {
        const plan = planRestore(createBackup(current, context), current);

        expect(plan.changes).toEqual([]);
        expect(plan.requiresConfirmation).toBe(false);
    });
});

describe('version and migration framework', () => {
    it('parses and orders panel versions', () => {
        expect(parseVersion('v1.0.0')).toEqual({ major: 1, minor: 0, patch: 0, suffix: '' });
        expect(parseVersion('not-a-version')).toBeNull();
        expect(compareVersions(parseVersion('1.0.0')!, parseVersion('1.1.0')!)).toBe(-1);
        expect(relate('1.0.0', '1.0.0')).toBe('same');
        expect(relate('1.1.0', '1.0.0')).toBe('downgrade');
        expect(relate('nonsense', '1.0.0')).toBe('unknown');
    });

    it('lists only the migrations crossed by an upgrade', () => {
        // 0.9.0 predates the supported floor; both baseline steps apply when
        // crossing into 1.0.0. Within the 1.x line nothing is crossed, because
        // both migrations shipped with the first release.
        const steps = stepsBetween(parseVersion('0.9.0')!, parseVersion('1.0.0')!);
        expect(steps.map(step => step.id)).toEqual(['platform-kv-namespaces', 'backup-format-1']);

        expect(stepsBetween(parseVersion('1.0.0')!, parseVersion('1.0.1')!)).toEqual([]);
    });

    it('warns about a downgrade without forbidding it', () => {
        const assessment = assessMigration('1.1.0', '1.0.0');

        expect(assessment.relation).toBe('downgrade');
        expect(assessment.compatible).toBe(true);
        expect(assessment.notes.join(' ')).toContain('downgrade');
    });

    it('refuses a version older than the supported floor', () => {
        expect(assessMigration('0.9.0', '1.0.0').compatible).toBe(false);
    });

    it('refuses a backup taken on a newer panel than the one restoring it', () => {
        const assessment = assessBackupCompatibility('1.2.0', '1.0.0');

        expect(assessment.compatible).toBe(false);
        expect(assessment.notes[0]).toContain('newer than this deployment');
    });

    it('accepts an older backup and explains what is kept', () => {
        const assessment = assessBackupCompatibility('1.0.0', '1.1.0');

        expect(assessment.compatible).toBe(true);
        expect(assessment.notes[0]).toContain('keep their current values');
    });
});
