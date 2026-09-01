/**
 * Diagnostics engine: turns "is this deployment set up sensibly?" into a number
 * and a list of specific, actionable findings.
 *
 * Why this is not the validation framework
 *
 * Validation answers "may this be saved?" and its answer is binary and blocking.
 * Diagnostics answers "is this wise?" and its answer must never block anything.
 * The distinction is load-bearing: a deployment with no panel password is
 * perfectly valid, saves fine, and is also the single most dangerous
 * misconfiguration available. Expressing that as a validation error would break
 * the first-run flow for every user; expressing it as a diagnostic finding tells
 * them without standing in their way.
 *
 * So: every check here inspects settings that already passed validation, and no
 * check can fail a request.
 *
 * Why A weighted score rather than A pass count
 *
 * A plain "17 of 20 checks passed" scores a missing password the same as a
 * suboptimal DNS choice. Weights encode the project's actual threat model: the
 * security checks carry roughly ten times the weight of the convenience checks, so
 * a deployment cannot reach a good grade while being trivially accessible. The
 * weights are declared next to each check and are the one thing to argue about in
 * review.
 *
 * No network, no KV, on the check path
 *
 * Checks are pure functions of a context that the caller has already assembled.
 * That keeps the health view cheap enough to render on a panel request, and it
 * makes the whole engine testable by construction: a check is a function from a
 * plain object to a finding.
 */

import type {
    CheckStatus,
    DiagnosticFinding,
    HealthReport,
    Recommendation,
    StatisticsSummary,
    EndpointIntelligence
} from '#types/platform';
import type { CapabilityContext } from '@platform/features';
import { runtime } from '@runtime';

/**
 * Everything a check may look at.
 *
 * A deliberate subset of settings rather than the whole object: naming the fields
 * a check may read makes the engine's blast radius reviewable, and it stops a
 * future check from reaching for a secret. Nothing here is a credential.
 */
export interface DiagnosticsContext {
    capabilities: CapabilityContext;
    settings: {
        /** Enabled protocol list, already split. */
        protocols: readonly string[];
        ports: readonly number[];
        remoteDNS: string;
        localDNS: string;
        antiSanctionDNS: string;
        enableIPv6: boolean;
        allowLANConnection: boolean;
        logLevel: string;
        fakeDNS: boolean;
        enableECH: boolean;
        cleanIPs: readonly string[];
        customCdnAddrs: readonly string[];
        warpEndpoints: readonly string[];
        blockAds: boolean;
        blockMalware: boolean;
        blockPhishing: boolean;
        customBypassRules: readonly string[];
        customBlockRules: readonly string[];
        /** Panel version recorded in KV, used for the update-staleness check. */
        panelVersion: string;
    };
    /** Current build version, for comparison against `panelVersion`. */
    currentVersion: string;
    /** Analytics summary, or null when analytics is unavailable. */
    statistics: StatisticsSummary | null;
    /** Bounded scanner history intelligence; never raw attempts. */
    scanner?: EndpointIntelligence | null;
}

/** A single check. Pure: same context, same finding. */
export interface DiagnosticCheck {
    id: string;
    title: string;
    weight: number;
    run(context: DiagnosticsContext): { status: CheckStatus; detail: string; remediation?: string };
}

/**
 * Weight tiers, named so a check declares intent rather than a magic number.
 *
 * The ratio is what matters: one CRITICAL failure outweighs every ADVISORY check
 * combined, which is the property that stops a well-tuned but unauthenticated
 * panel from scoring well.
 */
export const WEIGHT = {
    /** Direct exposure of the panel or its users. */
    CRITICAL: 30,
    /** Materially affects whether the deployment works or leaks. */
    IMPORTANT: 10,
    /** Quality of the configuration. */
    ADVISORY: 3,
    /** Informational only; excluded from the score. */
    INFO: 0
} as const;

