/**
 * Recommendation engine: one ranked list of "what should I change?", assembled
 * from every subsystem that has an opinion.
 *
 * WHY THIS EXISTS WHEN `diagnostics.recommend` ALREADY DOES
 *
 * `@features/diagnostics/service` derives recommendations from its own findings,
 * and that stays exactly as it is: it is the *source* that knows about checks. What
 * it cannot do is see the other sources. A user asking "what should I change?"
 * should get one answer, not three lists to reconcile:
 *
 *   - Diagnostics knows the deployment is misconfigured.
 *   - The preset catalogue knows a coherent bundle would fix several fields at once.
 *   - The scanner knows a measured endpoint is faster than the configured one.
 *
 * This module is the *aggregator*. It owns no rules of its own, which is the
 * property that keeps it from drifting away from the checks: every recommendation
 * it returns was produced by a provider, and adding a provider is the only way to
 * add advice. If this file ever grows a rule, that rule belongs in a provider.
 *
 * Deduplication is the whole problem
 *
 * Two providers legitimately produce advice about the same field. Diagnostics says
 * "log level is verbose"; the privacy preset also sets `logLevel`. Showing both is
 * how a recommendation list becomes noise that users learn to ignore. So:
 *
 *   - Identical ids collapse, highest impact winning.
 *   - A preset recommendation is suppressed when it would only change fields that
 *     a higher-impact specific recommendation already covers. A specific fix is
 *     more actionable than "apply a preset", so the specific one wins.
 *
 * Why no recommendation is ever applied automatically
 *
 * A `patch` is present only where exactly one answer is defensible, and even then
 * the caller applies it through the normal validation and write path. Auto-applying
 * would mean the panel changing a user's proxy configuration without being asked,
 * which on a censored network can be the difference between a working tunnel and a
 * detectable one.
 */

import type { Recommendation, RecommendationImpact } from '#types/platform';
import type { DiagnosticsContext, DiagnosticsService } from '@features/diagnostics/service';
import type { PresetRegistry } from '@features/presets/service';
import type { ScannerService } from '@features/scanner/service';

/**
 * A source of recommendations.
 *
 * Async because a provider may need a KV read (the scanner does). Providers must
 * not throw: `collect` isolates failures so one broken provider cannot empty the
 * whole list, but a provider that throws every time is a bug worth fixing rather
 * than tolerating.
 */
export interface RecommendationProvider {
    id: string;
    provide(context: RecommendationContext): Promise<Recommendation[]> | Recommendation[];
}

export interface RecommendationContext {
    diagnostics: DiagnosticsContext;
    /** Current settings, for providers that compare against configured values. */
    settings: Record<string, unknown>;
}

const IMPACT_ORDER: Record<RecommendationImpact, number> = { high: 0, medium: 1, low: 2 };

/**
 * Diagnostics as a provider. A thin adapter, deliberately: the rules live in the
 * diagnostics engine and this is only the wiring that lets the aggregator see them.
 */
export function diagnosticsProvider(diagnostics: DiagnosticsService): RecommendationProvider {
    return {
        id: 'diagnostics',
        provide: context => diagnostics.recommend(context.diagnostics)
    };
}

/**
 * Presets as a provider.
 *
 * Only suggests a preset when it would change at least `minChanged` fields.
 * Suggesting a preset that changes one field is worse than suggesting the field:
 * it hides the specific action behind a bundle, and it invites the user to accept
 * changes they did not ask for.
 *
 * Impact is `medium` rather than `high` on purpose. A preset is a broad,
 * multi-field change, so it should never outrank a specific critical fix such as
 * "set a panel password".
 */
export function presetProvider(presets: PresetRegistry, minChanged = 3): RecommendationProvider {
    return {
        id: 'presets',
        provide({ settings }) {
            const recommendations: Recommendation[] = [];

            for (const preset of presets.list()) {
                const application = presets.apply(preset.id, settings);
                if (!application || application.changed.length < minChanged) continue;

                recommendations.push({
                    id: `preset.${preset.id}`,
                    title: `Apply the ${preset.title} preset`,
                    rationale: `${preset.description} It would change ${application.changed.length} setting(s): ${application.changed.slice(0, 5).join(', ')}${application.changed.length > 5 ? ' and more' : ''}.`,
                    impact: 'medium',
                    fields: application.changed
                    // No `patch`: a preset is applied through the preset endpoint,
                    // which computes the merge against live settings. Copying the
                    // patch here would let it be applied against stale values.
                });
            }

            return recommendations;
        }
    };
}

