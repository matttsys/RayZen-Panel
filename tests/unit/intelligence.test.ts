import { describe, expect, it } from 'vitest';
import { actionInsights, summarise as summariseAnalytics } from '@features/analytics/service';
import { intelligenceFromHistory, intelligenceForRun } from '@features/scanner/intelligence';
import { createOptimizationService } from '@features/optimization/service';
import { CORE_PRESETS, createPresetRegistry } from '@features/presets/service';
import type { ScanRun, ScanRunSummary } from '#types/platform';

describe('Clean IP intelligence', () => {
    it('detects degradation and explains the comparison', () => {
        const runs: ScanRunSummary[] = [
            { id:'new', at:2, kind:'clean-ip', targets:4, healthy:2, best:{address:'1.1.1.1',score:70}, medianScore:60 },
            { id:'old', at:1, kind:'clean-ip', targets:4, healthy:4, best:{address:'1.1.1.1',score:88}, medianScore:80 }
        ];
        const result = intelligenceFromHistory(runs);
        expect(result.trend).toBe('degrading');
        expect(result.scoreDelta).toBe(-18);
        expect(result.reasons.join(' ')).toContain('-18');
    });

    it('attaches confidence and reasons to the recommended endpoint', () => {
        const run = { id:'r', at:1, kind:'clean-ip', dead:0, unmeasurable:[], ranked:[{ target:{address:'1.1.1.1',kind:'clean-ip'}, score:90, reliability:100, latency:90, stability:80, verdict:'good', result:{ target:{address:'1.1.1.1',kind:'clean-ip'}, attempts:[], successes:3,total:3,avgLatencyMs:80,jitterMs:4,at:1 } }] } as ScanRun;
        const result = intelligenceForRun(run);
        expect(result.recommended?.address).toBe('1.1.1.1');
        expect(result.confidence).toBeGreaterThan(50);
        expect(result.reasons.length).toBeGreaterThan(1);
    });
});

describe('adaptive analytics foundation', () => {
    it('turns weak scanner outcomes into an action instead of a chart', () => {
        const snapshot = { days:[{day:'2026-07-31',counters:{'scanner.probes':10,'scanner.healthy':3}}], totals:{'scanner.probes':10,'scanner.healthy':3} };
        expect(actionInsights(snapshot)[0].action).toMatch(/bounded Clean IP scan/);
    });
    it('computes recommendation effectiveness without identities', () => {
        const stats = summariseAnalytics({ days:[], totals:{'recommendation.accepted':3,'recommendation.dismissed':1} });
        expect(stats.recommendationAcceptanceRate).toBe(0.75);
    });
});

describe('smart configuration engine', () => {
    it('evaluates five objective profiles and explains every score', async () => {
        const scanner = {
            listRuns: async () => [], recordRun: async () => undefined, lastRunAt: async () => null,
            recordBlocks: async () => undefined, listBlocks: async () => [], clear: async () => undefined
        };
        const service = createOptimizationService(createPresetRegistry(CORE_PRESETS), scanner);
        const result = await service.evaluate({ ports:[443], fragmentMode:'high', enableIPv6:false });
        expect(result).toHaveLength(5);
        expect(result.every(item => item.rationale.length >= 2 && item.confidence > 0)).toBe(true);
    });
});


describe('scanner intelligence regressions', () => {
    it('does not recommend a dead top-ranked endpoint', () => {
        const run = {
            id: 'dead', kind: 'proxy-ip', startedAt: 1, completedAt: 2,
            ranked: [{ target: { address: '198.51.100.1', port: 443 }, score: 0, reliability: 0, latency: 0, stability: 0, verdict: 'dead', result: { target: { address: '198.51.100.1', port: 443 }, successes: 0, total: 3, avgLatencyMs: null, jitterMs: null, attempts: [] } }]
        } as never;
        expect(intelligenceForRun(run).recommended).toBeNull();
    });
});