const SECURITY_CHECKS: readonly DiagnosticCheck[] = [
    {
        id: 'security.password-set',
        title: 'Panel password',
        weight: WEIGHT.CRITICAL,
        run: ({ capabilities }) =>
            capabilities.hasPassword
                ? { status: 'pass', detail: 'The panel requires a password.' }
                : {
                      status: 'fail',
                      detail:
                          'No panel password is set. Anyone who learns the panel URL can read your ' +
                          'configuration and change your settings.',
                      remediation: 'Set a password from the panel, or redeploy with one configured.'
                  }
    },
    {
        id: 'security.log-level',
        title: 'Client log level',
        weight: WEIGHT.ADVISORY,
        run: ({ settings }) => {
            // `debug` and `info` make the generated client config record connection
            // detail on the user's device. That file is the clearest evidence of what
            // the user was doing, so the default should be quiet.
            const verbose = settings.logLevel === 'debug' || settings.logLevel === 'info';
            return verbose
                ? {
                      status: 'warn',
                      detail: `Log level is '${settings.logLevel}', so clients will record connection detail locally.`,
                      remediation: 'Set log level to warn or error unless you are debugging.'
                  }
                : { status: 'pass', detail: `Log level is '${settings.logLevel}'.` };
        }
    },
    {
        id: 'security.lan-exposure',
        title: 'LAN connection',
        weight: WEIGHT.IMPORTANT,
        run: ({ settings }) =>
            settings.allowLANConnection
                ? {
                      status: 'warn',
                      detail:
                          'Clients will accept proxy connections from the local network, not only from ' +
                          'the device itself.',
                      remediation: 'Disable LAN connections unless you are deliberately sharing the tunnel.'
                  }
                : { status: 'pass', detail: 'Clients accept local connections only.' }
    },
    {
        id: 'security.dns-leak',
        title: 'Remote DNS transport',
        weight: WEIGHT.IMPORTANT,
        run: ({ settings }) => {
            // A plaintext DNS server on the remote side defeats the point: queries
            // travel unencrypted and are the easiest thing on the wire to censor.
            if (settings.remoteDNS.startsWith('https://') || settings.remoteDNS.startsWith('tls://')) {
                return { status: 'pass', detail: 'Remote DNS uses an encrypted transport.' };
            }

            return {
                status: 'fail',
                detail: `Remote DNS '${settings.remoteDNS}' is not an encrypted transport, so DNS queries are visible.`,
                remediation: 'Use a DoH (https://) or DoT (tls://) resolver for remote DNS.'
            };
        }
    }
];

const INTELLIGENCE_CHECKS: readonly DiagnosticCheck[] = [
    { id: 'intelligence.endpoint-degradation', title: 'Endpoint stability trend', weight: WEIGHT.IMPORTANT, run: ({ scanner }) => {
        if (!scanner || scanner.trend === 'unknown' || scanner.trend === 'baseline') return { status: 'skip', detail: 'More bounded scan history is needed before stability can be compared.' };
        if (scanner.trend === 'degrading') return { status: 'warn', detail: `Endpoint quality declined ${Math.abs(scanner.scoreDelta ?? 0)} points with ${scanner.confidence}% evidence confidence.`, remediation: scanner.recommended ? `Review ${scanner.recommended.address} and compare a Maximum Stability profile.` : 'Run a bounded Clean IP scan.' };
        return { status: 'pass', detail: `Endpoint quality is ${scanner.trend}; evidence confidence is ${scanner.confidence}%.` };
    } }
];

