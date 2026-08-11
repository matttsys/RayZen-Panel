import type {
    OptimizationProfile,
    ProfileEvaluation,
    Recommendation,
    ScanRunSummary
} from '#types/platform';
import type { PresetRegistry } from '@features/presets/service';
import type { ScannerRepository } from '@platform/repositories';
import { intelligenceFromHistory } from '@features/scanner/intelligence';

export const OPTIMIZATION_PROFILES: readonly OptimizationProfile[] = [
    { id: 'smart-low-latency', title: 'Low Latency', description: 'Reduce connection setup delay on networks that do not require heavy obfuscation.', objective: 'latency', presetId: 'smart-low-latency', priorities: ['latency', 'throughput'] },
    { id: 'smart-stability', title: 'Maximum Stability', description: 'Prefer reliability and conservative behavior over peak speed.', objective: 'stability', presetId: 'smart-stability', priorities: ['reliability', 'stability'] },
    { id: 'smart-streaming', title: 'Streaming', description: 'Prioritize sustained throughput and resilient encrypted transport.', objective: 'streaming', presetId: 'smart-streaming', priorities: ['throughput', 'reliability'] },
    { id: 'smart-gaming', title: 'Gaming', description: 'Prioritize low jitter, fast connection setup and consistent routing.', objective: 'gaming', presetId: 'smart-gaming', priorities: ['latency', 'stability'] },
    { id: 'smart-mobile', title: 'Mobile', description: 'Balance roaming resilience, battery use and changing network conditions.', objective: 'mobile', presetId: 'smart-mobile', priorities: ['reliability', 'efficiency'] }
];

export interface OptimizationService {
    profiles(): readonly OptimizationProfile[];
    evaluate(settings: Record<string, unknown>): Promise<ProfileEvaluation[]>;
    recommend(settings: Record<string, unknown>): Promise<Recommendation[]>;
}

function compatibility(profile: OptimizationProfile, settings: Record<string, unknown>): { compatible: boolean; notes: string[] } {
    const notes: string[] = [];
    if ((profile.objective === 'latency' || profile.objective === 'gaming') && settings.fragmentMode === 'high') {
        notes.push('High fragmentation may increase setup latency; the profile lowers it.');
    }
    if (profile.objective === 'mobile' && settings.enableIPv6 !== true) {
        notes.push('IPv6 is currently off; enabling it can improve route availability while roaming.');
    }
    if (profile.objective === 'streaming' && Array.isArray(settings.ports) && settings.ports.length === 0) {
        notes.push('Select a TLS port before applying a streaming profile.');
        return { compatible: false, notes };
    }
    return { compatible: true, notes };
}

function projectedScore(profile: OptimizationProfile, changed: number, scan: ReturnType<typeof intelligenceFromHistory>): number {
    const baseline = scan.recommended?.score ?? 60;
    const objectiveLift: Record<OptimizationProfile['objective'], number> = { latency: 8, stability: 10, streaming: 7, gaming: 8, mobile: 6 };
    return Math.min(100, Math.round(baseline + objectiveLift[profile.objective] - Math.min(changed, 8) * 0.25));
}

export function createOptimizationService(presets: PresetRegistry, scanner: ScannerRepository): OptimizationService {
    const scanHistory = (): Promise<ScanRunSummary[]> => scanner.listRuns('clean-ip', 5);
    const evaluate = async (settings: Record<string, unknown>): Promise<ProfileEvaluation[]> => {
            const scan = intelligenceFromHistory(await scanHistory());
            return OPTIMIZATION_PROFILES.map(profile => {
                const application = presets.apply(profile.presetId, settings);
                const check = compatibility(profile, settings);
                const changed = application?.changed ?? [];
                const projected = projectedScore(profile, changed.length, scan);
                const baseline = scan.recommended?.score ?? null;
                const confidence = Math.round(Math.min(95, 45 + scan.confidence * 0.45 + Math.min(changed.length, 5) * 2));
                const rationale = [
                    ...check.notes,
                    baseline === null ? 'No scan baseline exists; the estimate uses configuration rules only.' : `Measured endpoint baseline is ${baseline}/100.`,
                    `The profile changes ${changed.length} setting(s) while preserving identity, ports and user routes.`,
                    `Projected quality is ${projected}/100 for the ${profile.objective} objective.`
                ];
                return { profile, compatible: check.compatible, score: projected, confidence, changed, rationale, baselineScore: baseline };
            }).sort((a, b) => Number(b.compatible) - Number(a.compatible) || b.score - a.score || b.confidence - a.confidence);
    };
    return {
        profiles: () => OPTIMIZATION_PROFILES,
        evaluate,
        async recommend(settings) {
            const [best] = (await evaluate(settings)).filter(item => item.compatible && item.changed.length > 0);
            if (!best) return [];
            const before = best.baselineScore;
            return [{
                id: `optimization.${best.profile.id}`,
                title: `Consider ${best.profile.title}`,
                rationale: best.rationale.join(' '),
                impact: best.score >= 80 ? 'medium' : 'low',
                fields: best.changed,
                evidence: {
                    confidence: best.confidence,
                    summary: before === null ? `Projected quality ${best.score}/100` : `Projected quality ${before}/100 → ${best.score}/100`,
                    before: before === null ? undefined : { quality: before },
                    after: { quality: best.score },
                    factors: best.rationale
                }
            }];
        }
    };
}

export function optimizationProvider(service: OptimizationService) {
    return { id: 'optimization', provide: ({ settings }: { settings: Record<string, unknown> }) => service.recommend(settings) };
}
