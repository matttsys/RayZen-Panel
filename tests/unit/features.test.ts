/**
 * Feature-service tests: diagnostics scoring, the preset guard, recommendation
 * aggregation, and the analytics privacy constraints.
 *
 * Why these four together
 *
 * They are the subsystems whose *policy* is the product decision, and each states a
 * property that would fail silently:
 *
 *   - Diagnostics claims one CRITICAL failure outweighs every ADVISORY check
 *     combined, so a well-tuned but unauthenticated panel cannot score well. That is
 *     a claim about weight ratios, and a future weight edit could break it without
 *     breaking any other test.
 *   - Presets claim no preset can set a credential, enforced at construction. If the
 *     guard silently filtered instead of throwing, a preset author would never learn.
 *   - Recommendations claim they own no rules of their own and that bundle advice is
 *     suppressed when specific advice already covers it. Both are properties of the
 *     merge, testable against hand-built lists.
 *   - Analytics claims no per-user, per-IP or per-request record exists and that the
 *     counter namespace is closed. The first is a shape assertion, the second is a
 *     count.
 *
 * Nothing here touches the network, and only the analytics repository tests touch a
 * KV stub.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
    CORE_CHECKS,
    WEIGHT,
    createDiagnosticsService,
    recommend,
    score,
    type DiagnosticsContext
} from '@features/diagnostics/service';
import { CORE_PRESETS, FORBIDDEN_KEYS, createPresetRegistry } from '@features/presets/service';
import {
    createRecommendationEngine,
    diagnosticsProvider,
    merge,
    presetProvider,
    scannerProvider,
    type RecommendationProvider
} from '@features/recommendations/service';
import {
    createAnalyticsService,
    subscribeAnalytics,
    summarise,
    totalOf,
    utcDay
} from '@features/analytics/service';
import { createEventBus } from '@platform/events';
import { createRepositories } from '@platform/repositories';
import { resetRuntimeDeps, setRuntimeDeps } from '@runtime';
import type { DiagnosticFinding, MetricsSnapshot, Preset, Recommendation } from '#types/platform';
import type { ScannerService } from '@features/scanner/service';
import { createKvStub } from '../helpers/worker';

afterEach(() => {
    resetRuntimeDeps();
});

/* ------------------------------------------------------------------ *
 * Diagnostics
 * ------------------------------------------------------------------ */

/** A deployment that passes every check, so each test breaks exactly one thing. */
function healthy(): DiagnosticsContext {
    return {
        capabilities: {
            deployType: 'workers',
            hasPassword: true,
            hasTelegramBot: true,
            hasWarpAccounts: true,
            hasApiToken: true,
            hasKv: true,
            hasCustomDomain: true,
            protocols: ['vless', 'trojan']
        },
        settings: {
            protocols: ['vless', 'trojan'],
            ports: [443, 8443],
            remoteDNS: 'https://8.8.8.8/dns-query',
            localDNS: '8.8.8.8',
            antiSanctionDNS: 'https://1.1.1.1/dns-query',
            enableIPv6: true,
            allowLANConnection: false,
            logLevel: 'warning',
            fakeDNS: false,
            enableECH: false,
            cleanIPs: ['1.2.3.4'],
            customCdnAddrs: [],
            warpEndpoints: ['engage.example:2408'],
            blockAds: true,
            blockMalware: true,
            blockPhishing: true,
            customBypassRules: [],
            customBlockRules: [],
            panelVersion: '1.0.0'
        },
        currentVersion: '1.0.0',
        statistics: null
    };
}

function findingFor(context: DiagnosticsContext, id: string): DiagnosticFinding {
    const finding = createDiagnosticsService().inspect(context).find(entry => entry.id === id);
    if (!finding) throw new Error(`no finding for ${id}`);
    return finding;
}

