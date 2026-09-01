/**
 * "Optimize My Connection": one recommendation, built only from things that were measured.
 *
 * What separates this from the profile evaluator next to it
 *
 * `service.ts` scores five objective profiles against the current settings. It is useful
 * and it is mostly rules: it knows that high fragmentation costs setup latency, and it
 * projects a score from a baseline. That is a reasonable thing to offer and it is not
 * evidence.
 *
 * This module refuses to say anything it has not measured. Every line of its output is
 * traceable to a device-side scan, a diagnostics finding, or a setting the operator can
 * see. When there is nothing measured, it says so and stops, because a recommendation
 * that appears without evidence is the thing that makes people stop trusting the ones
 * that have it.
 *
 * Why it does not apply anything
 *
 * It stages. The panel places the change in the configuration form and the operator
 * presses Save. A tool that silently rewrote the working configuration of a connection
 * someone depends on, based on a thirty-second measurement, would be worse than no tool.
 */
import type { BlockKnowledge } from './blocks';
import type { DiagnosticFinding } from '#types/platform';

/** One thing to change, with the measurement that justifies it. */
export interface OptimizationStep {
    /** Settings field this concerns, or null for advice with no single field. */
    field: string | null;
    /** What to do, in the imperative. */
    action: string;
    /** The measurement behind it. Never a general claim. */
    evidence: string;
    /** Value to stage, when there is exactly one defensible answer. */
    value?: string | number | boolean;
    /** How much this is expected to matter, from the size of the measured effect. */
    impact: 'high' | 'medium' | 'low';
}

export interface OptimizationPlan {
    /** True when at least one measurement was available. */
    grounded: boolean;
    /** One sentence stating what is known, or that nothing is. */
    summary: string;
    steps: OptimizationStep[];
    /** What was actually measured, so the operator can judge the basis. */
    basis: string[];
}

export interface OptimizationInput {
    /** Learned address-block knowledge from device scans. */
    blocks: readonly BlockKnowledge[];
    /** Diagnostics findings, which are already derived from real settings. */
    findings: readonly DiagnosticFinding[];
    /** The settings as configured. */
    settings: {
        cleanIPs?: readonly string[];
        ports?: readonly number[];
        protocols?: readonly string[];
        fragmentMode?: string;
        enableIPv6?: boolean;
        remoteDNS?: string;
    };
    /** Best address from the most recent device scan, when there was one. */
    /**
     * Best address from the most recent device scan.
     *
     * `latency` is nullable because the winner's own /24 is frequently absent from stored
     * block history: only blocks with two or more measured addresses are kept. Citing a
     * different block's latency instead would make the evidence wrong, so it is omitted.
     */
    bestAddress?: { address: string; latency: number | null; score: number } | null;
}

/** TLS ports, which survive inspection that plaintext ports do not. */
const TLS_PORTS = [443, 8443, 2053, 2083, 2087, 2096];

/**
 * Builds the plan.
 *
 * The ordering rule is measured effect size, not category: a 40 ms latency gain outranks
 * a fragmentation setting whose benefit is real but unquantified here.
 */