const CONFIG_CHECKS: readonly DiagnosticCheck[] = [
    {
        id: 'config.protocols-enabled',
        title: 'Protocols enabled',
        weight: WEIGHT.CRITICAL,
        run: ({ settings }) =>
            settings.protocols.length > 0
                ? { status: 'pass', detail: `${settings.protocols.length} protocol(s) enabled.` }
                : {
                      status: 'fail',
                      detail: 'No protocols are enabled, so no subscription can be generated.',
                      remediation: 'Enable at least one protocol in the configuration page.'
                  }
    },
    {
        id: 'config.ports-selected',
        title: 'Ports selected',
        weight: WEIGHT.IMPORTANT,
        run: ({ settings }) => {
            if (settings.ports.length === 0) {
                return {
                    status: 'fail',
                    detail: 'No ports are selected, so generated configs have no endpoint to connect to.',
                    remediation: 'Select at least one port.'
                };
            }

            // TLS ports survive inspection that plaintext ports do not. A config with
            // only HTTP ports works until the first middlebox looks at it.
            const httpsPorts = [443, 8443, 2053, 2083, 2087, 2096];
            const hasTls = settings.ports.some(port => httpsPorts.includes(port));

            return hasTls
                ? { status: 'pass', detail: `${settings.ports.length} port(s) selected, including TLS.` }
                : {
                      status: 'warn',
                      detail: 'Only plaintext ports are selected, which is easier to detect and block.',
                      remediation: 'Add at least one TLS port such as 443.'
                  };
        }
    },
    {
        id: 'config.clean-addresses',
        title: 'Clean IP coverage',
        weight: WEIGHT.ADVISORY,
        run: ({ settings }) => {
            const count = settings.cleanIPs.length + settings.customCdnAddrs.length;
            if (count === 0) {
                return {
                    status: 'warn',
                    detail:
                        'No clean IPs or custom CDN addresses are configured, so clients use the ' +
                        'default hostname only.',
                    remediation: 'Add clean IPs if the default hostname is throttled on your network.'
                };
            }

            return { status: 'pass', detail: `${count} alternative address(es) configured.` };
        }
    },
    {
        id: 'config.warp-endpoints',
        title: 'WARP endpoints',
        weight: WEIGHT.ADVISORY,
        run: ({ settings, capabilities }) => {
            if (!capabilities.hasWarpAccounts) {
                return { status: 'skip', detail: 'WARP accounts are not present yet.' };
            }

            return settings.warpEndpoints.length > 0
                ? { status: 'pass', detail: `${settings.warpEndpoints.length} WARP endpoint(s) configured.` }
                : {
                      status: 'warn',
                      detail: 'No WARP endpoints are configured, so WARP configs fall back to the default.',
                      remediation: 'Add WARP endpoints, or scan for a fast one.'
                  };
        }
    },
    {
        id: 'config.ipv6',
        title: 'IPv6',
        weight: WEIGHT.INFO,
        run: ({ settings }) => ({
            status: settings.enableIPv6 ? 'pass' : 'warn',
            detail: settings.enableIPv6
                ? 'IPv6 is enabled.'
                : 'IPv6 is disabled. Enable it if your network supports it, for more available routes.'
        })
    }
];

const PLATFORM_CHECKS: readonly DiagnosticCheck[] = [
    {
        id: 'platform.kv-bound',
        title: 'KV namespace',
        weight: WEIGHT.CRITICAL,
        run: ({ capabilities }) =>
            capabilities.hasKv
                ? { status: 'pass', detail: 'A KV namespace is bound.' }
                : {
                      status: 'fail',
                      detail: 'No KV namespace is bound, so settings cannot be saved.',
                      remediation: 'Bind a KV namespace named kv to the deployment.'
                  }
    },
    {
        id: 'platform.version-current',
        title: 'Panel version',
        weight: WEIGHT.IMPORTANT,
        run: ({ settings, currentVersion }) => {
            if (!settings.panelVersion) {
                return { status: 'skip', detail: 'No stored panel version to compare against.' };
            }

            return settings.panelVersion === currentVersion
                ? { status: 'pass', detail: `Running the current version (${currentVersion}).` }
                : {
                      status: 'warn',
                      detail: `Stored settings were written by version ${settings.panelVersion}; this build is ${currentVersion}.`,
                      remediation: 'Save settings once to migrate them to this version.'
                  };
        }
    },
    {
        id: 'platform.update-capability',
        title: 'Self-update',
        weight: WEIGHT.ADVISORY,
        run: ({ capabilities }) =>
            capabilities.hasApiToken
                ? { status: 'pass', detail: 'The panel can redeploy itself.' }
                : {
                      status: 'warn',
                      detail: 'No Cloudflare API token is embedded, so updates must be deployed manually.',
                      remediation: 'Redeploy with an API token to enable self-update.'
                  }
    },
    {
        id: 'platform.auth-failures',
        title: 'Authentication failures',
        weight: WEIGHT.IMPORTANT,
        run: ({ statistics }) => {
            if (!statistics || statistics.authSuccessRate === null) {
                return { status: 'skip', detail: 'No authentication attempts recorded yet.' };
            }

            const failures = statistics.totals['auth.failure'] ?? 0;

            // A high failure *rate* on two attempts is a typo. A high rate on many
            // attempts is someone guessing. Both the rate and the volume have to be
            // high before this is worth alarming about.
            if (failures >= 10 && statistics.authSuccessRate < 0.5) {
                return {
                    status: 'warn',
                    detail: `${failures} failed sign-in attempts recorded, more than half of all attempts.`,
                    remediation: 'Consider changing the panel path and password.'
                };
            }

            return { status: 'pass', detail: `${failures} failed sign-in attempt(s) recorded.` };
        }
    }
];