describe('diagnostics weights', () => {
    it('make one CRITICAL failure outweigh every ADVISORY check combined', () => {
        // The stated property: "one CRITICAL failure outweighs every ADVISORY check
        // combined, which is the property that stops a well-tuned but
        // unauthenticated panel from scoring well."
        const advisoryTotal = CORE_CHECKS
            .filter(check => check.weight === WEIGHT.ADVISORY)
            .reduce((sum, check) => sum + check.weight, 0);

        expect(WEIGHT.CRITICAL).toBeGreaterThan(advisoryTotal);
    });

    it('declare a tier for every check, and INFO contributes nothing', () => {
        const tiers: number[] = Object.values(WEIGHT);

        for (const check of CORE_CHECKS) {
            expect(tiers, check.id).toContain(check.weight);
        }

        expect(WEIGHT.INFO).toBe(0);
    });

    it('every check id is unique and dot-namespaced', () => {
        const ids = CORE_CHECKS.map(check => check.id);
        expect(new Set(ids).size).toBe(ids.length);
        // `<area>.<rule>`, where a rule may carry digits (`config.ipv6`). Pinned
        // because these ids are the stable identity a UI and a remediation map
        // key off, so a free-form id would be a compatibility hazard.
        for (const id of ids) expect(id, id).toMatch(/^[a-z]+\.[a-z0-9-]+$/);
    });
});

describe('diagnostics scoring', () => {
    it('gives a warning half credit, so the score is not bimodal', () => {
        const pass = score([{ id: 'a', title: 'a', status: 'pass', detail: '', weight: 10 }], 0);
        const warn = score([{ id: 'a', title: 'a', status: 'warn', detail: '', weight: 10 }], 0);
        const fail = score([{ id: 'a', title: 'a', status: 'fail', detail: '', weight: 10 }], 0);

        expect(pass.score).toBe(100);
        expect(warn.score).toBe(50);
        expect(fail.score).toBe(0);
    });

    it('excludes a skip from both numerator and denominator', () => {
        // "WARP not set up yet" must neither help nor hurt.
        const report = score(
            [
                { id: 'a', title: 'a', status: 'pass', detail: '', weight: 10 },
                { id: 'b', title: 'b', status: 'skip', detail: '', weight: 30 }
            ],
            0
        );

        expect(report.score).toBe(100);
        expect(report.tally).toEqual({ pass: 1, warn: 0, fail: 0, skip: 1 });
    });

    it('excludes an INFO-weight check from the score but still tallies it', () => {
        const report = score(
            [
                { id: 'a', title: 'a', status: 'pass', detail: '', weight: 10 },
                { id: 'b', title: 'b', status: 'fail', detail: '', weight: WEIGHT.INFO }
            ],
            0
        );

        expect(report.score).toBe(100);
        expect(report.tally.fail).toBe(1);
    });

    it('reports 100 when nothing weighted ran, because 0 would claim a broken deployment', () => {
        const report = score([{ id: 'a', title: 'a', status: 'skip', detail: '', weight: 30 }], 0);
        expect(report.score).toBe(100);
        expect(report.grade).toBe('excellent');
    });

    it('grades on the declared cut points', () => {
        const at = (value: number) =>
            score([{ id: 'a', title: 'a', status: 'pass', detail: '', weight: value }, { id: 'b', title: 'b', status: 'fail', detail: '', weight: 100 - value }], 0).grade;

        expect(at(90)).toBe('excellent');
        expect(at(80)).toBe('good');
        expect(at(60)).toBe('fair');
        expect(at(20)).toBe('poor');
    });

    it('stamps the report time through the runtime seam', () => {
        setRuntimeDeps({ now: () => new Date('2030-01-01T00:00:00.000Z') });
        expect(createDiagnosticsService().run(healthy()).at).toBe(Date.parse('2030-01-01T00:00:00.000Z'));
    });
});