export function buildOptimizationPlan(input: OptimizationInput): OptimizationPlan {
    const steps: OptimizationStep[] = [];
    const basis: string[] = [];

    const confident = input.blocks.filter(block => block.confidence >= 0.5);
    const measuredBlocks = input.blocks.length;

    if (measuredBlocks > 0) {
        basis.push(
            `${measuredBlocks} address block${measuredBlocks === 1 ? '' : 's'} measured from this device`
            + (confident.length ? `, ${confident.length} with repeat observations` : ', none yet repeated')
        );
    }

    // 1. The endpoint, which is the measurement with the largest effect and the only one
    // this module can quantify end to end.
    if (input.bestAddress) {
        const configured = input.settings.cleanIPs ?? [];
        const alreadyUsing = configured.includes(input.bestAddress.address);

        if (!alreadyUsing) {
            const latency = input.bestAddress.latency;
            steps.push({
                field: 'cleanIPs',
                action: `Use ${input.bestAddress.address} as a clean IP`,
                evidence: (latency === null
                    ? `It scored ${input.bestAddress.score} of 100 from this network, the best of the addresses measured`
                    : `It answered in ${Math.round(latency)}ms from this network, scoring ${input.bestAddress.score} of 100`)
                    + (configured.length ? `, against ${configured.length} address(es) currently configured.` : '.'),
                value: input.bestAddress.address,
                // Without a latency figure the impact claim rests on the score alone, so
                // it is reported as medium rather than inferred as high.
                impact: latency !== null && latency <= 40 ? 'high' : 'medium'
            });
        }
        basis.push(input.bestAddress.latency === null
            ? `fastest measured address ${input.bestAddress.address}`
            : `fastest measured address ${input.bestAddress.address} at ${Math.round(input.bestAddress.latency)}ms`);
    }

    // 2. A block-level recommendation, but only where repetition makes it evidence. A
    // single scan naming a block is a coincidence with a number attached.
    if (confident.length > 0) {
        const best = confident[0];
        steps.push({
            field: null,
            action: `Prefer addresses in ${best.block}`,
            evidence: `That block has measured best across ${best.observations} scans on `
                + `${best.days} day${best.days === 1 ? '' : 's'}, median ${best.latency}ms. `
                + 'Individual addresses come and go; the block is the stabler bet.',
            impact: 'medium'
        });
    }

    // 3. Findings, which are already measured facts about the configuration. Only those
    // that failed: a warning is advice and this list is for things that are wrong.
    for (const finding of input.findings) {
        if (finding.status !== 'fail') continue;
        steps.push({
            field: null,
            action: finding.remediation ?? `Resolve: ${finding.title}`,
            // The check's own title is included. A finding's `detail` can be as short as
            // "No password is set.", which is true but does not say what was examined,
            // and a step whose evidence needs the surrounding UI to make sense is a step
            // that will be misread when it appears anywhere else.
            evidence: `${finding.title}: ${finding.detail}`,
            impact: 'high'
        });
    }

    // 4. Ports. A configuration with no TLS port works until the first middlebox looks at
    // it, which is a statement about this deployment rather than a general rule.
    const ports = input.settings.ports ?? [];
    if (ports.length > 0 && !ports.some(port => TLS_PORTS.includes(port))) {
        steps.push({
            field: 'ports',
            action: 'Add a TLS port such as 443',
            evidence: `The ${ports.length} configured port(s) are all plaintext, so the connection is `
                + 'distinguishable from ordinary HTTPS by inspection.',
            value: 443,
            impact: 'high'
        });
    }

    if (ports.length) basis.push(`${ports.length} configured port(s)`);
    if (input.findings.length) basis.push(`${input.findings.length} diagnostic check(s)`);

    const grounded = measuredBlocks > 0 || Boolean(input.bestAddress) || input.findings.length > 0;

    return {
        grounded,
        // `hasMeasured` rather than "a best address exists": blocks can be learned from a
        // scan whose run summary has since been pruned, and in that case the operator has
        // scanned and needs the "scan again on another day" advice, not "run a scan".
        summary: summarise(grounded, steps, Boolean(input.bestAddress) || measuredBlocks > 0, confident.length),
        // Highest measured impact first, and stable within a tier so the list does not
        // reshuffle between identical runs.
        steps: steps.sort((a, b) => rank(b.impact) - rank(a.impact)),
        basis
    };
}

function rank(impact: OptimizationStep['impact']): number {
    return impact === 'high' ? 3 : impact === 'medium' ? 2 : 1;
}

function summarise(
    grounded: boolean,
    steps: readonly OptimizationStep[],
    hasScan: boolean,
    confidentBlocks: number
): string {
    if (!grounded) {
        return 'Nothing has been measured on this deployment yet. Run a device scan, and this '
            + 'will recommend changes based on what it finds rather than on general advice.';
    }
    // The "nothing to change" and "here is what to change" branches share the same
    // follow-up advice, because in both cases more measurement is what would improve the
    // answer. Keeping it in one place is why this is assembled rather than returned early.
    const parts = steps.length
        ? [`${steps.length} change${steps.length === 1 ? '' : 's'} ${steps.length === 1 ? 'is' : 'are'} supported by measurement.`]
        : [hasScan
            ? 'Your configuration already matches what the measurements suggest. Nothing to change.'
            : 'No change is justified by the evidence available.'];

    if (!hasScan) {
        parts.push('Run a device scan to add endpoint recommendations, which need your own network to measure.');
    } else if (confidentBlocks === 0) {
        parts.push('Scan again on another day to turn the block ranking into evidence rather than a single sample.');
    }
    return parts.join(' ');
}
