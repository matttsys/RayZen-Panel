/**
 * RayZen Health Center.
 *
 * Why this exists
 *
 * The panel could answer four separate questions well: is the
 * configuration valid (diagnostics), are the endpoints healthy (scanner), is the
 * deployment capable (feature registry), and is anything recommended
 * (recommendations). It could not answer the only question a non-expert actually
 * asks: **\"is my setup good?\"** Four green-ish panels in four places is not an
 * answer; it is homework.
 *
 * This module is a pure aggregator. It owns no data, performs no I/O, and computes
 * no new facts. It takes what the existing subsystems already produce and reduces
 * it to one status, one sentence, and at most three next actions.
 *
 * Design choices
 *
 * - **Worst-wins, not average.** A broken endpoint is not cancelled out by tidy
 *   configuration. The overall status is the worst section status, because that is
 *   what the user will experience. The numeric score is a weighted mean and exists
 *   only for trend display; the status is what the UI leads with.
 * - **Unknown is not failure.** A deployment with no scan history is not unhealthy,
 *   it is unmeasured. Sections without data return `unknown`, are excluded from the
 *   score, and never drag the headline down. Punishing users for not having run a
 *   scan yet would train them to ignore the page.
 * - **At most three actions.** A list of twelve is a list of zero. Actions are
 *   ordered by severity and truncated, so the page always fits the promise of
 *   \"understand it in seconds\".
 */

import type {
    EndpointIntelligence,
    FeatureStatus,
    HealthCenterReport,
    HealthReport,
    HealthSection,
    HealthStatus,
    Recommendation,
    ScanRunSummary
} from '#types/platform';
import { runtime } from '@runtime';

/** Section weights for the roll-up score. Configuration dominates: it is the part the user controls. */
const WEIGHTS: Record<string, number> = {
    configuration: 0.45,
    endpoints: 0.35,
    system: 0.2
};

const SEVERITY: Record<HealthStatus, number> = {
    good: 0,
    unknown: 1,
    attention: 2,
    critical: 3
};

function worst(statuses: HealthStatus[]): HealthStatus {
    return statuses.reduce<HealthStatus>(
        (acc, status) => (SEVERITY[status] > SEVERITY[acc] ? status : acc),
        'good'
    );
}

export interface HealthCenterInput {
    /** Diagnostics output for the current settings. */
    diagnostics: HealthReport | null;
    /** Feature registry states, used for system health. */
    features: readonly FeatureStatus[];
    /** Latest endpoint intelligence, when a scan has ever run. */
    endpoints: EndpointIntelligence | null;
    /** Most recent scan summaries, newest first. Used only for freshness. */
    recentRuns: readonly ScanRunSummary[];
    /** Currently open recommendations. */
    recommendations: readonly Recommendation[];
    /** True when storage is writable; a read-only deployment cannot persist anything. */
    storageWritable: boolean;
}

/** A scan older than this is reported as stale rather than current. */
export const SCAN_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;

function configurationSection(report: HealthReport | null): HealthSection {
    if (!report) {
        return {
            id: 'configuration',
            title: 'Configuration',
            status: 'unknown',
            score: null,
            headline: 'Configuration has not been checked yet.',
            details: ['Open the diagnostics view to run the first check.']
        };
    }

    const errors = report.findings.filter(finding => finding.status === 'fail').length;
    const warnings = report.findings.filter(finding => finding.status === 'warn').length;

    const status: HealthStatus = errors > 0 ? 'critical' : warnings > 0 ? 'attention' : 'good';

    const headline =
        errors > 0
            ? `${errors} configuration problem${errors === 1 ? '' : 's'} need${errors === 1 ? 's' : ''} attention.`
            : warnings > 0
              ? `Configuration works, with ${warnings} suggestion${warnings === 1 ? '' : 's'}.`
              : 'Configuration is valid with no outstanding issues.';

    return {
        id: 'configuration',
        title: 'Configuration',
        status,
        score: report.score,
        headline,
        // Only the actionable findings, worst first, so the section stays readable.
        details: report.findings
            .filter(finding => finding.status !== 'pass')
            .slice(0, 4)
            .map(finding => finding.detail)
    };
}