describe('diagnostics checks', () => {
    it('scores a fully configured deployment as excellent', () => {
        const report = createDiagnosticsService().run(healthy());

        expect(report.grade).toBe('excellent');
        expect(report.tally.fail).toBe(0);
    });

    it('a missing password cannot be compensated for by anything else', () => {
        // The whole reason weights exist rather than a pass count.
        const context = healthy();
        context.capabilities.hasPassword = false;

        const report = createDiagnosticsService().run(context);

        expect(report.score).toBeLessThan(90);
        expect(findingFor(context, 'security.password-set').status).toBe('fail');
    });

    it('flags plaintext remote DNS as a failure, not a warning', () => {
        const context = healthy();
        context.settings.remoteDNS = '8.8.8.8';

        expect(findingFor(context, 'security.dns-leak').status).toBe('fail');
    });

    it('accepts DoT as well as DoH for remote DNS', () => {
        const context = healthy();
        context.settings.remoteDNS = 'tls://1.1.1.1';

        expect(findingFor(context, 'security.dns-leak').status).toBe('pass');
    });

    it('warns on verbose client logging, which records activity on the user\'s device', () => {
        for (const level of ['debug', 'info']) {
            const context = healthy();
            context.settings.logLevel = level;
            expect(findingFor(context, 'security.log-level').status, level).toBe('warn');
        }

        for (const level of ['warning', 'error', 'none']) {
            const context = healthy();
            context.settings.logLevel = level;
            expect(findingFor(context, 'security.log-level').status, level).toBe('pass');
        }
    });

    it('warns when only plaintext ports are selected', () => {
        const context = healthy();
        context.settings.ports = [80, 8080];

        expect(findingFor(context, 'config.ports-selected').status).toBe('warn');
    });

    it('fails when no ports are selected at all', () => {
        const context = healthy();
        context.settings.ports = [];

        expect(findingFor(context, 'config.ports-selected').status).toBe('fail');
    });

    it('skips the WARP endpoint check until WARP accounts exist', () => {
        // Reporting "no endpoints" before the accounts are fetched would be noise
        // about a state the user has not reached yet.
        const context = healthy();
        context.capabilities.hasWarpAccounts = false;
        context.settings.warpEndpoints = [];

        expect(findingFor(context, 'config.warp-endpoints').status).toBe('skip');
    });

    it('skips the version check when nothing is stored to compare', () => {
        const context = healthy();
        context.settings.panelVersion = '';

        expect(findingFor(context, 'platform.version-current').status).toBe('skip');
    });

    it('warns when stored settings predate this build', () => {
        const context = healthy();
        context.settings.panelVersion = '5.0.0';

        const finding = findingFor(context, 'platform.version-current');
        expect(finding.status).toBe('warn');
        expect(finding.detail).toContain('5.0.0');
    });

    it('needs both a high failure rate and real volume before alarming', () => {
        // A high rate on two attempts is a typo; a high rate on many is someone
        // guessing.
        const typo = healthy();
        typo.statistics = {
            totals: { 'auth.failure': 2, 'auth.success': 0 },
            dailyAverage: {}, authSuccessRate: 0, exportSuccessRate: null, activeDays: 1, lastActiveDay: '2025-01-01'
        };
        expect(findingFor(typo, 'platform.auth-failures').status).toBe('pass');

        const attack = healthy();
        attack.statistics = {
            totals: { 'auth.failure': 40, 'auth.success': 1 },
            dailyAverage: {}, authSuccessRate: 0.024, exportSuccessRate: null, activeDays: 1, lastActiveDay: '2025-01-01'
        };
        expect(findingFor(attack, 'platform.auth-failures').status).toBe('warn');
    });

    it('skips the auth check when analytics is unavailable', () => {
        expect(findingFor(healthy(), 'platform.auth-failures').status).toBe('skip');
    });

    it('a throwing check degrades to skip rather than taking the report down', () => {
        // The health view is what an operator opens *because* something is wrong.
        const service = createDiagnosticsService([
            {
                id: 'boom.check',
                title: 'Throws',
                weight: WEIGHT.CRITICAL,
                run: () => {
                    throw new Error('bad context');
                }
            }
        ]);

        const report = service.run(healthy());

        expect(report.findings[0].status).toBe('skip');
        expect(report.findings[0].weight).toBe(0);
        expect(report.score).toBe(100);
    });

    it('exposes its check list, so a UI can say what is verified', () => {
        expect(createDiagnosticsService().checks()).toHaveLength(CORE_CHECKS.length);
    });
});

