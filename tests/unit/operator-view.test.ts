/**
 * The five services that answer an operator's question rather than a machine's.
 *
 * Health Center, deployment preflight, configuration comparison, endpoint lifecycle and
 * recommendation effectiveness. They are tested together because they share one
 * property: each reduces facts the panel already has into an answer a person can act
 * on, and each would fail *plausibly* rather than loudly.
 *
 * A health summary that reports "good" on a read-only deployment, a preflight that
 * passes a panel with no password, a rollback plan that proposes restoring a secret, a
 * lifecycle that advises switching endpoints because of noise: every one of those looks
 * like a working feature. Nothing but an assertion about the judgement itself catches
 * them.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { resetRuntimeDeps, setRuntimeDeps } from '@runtime';
import { buildHealthCenter, SCAN_FRESHNESS_MS } from '@features/health/service';
import { runPreflight, verifyDeployment } from '@features/deployment/service';
import { attributeChange, compareConfigurations, planRollback } from '@features/configuration/compare';
import { adviseMigration, buildLifecycles, MIGRATION_MARGIN } from '@features/scanner/lifecycle';
import { measureEffectiveness, reportImprovement, summariseOptimizationHistory } from '@features/analytics/effectiveness';
import type {
    DiagnosticFinding,
    FeatureStatus,
    HealthReport,
    HistoryEntry,
    Recommendation,
    ScanRunSummary
} from '#types/platform';

const NOW = 1_800_000_000_000;

afterEach(() => resetRuntimeDeps());

function freeze(at: number = NOW): void {
    setRuntimeDeps({ now: () => new Date(at) });
}

function finding(status: DiagnosticFinding['status'], id: string): DiagnosticFinding {
    return { id, title: id, status, detail: `${id} detail`, weight: 1 };
}

function report(findings: DiagnosticFinding[], score = 90): HealthReport {
    return {
        score,
        grade: 'good',
        findings,
        tally: {
            pass: findings.filter(entry => entry.status === 'pass').length,
            warn: findings.filter(entry => entry.status === 'warn').length,
            fail: findings.filter(entry => entry.status === 'fail').length,
            skip: findings.filter(entry => entry.status === 'skip').length
        },
        at: NOW
    };
}

const availableFeatures: FeatureStatus[] = [
    { id: 'scanner', title: 'Scanner', state: 'available', requires: ['kv'] },
    { id: 'history', title: 'History', state: 'available', requires: ['kv'] }
];

const run = (at: number, address: string, score: number): ScanRunSummary => ({
    id: `${address}-${at}`,
    at,
    kind: 'clean-ip',
    targets: 4,
    healthy: 3,
    best: { address, score },
    medianScore: score - 10
});

describe('RayZen Health Center', () => {
    it('answers "is my setup good?" with one status and one sentence', () => {
        freeze();
        const result = buildHealthCenter({
            diagnostics: report([finding('pass', 'security.password')]),
            features: availableFeatures,
            endpoints: { recommended: { address: '1.1.1.1', score: 88 }, confidence: 80, trend: 'stable', scoreDelta: 1, reasons: [] },
            recentRuns: [run(NOW - 1000, '1.1.1.1', 88)],
            recommendations: [],
            storageWritable: true
        });

        expect(result.status).toBe('good');
        expect(result.headline).toContain('healthy');
        expect(result.nextActions).toEqual([]);
        expect(result.sections).toHaveLength(4);
    });

    it('takes the worst section rather than averaging problems away', () => {
        freeze();
        const result = buildHealthCenter({
            diagnostics: report([finding('fail', 'security.password')], 95),
            features: availableFeatures,
            endpoints: { recommended: { address: '1.1.1.1', score: 95 }, confidence: 90, trend: 'stable', scoreDelta: 0, reasons: [] },
            recentRuns: [run(NOW - 1000, '1.1.1.1', 95)],
            recommendations: [],
            storageWritable: true
        });

        expect(result.status).toBe('critical');
        expect(result.nextActions[0]).toContain('security.password');
    });

    it('treats an unmeasured section as unknown, never as a failure', () => {
        freeze();
        const result = buildHealthCenter({
            diagnostics: report([finding('pass', 'ok')]),
            features: availableFeatures,
            endpoints: null,
            recentRuns: [],
            recommendations: [],
            storageWritable: true
        });

        const endpoints = result.sections.find(section => section.id === 'endpoints');
        expect(endpoints?.status).toBe('unknown');
        expect(endpoints?.score).toBeNull();
        expect(result.status).toBe('unknown');
        expect(result.headline).toContain('have not run yet');
    });

    it('flags a stale scan without calling it a failure', () => {
        freeze();
        const result = buildHealthCenter({
            diagnostics: report([finding('pass', 'ok')]),
            features: availableFeatures,
            endpoints: { recommended: { address: '1.1.1.1', score: 90 }, confidence: 70, trend: 'stable', scoreDelta: 0, reasons: [] },
            recentRuns: [run(NOW - SCAN_FRESHNESS_MS - 1, '1.1.1.1', 90)],
            recommendations: [],
            storageWritable: true
        });

        const endpoints = result.sections.find(section => section.id === 'endpoints');
        expect(endpoints?.status).toBe('attention');
        expect(endpoints?.details.join(' ')).toContain('day');
    });

    it('reports a read-only deployment as critical', () => {
        freeze();
        const result = buildHealthCenter({
            diagnostics: report([finding('pass', 'ok')]),
            features: availableFeatures,
            endpoints: null,
            recentRuns: [],
            recommendations: [],
            storageWritable: false
        });

        expect(result.status).toBe('critical');
        expect(result.sections.find(section => section.id === 'system')?.headline).toContain('cannot save');
    });

    it('never lists more than three next actions', () => {
        freeze();
        const recommendations: Recommendation[] = [
            { id: 'a', title: 'A', rationale: '', impact: 'low', fields: [] },
            { id: 'b', title: 'B', rationale: '', impact: 'low', fields: [] }
        ];
        const result = buildHealthCenter({
            diagnostics: report([finding('fail', 'x'), finding('warn', 'y')], 40),
            features: [{ id: 'scanner', title: 'Scanner', state: 'unavailable', reason: 'No KV', requires: ['kv'] }],
            endpoints: { recommended: null, confidence: 0, trend: 'degrading', scoreDelta: -20, reasons: [] },
            recentRuns: [{ ...run(NOW, '1.1.1.1', 10), healthy: 0, best: null }],
            recommendations,
            storageWritable: true
        });

        expect(result.nextActions.length).toBeLessThanOrEqual(3);
    });
});

describe('deployment preflight', () => {
    const healthy = {
        kvBound: true,
        storageWritable: true,
        passwordSet: true,
        passwordLength: 0,
        securePath: 'x7f2k9q1m4p8w3z6',
        uuidConfigured: true,
        trojanConfigured: false,
        hostname: 'panel.example.com',
        secureTransport: true,
        apiTokenPresent: true,
        deployType: 'workers',
        panelVersion: '1.0.0'
    };

    it('passes a correctly configured deployment', () => {
        freeze();
        const result = runPreflight(healthy);

        expect(result.ready).toBe(true);
        expect(result.blocking).toBe(0);
        expect(result.checks.every(check => check.status !== 'fail')).toBe(true);
    });

    it('does not warn about a missing Cloudflare token, which is the default', () => {
        // A one-click deployment has no token by design and needs none. Warning about it
        // would tell every ordinary user something is wrong with a working deployment.
        freeze();
        const result = runPreflight({ ...healthy, apiTokenPresent: false });

        expect(result.ready).toBe(true);
        const token = result.checks.find(check => check.id === 'platform.token');
        expect(token?.status).toBe('skip');
        // The absence still has to be legible: the features it costs are named.
        expect(token?.message).toContain('Usage');
    });

    it('blocks on a missing KV binding and explains the fix', () => {
        freeze();
        const result = runPreflight({ ...healthy, kvBound: false, storageWritable: false });

        expect(result.ready).toBe(false);
        const binding = result.checks.find(check => check.id === 'kv.binding');
        expect(binding?.status).toBe('fail');
        expect(binding?.fix).toContain('named exactly "kv"');

        // A check that cannot run must be skipped, not reported as a second failure.
        expect(result.checks.find(check => check.id === 'kv.writable')?.status).toBe('skip');
    });

    it('blocks when no password is set', () => {
        freeze();
        const result = runPreflight({ ...healthy, passwordSet: false });

        expect(result.ready).toBe(false);
        expect(result.checks.find(check => check.id === 'auth.password')?.status).toBe('fail');
    });

    it('warns but does not block on a guessable panel path', () => {
        freeze();
        const result = runPreflight({ ...healthy, securePath: 'panel' });

        expect(result.ready).toBe(true);
        expect(result.checks.find(check => check.id === 'auth.path')?.status).toBe('warn');
    });

    it('blocks when neither protocol identity exists', () => {
        freeze();
        const result = runPreflight({ ...healthy, uuidConfigured: false, trojanConfigured: false });

        expect(result.checks.find(check => check.id === 'proxy.identity')?.status).toBe('fail');
    });

    it('never echoes the secure path back to the caller', () => {
        freeze();
        const text = JSON.stringify(runPreflight(healthy));
        expect(text).not.toContain('x7f2k9q1m4p8w3z6');
    });

    it('every non-pass check carries a fix', () => {
        freeze();
        const result = runPreflight({
            ...healthy,
            kvBound: true,
            passwordSet: false,
            securePath: 'admin',
            uuidConfigured: false,
            trojanConfigured: false,
            secureTransport: false,
            apiTokenPresent: false,
            hostname: 'demo.workers.dev'
        });

        for (const check of result.checks) {
            if (check.status === 'fail' || check.status === 'warn') expect(check.fix).toBeTruthy();
        }
    });

    it('verification adds runtime evidence on top of preflight', () => {
        freeze();
        const result = verifyDeployment({ ...healthy, configExports: 0, successfulLogins: 3, scannerUsed: false });

        expect(result.checks.find(check => check.id === 'verify.login')?.status).toBe('pass');
        expect(result.checks.find(check => check.id === 'verify.export')?.status).toBe('warn');
        expect(result.checks.find(check => check.id === 'verify.scanner')?.status).toBe('warn');
        expect(result.ready).toBe(true);
    });
});

describe('configuration comparison and rollback', () => {
    const before = { remoteDNS: 'a', fragmentLengthMin: 40, vlUUID: 'secret-one', removedKey: 1 };
    const after = { remoteDNS: 'b', fragmentLengthMin: 40, vlUUID: 'secret-two', addedKey: 2 };

    it('diffs by key and classifies additions and removals', () => {
        const comparison = compareConfigurations(before, after);
        const kinds = Object.fromEntries(comparison.differences.map(entry => [entry.key, entry.kind]));

        expect(kinds).toEqual({ remoteDNS: 'changed', vlUUID: 'changed', removedKey: 'removed', addedKey: 'added' });
        expect(comparison.identical).toBe(false);
        expect(comparison.summary).toContain('changed');
    });

    it('reports that a secret changed without printing either value', () => {
        const comparison = compareConfigurations(before, after);
        const secret = comparison.differences.find(entry => entry.key === 'vlUUID');

        expect(secret?.redacted).toBe(true);
        expect(secret?.from).toBe('(hidden)');
        expect(JSON.stringify(comparison)).not.toContain('secret-one');
    });

    it('recognises identical configurations', () => {
        expect(compareConfigurations(before, { ...before }).identical).toBe(true);
    });

    it('plans a rollback that never touches secrets or deletes new keys', () => {
        const plan = planRollback(after, before);

        expect(plan.patch).toEqual({ remoteDNS: 'a', removedKey: 1 });
        expect(plan.patch.vlUUID).toBeUndefined();
        expect(plan.refusedKeys).toEqual(['vlUUID']);
        // `addedKey` exists now but not in the target: leave it, do not delete it.
        expect('addedKey' in plan.patch).toBe(false);
        expect(plan.requiresConfirmation).toBe(true);
    });

    it('needs no confirmation when there is nothing to roll back', () => {
        const plan = planRollback(before, { ...before });
        expect(plan.requiresConfirmation).toBe(false);
        expect(plan.summary).toContain('Nothing to roll back');
    });

    it('attributes a change to the recommendation that caused it', () => {
        const entry: HistoryEntry = {
            id: '1',
            kind: 'settings.updated',
            at: NOW,
            summary: 'Updated 2 settings',
            detail: { recommendationId: 'dns.secure' }
        };

        const attribution = attributeChange(entry);
        expect(attribution.source).toBe('recommendation');
        expect(attribution.sourceId).toBe('dns.secure');
        expect(attribution.explanation).toContain('dns.secure');
    });

    it('falls back to a direct user edit when nothing else explains it', () => {
        const attribution = attributeChange({ id: '2', kind: 'settings.updated', at: NOW, summary: 'Updated' });
        expect(attribution.source).toBe('user');
    });
});

describe('endpoint lifecycle', () => {
    it('classifies a consistently winning endpoint as stable', () => {
        const lifecycles = buildLifecycles([
            run(3000, '1.1.1.1', 90),
            run(2000, '1.1.1.1', 91),
            run(1000, '1.1.1.1', 89)
        ]);

        expect(lifecycles[0].state).toBe('stable');
        expect(lifecycles[0].observations).toBe(3);
        expect(lifecycles[0].averageScore).toBe(90);
    });

    it('marks a single sighting as new rather than trusted', () => {
        expect(buildLifecycles([run(1000, '1.1.1.1', 99)])[0].state).toBe('new');
    });

    it('detects degradation over the retained window', () => {
        const lifecycles = buildLifecycles([
            run(3000, '1.1.1.1', 60),
            run(2000, '1.1.1.1', 75),
            run(1000, '1.1.1.1', 90)
        ]);

        expect(lifecycles[0].state).toBe('degrading');
        expect(lifecycles[0].scoreDelta).toBe(-30);
    });

    it('retires an endpoint that has stopped appearing', () => {
        const lifecycles = buildLifecycles([
            run(1000, 'old.example', 95),
            run(2000, 'old.example', 95),
            run(3000, 'new.example', 70),
            run(4000, 'new.example', 72),
            run(5000, 'new.example', 71)
        ]);

        expect(lifecycles.find(entry => entry.address === 'old.example')?.state).toBe('retired');
    });

    it('refuses to advise a switch on a margin inside the noise', () => {
        const lifecycles = buildLifecycles([
            run(1000, 'a', 80),
            run(2000, 'b', 80 + MIGRATION_MARGIN - 3),
            run(3000, 'a', 80),
            run(4000, 'b', 80 + MIGRATION_MARGIN - 3)
        ]);

        const advice = adviseMigration(lifecycles, 'a');
        expect(advice.moveTo).toBeNull();
        expect(advice.reasons.join(' ')).toContain('margin');
    });

    it('advises a switch when a challenger clearly and repeatedly wins', () => {
        const lifecycles = buildLifecycles([
            run(1000, 'a', 60),
            run(2000, 'b', 92),
            run(3000, 'a', 58),
            run(4000, 'b', 94),
            run(5000, 'b', 93)
        ]);

        const advice = adviseMigration(lifecycles, 'a');
        expect(advice.moveTo).toBe('b');
        expect(advice.confidence).toBeGreaterThanOrEqual(0.55);
    });

    it('treats an unconfigured endpoint as adoption, not migration', () => {
        const lifecycles = buildLifecycles([run(1000, 'a', 80), run(2000, 'a', 82)]);
        const advice = adviseMigration(lifecycles, null);

        expect(advice.moveTo).toBe('a');
        expect(advice.from).toBeNull();
    });

    it('says nothing when there is no history at all', () => {
        const advice = adviseMigration([], 'a');
        expect(advice.moveTo).toBeNull();
        expect(advice.confidence).toBe(0);
    });
});

describe('recommendation effectiveness', () => {
    it('refuses to draw a conclusion from a small sample', () => {
        const result = measureEffectiveness({
            days: [],
            totals: { 'recommendation.shown': 3, 'recommendation.accepted': 3 }
        });

        expect(result.verdict).toBe('insufficient-data');
        expect(result.acceptanceRate).toBeNull();
    });

    it('reports a trusted engine when most advice is taken', () => {
        const result = measureEffectiveness({
            days: [],
            totals: { 'recommendation.shown': 10, 'recommendation.accepted': 8, 'recommendation.dismissed': 2 }
        });

        expect(result.verdict).toBe('trusted');
        expect(result.acceptanceRate).toBe(0.8);
        expect(result.pending).toBe(0);
    });

    it('says plainly when the engine is being ignored', () => {
        const result = measureEffectiveness({
            days: [],
            totals: { 'recommendation.shown': 20, 'recommendation.accepted': 1, 'recommendation.dismissed': 9 }
        });

        expect(result.verdict).toBe('ignored');
        expect(result.pending).toBe(10);
        expect(result.notes.join(' ')).toContain('dismissed');
    });

    it('does not call score noise an improvement', () => {
        expect(reportImprovement(80, 81).verdict).toBe('unchanged');
        expect(reportImprovement(80, 90).verdict).toBe('improved');
        expect(reportImprovement(90, 80).verdict).toBe('regressed');
        expect(reportImprovement(null, 80).verdict).toBe('unknown');
    });

    it('averages only optimisations that were actually measured', () => {
        const summary = summariseOptimizationHistory([
            { at: 2, sourceId: 'p1', source: 'preset', scoreBefore: 70, scoreAfter: 80 },
            { at: 1, sourceId: 'r1', source: 'recommendation', scoreBefore: null, scoreAfter: 90 }
        ]);

        expect(summary.entries).toHaveLength(2);
        expect(summary.averageDelta).toBe(10);
        expect(summary.summary).toContain('improved');
    });

    it('reports honestly when nothing has been applied', () => {
        expect(summariseOptimizationHistory([]).summary).toContain('No optimisations');
    });
});