/** Every check the engine runs, in report order. */
export const CORE_CHECKS: readonly DiagnosticCheck[] = [
    ...PLATFORM_CHECKS,
    ...SECURITY_CHECKS,
    ...CONFIG_CHECKS,
    ...INTELLIGENCE_CHECKS
];

/**
 * Credit awarded per status.
 *
 * A warning earns half credit rather than none, because a warning describes a
 * working deployment that could be better. Scoring it as a failure would make the
 * score bimodal and useless for tracking improvement.
 *
 * A skipped check is excluded from both numerator and denominator, so "WARP not
 * set up yet" neither helps nor hurts.
 */
const CREDIT: Record<CheckStatus, number> = {
    pass: 1,
    warn: 0.5,
    fail: 0,
    skip: 0
};

function gradeFor(score: number): HealthReport['grade'] {
    if (score >= 90) return 'excellent';
    if (score >= 75) return 'good';
    if (score >= 50) return 'fair';
    return 'poor';
}

/**
 * Scores findings into a report.
 *
 * Exported separately from `run` so the model can be tested against hand-built
 * finding lists, which is how the weight ratios are pinned.
 */
export function score(findings: readonly DiagnosticFinding[], at: number): HealthReport {
    let earned = 0;
    let possible = 0;

    const tally: Record<CheckStatus, number> = { pass: 0, warn: 0, fail: 0, skip: 0 };

    for (const finding of findings) {
        tally[finding.status] += 1;
        if (finding.status === 'skip' || finding.weight === 0) continue;

        possible += finding.weight;
        earned += finding.weight * CREDIT[finding.status];
    }

    // No weighted checks ran at all. Reporting 0 would claim a broken deployment;
    // reporting 100 would claim a verified one. 100 is the lesser lie because the
    // findings list is displayed alongside and shows the skips.
    const value = possible === 0 ? 100 : Math.round((earned / possible) * 100);

    return {
        score: value,
        grade: gradeFor(value),
        findings: [...findings],
        tally,
        at
    };
}

export interface DiagnosticsService {
    /** Runs every check and scores the result. */
    run(context: DiagnosticsContext): HealthReport;
    /** Findings only, unscored. Used when a caller wants to filter first. */
    inspect(context: DiagnosticsContext): DiagnosticFinding[];
    /** Actionable recommendations derived from the same context. */
    recommend(context: DiagnosticsContext): Recommendation[];
    /** The registered checks, for a diagnostics UI that lists what is verified. */
    checks(): readonly DiagnosticCheck[];
}