describe('diagnostics recommendations', () => {
    it('are a view of the findings, never a second rule set', () => {
        // A separate rule set would eventually contradict the checks.
        const context = healthy();
        context.capabilities.hasPassword = false;
        context.settings.logLevel = 'debug';

        const findings = createDiagnosticsService().inspect(context);
        const recommendations = recommend(context, findings);

        const failing = new Set(
            findings.filter(finding => finding.status === 'fail' || finding.status === 'warn').map(finding => finding.id)
        );
        expect(new Set(recommendations.map(entry => entry.id))).toEqual(failing);
    });

    it('orders by impact, so the first line is the one that matters', () => {
        const context = healthy();
        context.capabilities.hasPassword = false;
        context.settings.logLevel = 'debug';
        context.settings.allowLANConnection = true;

        const impacts = recommend(context, createDiagnosticsService().inspect(context)).map(entry => entry.impact);

        expect(impacts[0]).toBe('high');
        expect([...impacts].sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a] - ({ high: 0, medium: 1, low: 2 })[b])).toEqual(impacts);
    });

    it('carries a patch only where exactly one answer is defensible', () => {
        const context = healthy();
        context.settings.logLevel = 'debug';
        context.settings.remoteDNS = '8.8.8.8';

        const byId = new Map(
            recommend(context, createDiagnosticsService().inspect(context)).map(entry => [entry.id, entry])
        );

        // Nothing but debugging benefits from verbose client logs.
        expect(byId.get('security.log-level')?.patch).toEqual({ logLevel: 'warn' });
        // The right resolver depends on the user's threat model, so this informs
        // rather than choosing on their behalf.
        expect(byId.get('security.dns-leak')?.patch).toBeUndefined();
    });

    it('names the fields a user would change, for a deep link', () => {
        const context = healthy();
        context.settings.ports = [];

        const [recommendation] = recommend(context, createDiagnosticsService().inspect(context))
            .filter(entry => entry.id === 'config.ports-selected');

        expect(recommendation.fields).toEqual(['ports']);
    });

    it('promotes an INFO check\'s warning, which is otherwise invisible', () => {
        // An INFO check contributes nothing to the score, so a recommendation is the
        // only route its advice reaches the user.
        const context = healthy();
        context.settings.enableIPv6 = false;

        const ids = recommend(context, createDiagnosticsService().inspect(context)).map(entry => entry.id);
        expect(ids).toContain('config.ipv6');
    });

    it('says nothing about a healthy deployment', () => {
        const context = healthy();
        // IPv6 is the one INFO check that warns by default when disabled.
        expect(recommend(context, createDiagnosticsService().inspect(context))).toEqual([]);
    });
});

/* ------------------------------------------------------------------ *
 * Presets
 * ------------------------------------------------------------------ */

describe('preset guard', () => {
    it('refuses to register a preset that touches a credential or identity', () => {
        // Throws rather than filtering: an author who included one of these has
        // misunderstood something, and dropping the key silently would hide that.
        for (const key of FORBIDDEN_KEYS) {
            const preset: Preset = {
                id: `bad-${key}`,
                title: 'Bad',
                description: 'x',
                audience: 'general',
                patch: { [key]: 'value' },
                preserves: []
            };

            expect(() => createPresetRegistry([preset]), key).toThrow(/may not set protected key/);
        }
    });

    it('names every offending key in the error', () => {
        const preset: Preset = {
            id: 'bad',
            title: 'Bad',
            description: 'x',
            audience: 'general',
            patch: { vlUUID: 'a', trPass: 'b', logLevel: 'none' },
            preserves: []
        };

        expect(() => createPresetRegistry([preset])).toThrow(/vlUUID, trPass/);
    });

    it('rejects a duplicate id', () => {
        const preset: Preset = {
            id: 'dup', title: 'Dup', description: 'x', audience: 'general', patch: {}, preserves: []
        };

        expect(() => createPresetRegistry([preset, preset])).toThrow(/already registered/);
    });

    it('no shipped preset touches a protected key', () => {
        for (const preset of CORE_PRESETS) {
            for (const key of Object.keys(preset.patch)) {
                expect(FORBIDDEN_KEYS, `${preset.id}.${key}`).not.toContain(key);
            }
        }
    });

    it('every shipped preset is a patch, never a full settings object', () => {
        // A preset with 70 keys would be a settings object wearing a preset's name.
        for (const preset of CORE_PRESETS) {
            const keys = Object.keys(preset.patch);
            expect(keys.length, preset.id).toBeGreaterThan(0);
            expect(keys.length, preset.id).toBeLessThan(20);
            expect(preset.preserves.length, preset.id).toBeGreaterThan(0);
        }
    });

    it('every shipped preset patch value is a flat scalar', () => {
        // The comparison in `differs` assumes scalars or flat arrays, and a nested
        // object is explicitly outside what a preset may contain.
        for (const preset of CORE_PRESETS) {
            for (const [key, value] of Object.entries(preset.patch)) {
                const flat = value === null || ['string', 'number', 'boolean'].includes(typeof value)
                    || (Array.isArray(value) && value.every(entry => ['string', 'number', 'boolean'].includes(typeof entry)));
                expect(flat, `${preset.id}.${key}`).toBe(true);
            }
        }
    });

    it('audiences are unique across the shipped catalogue', () => {
        const audiences = CORE_PRESETS.map(preset => preset.audience);
        expect(new Set(audiences).size).toBe(audiences.length);
    });
});