function endpointSection(
    endpoints: EndpointIntelligence | null,
    recentRuns: readonly ScanRunSummary[],
    now: number
): HealthSection {
    const latest = recentRuns[0] ?? null;

    if (!endpoints || !latest) {
        return {
            id: 'endpoints',
            title: 'Endpoints',
            status: 'unknown',
            score: null,
            headline: 'No endpoint scan has run yet.',
            details: ['Run a scan to find out which endpoints perform best from your network.']
        };
    }

    const details: string[] = [];
    const stale = now - latest.at > SCAN_FRESHNESS_MS;
    const best = endpoints.recommended;

    if (stale) {
        const days = Math.round((now - latest.at) / (24 * 60 * 60 * 1000));
        details.push(`The last scan ran ${days} day${days === 1 ? '' : 's'} ago. Endpoint quality changes over time.`);
    }

    if (endpoints.trend === 'degrading') {
        details.push('Endpoint scores are trending down compared with earlier scans.');
    }

    if (latest.healthy === 0) {
        details.push('No endpoint responded successfully in the last scan.');
    }

    const status: HealthStatus =
        latest.healthy === 0
            ? 'critical'
            : stale || endpoints.trend === 'degrading' || (best?.score ?? 0) < 50
              ? 'attention'
              : 'good';

    const headline =
        latest.healthy === 0
            ? 'No endpoint responded in the most recent scan.'
            : best
              ? `Best endpoint scores ${Math.round(best.score)}/100${stale ? ', from an old scan' : ''}.`
              : 'Endpoints responded, but none scored well enough to recommend.';

    return {
        id: 'endpoints',
        title: 'Endpoints',
        status,
        score: best ? Math.round(best.score) : null,
        headline,
        details
    };
}

function systemSection(features: readonly FeatureStatus[], storageWritable: boolean): HealthSection {
    const unavailable = features.filter(feature => feature.state === 'unavailable');
    const degraded = features.filter(feature => feature.state === 'degraded');

    const details = [...unavailable, ...degraded]
        .slice(0, 4)
        .map(feature => `${feature.title}: ${feature.reason ?? 'unavailable'}`);

    if (!storageWritable) {
        details.unshift('Storage is not writable, so settings, history and scan results cannot be saved.');
    }

    const total = features.length || 1;
    const score = Math.round(((total - unavailable.length - degraded.length * 0.5) / total) * 100);

    const status: HealthStatus = !storageWritable
        ? 'critical'
        : unavailable.length > 0
          ? 'attention'
          : degraded.length > 0
            ? 'attention'
            : 'good';

    const headline = !storageWritable
        ? 'This deployment cannot save changes.'
        : unavailable.length + degraded.length === 0
          ? 'All platform features are available.'
          : `${unavailable.length + degraded.length} feature${unavailable.length + degraded.length === 1 ? ' is' : 's are'} limited on this deployment.`;

    return {
        id: 'system',
        title: 'System',
        status,
        score: Math.max(0, Math.min(100, score)),
        headline,
        details
    };
}

function recommendationSection(recommendations: readonly Recommendation[]): HealthSection {
    if (recommendations.length === 0) {
        return {
            id: 'recommendations',
            title: 'Recommendations',
            status: 'good',
            score: null,
            headline: 'Nothing is waiting for your decision.',
            details: []
        };
    }

    // Recommendations are advice, never a fault: the worst they can be is `attention`.
    return {
        id: 'recommendations',
        title: 'Recommendations',
        status: 'attention',
        score: null,
        headline: `${recommendations.length} recommendation${recommendations.length === 1 ? '' : 's'} waiting for review.`,
        details: recommendations.slice(0, 3).map(entry => entry.title)
    };
}

/**
 * Builds the unified report.
 *
 * Pure: same input, same output, no clock reads other than the injected runtime
 * seam, no storage access. That is what lets the panel render it on any request
 * without a Worker time budget concern.
 */
export function buildHealthCenter(input: HealthCenterInput): HealthCenterReport {
    const now = runtime.now().getTime();

    const sections: HealthSection[] = [
        configurationSection(input.diagnostics),
        endpointSection(input.endpoints, input.recentRuns, now),
        systemSection(input.features, input.storageWritable),
        recommendationSection(input.recommendations)
    ];

    const status = worst(sections.map(section => section.status));

    // Only scored sections participate, and only with their declared weight, so an
    // unmeasured section neither inflates nor deflates the number.
    const scored = sections.filter(section => section.score !== null && WEIGHTS[section.id] !== undefined);
    const weight = scored.reduce((sum, section) => sum + (WEIGHTS[section.id] ?? 0), 0);
    const score =
        weight > 0
            ? Math.round(
                  scored.reduce((sum, section) => sum + (section.score ?? 0) * (WEIGHTS[section.id] ?? 0), 0) / weight
              )
            : null;

    const nextActions = sections
        .filter(section => section.status === 'critical' || section.status === 'attention')
        .sort((a, b) => SEVERITY[b.status] - SEVERITY[a.status])
        .map(section => section.details[0] ?? section.headline)
        .slice(0, 3);

    const headline =
        status === 'critical'
            ? 'Your setup needs attention before it will work reliably.'
            : status === 'attention'
              ? 'Your setup works, and there are improvements worth making.'
              : status === 'unknown'
                ? 'Your setup looks fine, but some checks have not run yet.'
                : 'Your setup is healthy. Nothing needs your attention.';

    return { status, score, headline, sections, nextActions, at: now };
}
