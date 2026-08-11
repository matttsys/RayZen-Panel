import type { EndpointIntelligence, ScanRun, ScanRunSummary, ScoredTarget } from '#types/platform';

const round = (value: number): number => Math.round(value * 10) / 10;
const clamp = (value: number): number => Math.max(0, Math.min(100, value));

/** Confidence is evidence quality, not a second endpoint score. */
export function targetConfidence(target: ScoredTarget, runnerUp?: ScoredTarget): number {
    const attempts = Math.min(target.result.total, 5) / 5;
    const successCoverage = target.result.total > 0 ? target.result.successes / target.result.total : 0;
    const separation = runnerUp ? Math.min(Math.max(target.score - runnerUp.score, 0) / 20, 1) : 0.5;
    const stabilityKnown = target.result.jitterMs === null ? 0.5 : 1;
    return round(clamp((attempts * 0.3 + successCoverage * 0.35 + separation * 0.2 + stabilityKnown * 0.15) * 100));
}

export function explainTarget(target: ScoredTarget, runnerUp?: ScoredTarget): string[] {
    const reasons = [
        `${target.reliability}% reliability across ${target.result.total} probe attempt(s)`,
        target.result.avgLatencyMs === null ? 'Latency could not be measured' : `${target.result.avgLatencyMs} ms average connect latency`,
        target.result.jitterMs === null ? 'Stability needs more samples' : `${target.result.jitterMs} ms jitter`
    ];
    if (runnerUp) reasons.push(`${round(target.score - runnerUp.score)} points ahead of the next endpoint`);
    return reasons;
}

export function intelligenceForRun(run: ScanRun): EndpointIntelligence {
    const best = run.ranked[0] ?? null;
    const runnerUp = run.ranked[1];
    if (!best || best.result.successes === 0) {
        return { recommended: null, confidence: 0, trend: 'unknown', scoreDelta: null, reasons: ['No endpoint completed a probe successfully.'] };
    }
    return {
        recommended: { address: best.target.address, score: best.score },
        confidence: targetConfidence(best, runnerUp),
        trend: 'unknown',
        scoreDelta: null,
        reasons: explainTarget(best, runnerUp)
    };
}

/** Compares bounded summaries; no raw endpoint or request history is retained. */
export function intelligenceFromHistory(runs: readonly ScanRunSummary[]): EndpointIntelligence {
    const latest = runs[0];
    if (!latest?.best) {
        return { recommended: null, confidence: 0, trend: 'unknown', scoreDelta: null, reasons: ['Run a bounded scan to establish endpoint quality.'] };
    }
    const priorScores = runs.slice(1, 5).flatMap(run => run.best ? [run.best.score] : []);
    const baseline = priorScores.length === 0
        ? null
        : [...priorScores].sort((a, b) => a - b)[Math.floor(priorScores.length / 2)];
    const delta = baseline === null ? null : round(latest.best.score - baseline);
    const sampleFactor = Math.min(runs.length / 5, 1);
    const coverage = latest.targets > 0 ? latest.healthy / latest.targets : 0;
    const volatility = priorScores.length < 2
        ? 0
        : Math.min((Math.max(...priorScores) - Math.min(...priorScores)) / 40, 1);
    const confidence = round(clamp((sampleFactor * 0.4 + coverage * 0.35 + (latest.best.score / 100) * 0.25 - volatility * 0.15) * 100));
    const trend = delta === null ? 'baseline' : delta <= -10 ? 'degrading' : delta >= 10 ? 'improving' : 'stable';
    const reasons = [
        `${latest.best.score}/100 endpoint quality in the latest bounded run`,
        `${latest.healthy} of ${latest.targets} candidates were healthy`,
        delta === null ? 'No historical baseline is available for comparison' : `${delta >= 0 ? '+' : ''}${delta} points versus the previous best`
    ];
    return { recommended: latest.best, confidence, trend, scoreDelta: delta, reasons };
}