describe('preset application', () => {
    const registry = () => createPresetRegistry(CORE_PRESETS);

    it('is a preview: it reports what would change and writes nothing', () => {
        const current = { logLevel: 'debug', allowLANConnection: true, ports: [443] };
        const application = registry().apply('balanced', current);

        expect(application?.changed).toContain('logLevel');
        expect(application?.changed).toContain('allowLANConnection');
        // The input is untouched.
        expect(current.logLevel).toBe('debug');
    });

    it('preserves every key the preset has no opinion about', () => {
        const current = { vlUUID: 'keep-me', ports: [443, 8443], logLevel: 'debug' };
        const application = registry().apply('balanced', current);

        expect(application?.result.vlUUID).toBe('keep-me');
        expect(application?.result.ports).toEqual([443, 8443]);
    });

    it('reports no change when the value already matches', () => {
        const application = registry().apply('performance', { enableTFO: true });
        expect(application?.changed).not.toContain('enableTFO');
    });

    it('compares arrays by value, not by identity', () => {
        const preset: Preset = {
            id: 'arrays', title: 'Arrays', description: 'x', audience: 'general',
            patch: { ports: [443, 8443] }, preserves: []
        };
        const local = createPresetRegistry([preset]);

        expect(local.apply('arrays', { ports: [443, 8443] })?.changed).toEqual([]);
        expect(local.apply('arrays', { ports: [8443, 443] })?.changed).toEqual(['ports']);
    });

    it('distinguishes an unknown preset from one that changes nothing', () => {
        expect(registry().apply('does-not-exist', {})).toBeNull();
        expect(registry().apply('balanced', {})?.changed.length).toBeGreaterThan(0);
    });

    it('groups by audience and looks up by id', () => {
        const local = registry();

        expect(local.byAudience('privacy').map(preset => preset.id)).toEqual(['privacy']);
        expect(local.get('balanced')?.title).toBe('Balanced');
        expect(local.get('nope')).toBeNull();
    });
});

/* ------------------------------------------------------------------ *
 * Recommendation aggregation
 * ------------------------------------------------------------------ */

function recommendation(overrides: Partial<Recommendation> & { id: string }): Recommendation {
    return {
        title: 'title',
        rationale: 'rationale',
        impact: 'medium',
        fields: [],
        ...overrides
    };
}

describe('recommendation merge', () => {
    it('collapses identical ids, highest impact winning', () => {
        const merged = merge([
            [recommendation({ id: 'same', impact: 'low' })],
            [recommendation({ id: 'same', impact: 'high' })]
        ]);

        expect(merged).toHaveLength(1);
        expect(merged[0].impact).toBe('high');
    });

    it('orders by impact, then by id for stability between refreshes', () => {
        const merged = merge([
            [
                recommendation({ id: 'b.low', impact: 'low' }),
                recommendation({ id: 'a.high', impact: 'high' }),
                recommendation({ id: 'b.high', impact: 'high' }),
                recommendation({ id: 'a.low', impact: 'low' })
            ]
        ]);

        expect(merged.map(entry => entry.id)).toEqual(['a.high', 'b.high', 'a.low', 'b.low']);
    });

    it('suppresses bundle advice already covered by specific advice', () => {
        // "Apply a preset" is less actionable than "change this field", so the
        // specific one wins.
        const merged = merge([
            [recommendation({ id: 'security.log-level', impact: 'high', fields: ['logLevel'] })],
            [recommendation({ id: 'preset.privacy', impact: 'medium', fields: ['logLevel'] })]
        ]);

        expect(merged.map(entry => entry.id)).toEqual(['security.log-level']);
    });

    it('keeps bundle advice that covers a field nothing else mentions', () => {
        const merged = merge([
            [recommendation({ id: 'security.log-level', impact: 'high', fields: ['logLevel'] })],
            [recommendation({ id: 'preset.privacy', impact: 'medium', fields: ['logLevel', 'fakeDNS'] })]
        ]);

        expect(merged.map(entry => entry.id)).toEqual(['security.log-level', 'preset.privacy']);
    });

    it('never lets one bundle suppress another', () => {
        // Only non-bundle recommendations contribute coverage, so two presets
        // touching the same field both survive and the user chooses.
        const merged = merge([
            [
                recommendation({ id: 'preset.a', fields: ['logLevel'] }),
                recommendation({ id: 'preset.b', fields: ['logLevel'] })
            ]
        ]);

        expect(merged).toHaveLength(2);
    });

    it('keeps a fieldless bundle, since coverage cannot be established', () => {
        const merged = merge([[recommendation({ id: 'preset.x', fields: [] })]]);
        expect(merged).toHaveLength(1);
    });
});