export function createDiagnosticsService(
    checks: readonly DiagnosticCheck[] = CORE_CHECKS
): DiagnosticsService {
    const inspect = (context: DiagnosticsContext): DiagnosticFinding[] =>
        checks.map(check => {
            // A throwing check must not take the health view down with it. An
            // unexpected shape in the context is a bug worth surfacing, not a 500.
            try {
                const { status, detail, remediation } = check.run(context);
                return {
                    id: check.id,
                    title: check.title,
                    status,
                    detail,
                    weight: check.weight,
                    ...(remediation ? { remediation } : {})
                };
            } catch {
                return {
                    id: check.id,
                    title: check.title,
                    status: 'skip' as CheckStatus,
                    detail: 'This check could not run.',
                    weight: 0
                };
            }
        });

    return {
        inspect,
        run: context => score(inspect(context), runtime.now().getTime()),
        recommend: context => recommend(context, inspect(context)),
        checks: () => checks
    };
}

/**
 * Impact mirrors the weight tier of the check that produced the recommendation, so
 * the two views cannot disagree about what matters.
 */
function impactFor(weight: number): Recommendation['impact'] {
    if (weight >= WEIGHT.CRITICAL) return 'high';
    if (weight >= WEIGHT.IMPORTANT) return 'medium';
    return 'low';
}

/**
 * Maps a failing check to the settings keys a user would change, and to a patch
 * when the correct value is unambiguous.
 *
 * A patch is present only where there is exactly one defensible answer. `logLevel`
 * has one: nothing but debugging benefits from verbose client logs. `remoteDNS`
 * does not: the right resolver depends on the user's network and on who they are
 * willing to expose queries to, so that recommendation informs and refuses to
 * choose. Shipping a patch for it would be the engine making a threat-model
 * decision on the user's behalf.
 */
const REMEDIATION_MAP: Record<string, { fields: readonly string[]; patch?: Record<string, string | number | boolean> }> = {
    'security.password-set': { fields: ['password'] },
    'security.log-level': { fields: ['logLevel'], patch: { logLevel: 'warn' } },
    'security.lan-exposure': { fields: ['allowLANConnection'], patch: { allowLANConnection: false } },
    'security.dns-leak': { fields: ['remoteDNS'] },
    'config.protocols-enabled': { fields: ['protocols'] },
    'config.ports-selected': { fields: ['ports'] },
    'config.clean-addresses': { fields: ['cleanIPs', 'customCdnAddrs'] },
    'config.warp-endpoints': { fields: ['warpEndpoints'] },
    'config.ipv6': { fields: ['enableIPv6'], patch: { enableIPv6: true } },
    'platform.version-current': { fields: ['panelVersion'] },
    'platform.update-capability': { fields: [] },
    'platform.kv-bound': { fields: [] },
    'platform.auth-failures': { fields: ['securePath'] },
    'intelligence.endpoint-degradation': { fields: ['cleanIPs'] }
};

/**
 * Derives recommendations from findings.
 *
 * Recommendations are a *view* of the findings rather than a second rule set. A
 * separate rule set would drift from the checks and eventually contradict them,
 * telling the user to change something the health view calls fine.
 *
 * Ordered by impact so a user who reads one line reads the one that matters.
 */
export function recommend(
    context: DiagnosticsContext,
    findings: readonly DiagnosticFinding[]
): Recommendation[] {
    const order: Record<Recommendation['impact'], number> = { high: 0, medium: 1, low: 2 };

    const recommendations = findings
        .filter(finding => finding.status === 'fail' || finding.status === 'warn')
        .map(finding => {
            const mapping = REMEDIATION_MAP[finding.id] ?? { fields: [] };
            return {
                id: finding.id,
                title: finding.remediation ?? finding.title,
                rationale: finding.detail,
                impact: impactFor(finding.weight),
                fields: mapping.fields,
                ...(mapping.patch ? { patch: mapping.patch } : {})
            } satisfies Recommendation;
        });

    // An INFO-weight check contributes nothing to the score, so promoting its
    // warning to a recommendation is the only way its advice reaches the user.
    // It stays at `low` impact, which `impactFor` already guarantees.
    void context;

    return recommendations.sort((a, b) => order[a.impact] - order[b.impact]);
}