/**
 * Scanner as a provider.
 *
 * Suggests the measured-best endpoint only when it is genuinely good and is not
 * already configured. A recommendation to use what is already in use is the fastest
 * way to teach a user that the list is worthless.
 */
export function scannerProvider(scanner: ScannerService, minScore = 75): RecommendationProvider {
    return {
        id: 'scanner',
        async provide({ settings }) {
            const recommendations: Recommendation[] = [];

            const sources: { kind: 'clean-ip' | 'warp-endpoint'; field: string; label: string }[] = [
                { kind: 'clean-ip', field: 'cleanIPs', label: 'clean IP' },
                { kind: 'warp-endpoint', field: 'warpEndpoints', label: 'WARP endpoint' }
            ];

            for (const source of sources) {
                const intelligence = await scanner.intelligence(source.kind);
                const best = intelligence.recommended;
                if (!best || best.score < minScore) continue;

                const configured = settings[source.field];
                const list = Array.isArray(configured) ? configured.map(String) : [];
                if (list.includes(best.address)) continue;

                recommendations.push({
                    id: `scanner.${source.kind}`,
                    title: `Add the measured-best ${source.label} (${best.address})`,
                    rationale:
                        `A recent scan scored ${best.address} at ${best.score}/100, and it is not in your ` +
                        `configured ${source.label} list.`,
                    impact: 'low',
                    fields: [source.field],
                    evidence: { confidence: intelligence.confidence, summary: `${best.score}/100 quality · ${intelligence.trend} trend`, after: { quality: best.score }, factors: intelligence.reasons }
                });
            }

            return recommendations;
        }
    };
}

/** True when every field of `candidate` is already covered by `covered`. */
function fullyCovered(candidate: Recommendation, covered: ReadonlySet<string>): boolean {
    if (candidate.fields.length === 0) return false;
    return candidate.fields.every(field => covered.has(field));
}

/**
 * Merges provider output into one ranked list.
 *
 * Exported separately from the service so the merge policy is testable against
 * hand-built lists, which is where the interesting cases are.
 */
export function merge(lists: readonly Recommendation[][]): Recommendation[] {
    const byId = new Map<string, Recommendation>();

    for (const list of lists) {
        for (const recommendation of list) {
            const existing = byId.get(recommendation.id);
            if (!existing || IMPACT_ORDER[recommendation.impact] < IMPACT_ORDER[existing.impact]) {
                byId.set(recommendation.id, recommendation);
            }
        }
    }

    const sorted = Array.from(byId.values()).sort((a, b) => {
        if (IMPACT_ORDER[a.impact] !== IMPACT_ORDER[b.impact]) {
            return IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact];
        }

        // Stable within an impact tier so the list does not reorder between
        // refreshes for reasons the user cannot see.
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    // Second pass: drop bundle-style advice that adds nothing over the specific
    // advice already above it. Iterating the sorted list means "already above"
    // means "higher impact, or equal impact and earlier id", which is exactly the
    // order the user reads.
    const covered = new Set<string>();
    const result: Recommendation[] = [];

    for (const recommendation of sorted) {
        const isBundle = recommendation.id.startsWith('preset.');
        if (isBundle && fullyCovered(recommendation, covered)) continue;

        result.push(recommendation);
        if (!isBundle) for (const field of recommendation.fields) covered.add(field);
    }

    return result;
}

export interface RecommendationEngine {
    /** Every provider's advice, merged, deduplicated and ranked. */
    collect(context: RecommendationContext): Promise<Recommendation[]>;
    /** The highest-impact `limit` recommendations. */
    top(context: RecommendationContext, limit: number): Promise<Recommendation[]>;
    /** Registered provider ids, for diagnostics. */
    providers(): readonly string[];
}

export function createRecommendationEngine(
    providers: readonly RecommendationProvider[]
): RecommendationEngine {
    const collect = async (context: RecommendationContext): Promise<Recommendation[]> => {
        const lists = await Promise.all(
            providers.map(async provider => {
                // A provider that fails must cost its own advice, not everyone's.
                // The alternative is that a KV hiccup in the scanner provider hides
                // the "no panel password" recommendation.
                try {
                    return await provider.provide(context);
                } catch {
                    return [];
                }
            })
        );

        return merge(lists);
    };

    return {
        collect,
        top: async (context, limit) => (await collect(context)).slice(0, Math.max(0, limit)),
        providers: () => providers.map(provider => provider.id)
    };
}