describe('recommendation engine', () => {
    const context = { diagnostics: healthy(), settings: {} as Record<string, unknown> };

    it('owns no rules: with no providers it returns nothing', () => {
        const engine = createRecommendationEngine([]);
        expect(engine.providers()).toEqual([]);
    });

    it('a failing provider costs its own advice, not everyone\'s', () => {
        // A KV hiccup in the scanner provider must not hide "no panel password".
        const broken: RecommendationProvider = {
            id: 'broken',
            provide: () => {
                throw new Error('provider is broken');
            }
        };
        const working: RecommendationProvider = {
            id: 'working',
            provide: () => [recommendation({ id: 'works', impact: 'high' })]
        };

        const engine = createRecommendationEngine([broken, working]);
        return engine.collect(context).then(list => {
            expect(list.map(entry => entry.id)).toEqual(['works']);
        });
    });

    it('surfaces diagnostics findings through the aggregator', async () => {
        const unhealthy = healthy();
        unhealthy.capabilities.hasPassword = false;

        const engine = createRecommendationEngine([diagnosticsProvider(createDiagnosticsService())]);
        const list = await engine.collect({ diagnostics: unhealthy, settings: {} });

        expect(list.map(entry => entry.id)).toContain('security.password-set');
    });

    it('suggests a preset only when it would change several fields', async () => {
        // Suggesting a preset that changes one field hides the specific action
        // behind a bundle.
        const engine = createRecommendationEngine([presetProvider(createPresetRegistry(CORE_PRESETS))]);

        const nearlyMatching = await engine.collect({
            diagnostics: healthy(),
            settings: { ...CORE_PRESETS[0].patch, logLevel: 'debug' }
        });
        expect(nearlyMatching.map(entry => entry.id)).not.toContain('preset.balanced');

        const veryDifferent = await engine.collect({ diagnostics: healthy(), settings: {} });
        expect(veryDifferent.map(entry => entry.id)).toContain('preset.balanced');
    });

    it('never gives a preset recommendation a patch, so it cannot be applied stale', async () => {
        const engine = createRecommendationEngine([presetProvider(createPresetRegistry(CORE_PRESETS))]);
        const list = await engine.collect({ diagnostics: healthy(), settings: {} });

        for (const entry of list.filter(item => item.id.startsWith('preset.'))) {
            expect(entry.patch).toBeUndefined();
        }
    });

    it('ranks a preset below a critical specific fix', async () => {
        const unhealthy = healthy();
        unhealthy.capabilities.hasPassword = false;

        const engine = createRecommendationEngine([
            diagnosticsProvider(createDiagnosticsService()),
            presetProvider(createPresetRegistry(CORE_PRESETS))
        ]);

        const list = await engine.collect({ diagnostics: unhealthy, settings: {} });
        expect(list[0].id).toBe('security.password-set');
    });

    it('suggests a scanned endpoint only when it is good and not already configured', async () => {
        const scanner = (best: { address: string; score: number } | null): ScannerService =>
            ({ intelligence: async () => ({ recommended: best, confidence: best ? 82 : 0, trend: best ? 'baseline' : 'unknown', scoreDelta: null, reasons: best ? ['Measured in test history'] : ['No history'] }) } as unknown as ScannerService);

        const engine = (service: ScannerService) => createRecommendationEngine([scannerProvider(service)]);

        // Below the quality bar: not suggested.
        expect(await engine(scanner({ address: '1.1.1.1', score: 40 })).collect(context)).toEqual([]);

        // Already configured: suggesting it would teach the user the list is
        // worthless.
        const configured = await engine(scanner({ address: '1.1.1.1', score: 90 })).collect({
            diagnostics: healthy(),
            settings: { cleanIPs: ['1.1.1.1'], warpEndpoints: ['1.1.1.1'] }
        });
        expect(configured).toEqual([]);

        // Good and new: suggested, at low impact.
        const suggested = await engine(scanner({ address: '9.9.9.9', score: 90 })).collect({
            diagnostics: healthy(),
            settings: { cleanIPs: [], warpEndpoints: [] }
        });
        expect(suggested.map(entry => entry.id)).toEqual(['scanner.clean-ip', 'scanner.warp-endpoint']);
        expect(suggested.every(entry => entry.impact === 'low')).toBe(true);
    });

    it('top() returns the highest-impact slice and clamps a negative limit', async () => {
        const unhealthy = healthy();
        unhealthy.capabilities.hasPassword = false;
        unhealthy.settings.logLevel = 'debug';

        const engine = createRecommendationEngine([diagnosticsProvider(createDiagnosticsService())]);

        expect(await engine.top({ diagnostics: unhealthy, settings: {} }, 1)).toHaveLength(1);
        expect(await engine.top({ diagnostics: unhealthy, settings: {} }, -5)).toEqual([]);
    });

    it('reports its provider ids, for diagnostics', () => {
        const engine = createRecommendationEngine([
            diagnosticsProvider(createDiagnosticsService()),
            presetProvider(createPresetRegistry(CORE_PRESETS))
        ]);

        expect(engine.providers()).toEqual(['diagnostics', 'presets']);
    });
});

/* ------------------------------------------------------------------ *
 * Analytics
 * ------------------------------------------------------------------ */

describe('analytics privacy constraints', () => {
    it('stores a count per UTC day and nothing finer', async () => {
        // A minute-resolution series would let whoever obtains the KV data
        // correlate activity with a person's waking hours.
        setRuntimeDeps({ now: () => new Date('2025-06-01T13:45:12.345Z') });

        const kv = createKvStub();
        const repos = createRepositories(kv.namespace);
        const analytics = createAnalyticsService(repos.metrics);

        await analytics.record('auth.success');
        await repos.flush();

        const stored = JSON.parse(kv.store.get('rz:metrics') ?? '{}');
        expect(stored.days).toEqual([{ day: '2025-06-01', counters: { 'auth.success': 1 } }]);
        // No timestamp, no address, no identifier anywhere in the document.
        expect(JSON.stringify(stored)).not.toContain('13:45');
    });

    it('uses UTC so a series never shifts with local time or DST', () => {
        expect(utcDay(new Date('2025-06-01T23:59:59.000Z'))).toBe('2025-06-01');
        expect(utcDay(new Date('2025-06-02T00:00:00.000Z'))).toBe('2025-06-02');
    });

    it('records only counters from the closed namespace', async () => {
        // `MetricName` is a closed union so a contributor cannot quietly add
        // `config.exports.by_country`.
        const kv = createKvStub();
        const repos = createRepositories(kv.namespace);
        const bus = createEventBus();
        const analytics = createAnalyticsService(repos.metrics);
        subscribeAnalytics(bus, analytics);

        bus.emit('config.exported', { subscription: 'normal', core: 'xray', client: 'v2rayng', bytes: 900 });
        bus.emit('config.unsupported', { subscription: 'warp', client: 'nekobox' });
        bus.emit('scanner.probed', { target: '1.2.3.4', ok: true, latencyMs: 20 });
        await bus.settled();

        const { totals } = await analytics.snapshot();

        // The payloads carried a client name, a core, an address and a byte count.
        // None of them may reach the stored document.
        const serialised = JSON.stringify(await analytics.snapshot());
        for (const value of ['v2rayng', 'nekobox', '1.2.3.4', 'xray']) {
            expect(serialised).not.toContain(value);
        }

        expect(totals).toEqual({
            'config.exports': 1,
            'config.unsupported': 1,
            'scanner.probes': 1,
            'scanner.healthy': 1
        });
    });

    it('counts a failed auth attempt without describing it', async () => {
        const repos = createRepositories(createKvStub().namespace);
        const bus = createEventBus();
        const analytics = createAnalyticsService(repos.metrics);
        subscribeAnalytics(bus, analytics);

        bus.emit('auth.attempt', { ok: false });
        bus.emit('auth.attempt', { ok: true });
        await bus.settled();

        expect((await analytics.snapshot()).totals).toEqual({ 'auth.failure': 1, 'auth.success': 1 });
    });

    it('unsubscribing detaches every listener', async () => {
        const repos = createRepositories(createKvStub().namespace);
        const bus = createEventBus();
        const off = subscribeAnalytics(bus, createAnalyticsService(repos.metrics));

        off();
        bus.emit('auth.attempt', { ok: true });
        await bus.settled();

        expect(bus.listenerCount()).toBe(0);
        expect(repos.isDirty()).toBe(false);
    });
});

describe('analytics statistics', () => {
    const snapshot = (days: MetricsSnapshot['days']): MetricsSnapshot => {
        const totals: MetricsSnapshot['totals'] = {};
        for (const day of days) {
            for (const [metric, value] of Object.entries(day.counters)) {
                totals[metric as keyof typeof totals] = (totals[metric as keyof typeof totals] ?? 0) + (value ?? 0);
            }
        }
        return { days, totals };
    };

    it('distinguishes "no attempts yet" from "everything failed"', () => {
        // A UI showing 0% for both would be lying about the second.
        expect(summarise(snapshot([])).authSuccessRate).toBeNull();
        expect(
            summarise(snapshot([{ day: '2025-01-01', counters: { 'auth.failure': 3 } }])).authSuccessRate
        ).toBe(0);
    });

    it('averages over active days, not over the retention window', () => {
        // Dividing by 30 would make every average drift downward as the window fills.
        const summary = summarise(snapshot([
            { day: '2025-01-01', counters: { 'auth.success': 2 } },
            { day: '2025-01-02', counters: { 'auth.success': 4 } }
        ]));

        expect(summary.activeDays).toBe(2);
        expect(summary.dailyAverage['auth.success']).toBe(3);
    });

    it('does not count a day whose counters are all zero as active', () => {
        const summary = summarise(snapshot([{ day: '2025-01-01', counters: { 'auth.success': 0 } }]));
        expect(summary.activeDays).toBe(0);
        expect(summary.dailyAverage).toEqual({});
    });

    it('takes the last day as most recent, trusting the write-time sort', () => {
        const summary = summarise(snapshot([
            { day: '2025-01-01', counters: { 'auth.success': 1 } },
            { day: '2025-03-01', counters: { 'auth.success': 1 } }
        ]));

        expect(summary.lastActiveDay).toBe('2025-03-01');
    });

    it('reports null lastActiveDay for an empty snapshot', () => {
        expect(summarise(snapshot([])).lastActiveDay).toBeNull();
    });

    it('computes the export success rate from supported over attempted', () => {
        const summary = summarise(snapshot([
            { day: '2025-01-01', counters: { 'config.exports': 3, 'config.unsupported': 1 } }
        ]));

        expect(summary.exportSuccessRate).toBe(0.75);
    });

    it('totalOf sums one counter across days', () => {
        expect(totalOf(
            [
                { day: '2025-01-01', counters: { 'auth.success': 2 } },
                { day: '2025-01-02', counters: { 'auth.failure': 5 } },
                { day: '2025-01-03', counters: { 'auth.success': 3 } }
            ],
            'auth.success'
        )).toBe(5);
    });
});

describe('analytics service', () => {
    it('total() reads one counter and reset() drops everything', async () => {
        setRuntimeDeps({ now: () => new Date('2025-01-01T00:00:00.000Z') });
        const repos = createRepositories(createKvStub().namespace);
        const analytics = createAnalyticsService(repos.metrics);

        await analytics.record('panel.updates', 3);
        expect(await analytics.total('panel.updates')).toBe(3);
        expect(await analytics.total('auth.success')).toBe(0);

        await analytics.reset();
        expect((await analytics.snapshot()).days).toEqual([]);
    });

    it('statistics() derives from the same snapshot the panel can already read', async () => {
        setRuntimeDeps({ now: () => new Date('2025-01-01T00:00:00.000Z') });
        const repos = createRepositories(createKvStub().namespace);
        const analytics = createAnalyticsService(repos.metrics);

        await analytics.record('auth.success', 2);
        await analytics.record('auth.failure');

        const statistics = await analytics.statistics();
        expect(statistics.authSuccessRate).toBeCloseTo(0.667, 3);
        expect(statistics.activeDays).toBe(1);
    });
});

/** Kept so the type import is exercised rather than dropped by `noUnusedLocals`. */
export type _ScannerShape = ScannerService;
