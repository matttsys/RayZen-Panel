/**
 * Validation framework: gives the existing validators a machine-readable output
 * without rewriting any of the 601 lines that already work.
 *
 * Why an adapter rather than A rewrite
 *
 * `src/settings/validators.ts` holds 24 validators and 110 passing tests. Its
 * output shape is `{ field: 'Remote DNS', message: string[] }`, where `field` is a
 * *display label* and the message array is prose aimed at a human reading a modal.
 * That shape has two problems for anything downstream:
 *
 *   1. The panel cannot focus the offending input, because `'Remote DNS'` is not
 *      `remoteDNS`. Today the UI shows a list of strings and the user hunts for the
 *      field themselves.
 *   2. Nothing can branch on *which* rule failed, because the identity of a failure
 *      is an English sentence. A localised UI, a diagnostics check, or an analytics
 *      counter would all have to string-match prose.
 *
 * Rewriting the validators to emit codes directly would be the cleaner end state
 * and the wrong move now: it would rewrite the one part of the settings path that
 * has real test coverage, and it would change 110 test expectations in the same
 * commit as a new subsystem. So this module wraps instead. `validateSettings`
 * remains the single source of validation logic and keeps its exact behaviour; this
 * layer adds identity on top.
 *
 * The label table below is the whole trick, and it is also the honest cost of the
 * approach: it must stay in step with the labels in `validators.ts`. A test walks
 * every validator's output and fails if a label appears that this table does not
 * know, so drift is caught by CI rather than by a user seeing an unfocused form.
 */

import type { IssueSeverity, ValidationIssue, ValidationResult } from '#types/platform';
import type { PanelSettings } from '#types/settings';
import { validateSettings, type ValidationError } from '@validators';

/**
 * Maps a validator's display label to a stable code and the settings key it
 * concerns.
 *
 * `code` is `<area>.<rule>` and never changes once shipped: it is what a future
 * translation catalogue and any per-field UI mapping key off.
 *
 * `field` is the settings property name. Where a label covers several properties
 * (a min/max pair, or the three Custom CDN inputs) it names the one the panel
 * should focus, which is the first of the group.
 */
interface LabelMapping {
    code: string;
    field: string;
}

/**
 * Two labels are built from runtime globals (`_VL_CAP_`, `_TR_CAP_`), which is how
 * `validators.ts` writes them. They are resolved lazily rather than at module load
 * so this module does not depend on global initialisation order.
 */
function protocolLabels(): Record<string, LabelMapping> {
    return {
        [`${_VL_CAP_} UUID`]: { code: 'protocol.uuid-invalid', field: 'vlUUID' },
        [`${_TR_CAP_} Password`]: { code: 'protocol.password-charset', field: 'trPass' }
    };
}

const STATIC_LABELS: Record<string, LabelMapping> = {
    // DNS
    'Remote DNS': { code: 'dns.remote-invalid', field: 'remoteDNS' },
    'Anti Sanction DNS': { code: 'dns.anti-sanction-invalid', field: 'antiSanctionDNS' },
    'Warp Remote DNS': { code: 'dns.warp-remote-invalid', field: 'warpRemoteDNS' },
    'Local DNS': { code: 'dns.local-invalid', field: 'localDNS' },
    'Underlying DoH URL': { code: 'dns.doh-url-invalid', field: 'dohUrl' },

    // Routing
    'Routing Custom Rules': { code: 'routing.custom-rules-invalid', field: 'customBypassRules' },
    'Routing Sanction Rules': { code: 'routing.sanction-rules-invalid', field: 'customBypassSanctionRules' },

    // Addresses
    'Clean IPs - Domains': { code: 'address.clean-ips-invalid', field: 'cleanIPs' },
    'Proxy IPs - Domains': { code: 'address.proxy-ips-invalid', field: 'proxyIPs' },
    'NAT64 Prefixes': { code: 'address.nat64-prefixes-invalid', field: 'prefixes' },
    'Warp Endpoints': { code: 'address.warp-endpoints-invalid', field: 'warpEndpoints' },
    'Fallback Domain': { code: 'address.fallback-invalid', field: 'fallback' },
    'Custom Domain': { code: 'address.custom-domain-invalid', field: 'customDomain' },

    // Proxies
    'Upstream Proxy': { code: 'proxy.upstream-invalid', field: 'upstreamProxy' },
    'Chain Proxy': { code: 'proxy.chain-invalid', field: 'chainProxy' },

    // CDN
    'Custom CDN': { code: 'cdn.incomplete', field: 'customCdnAddrs' },
    'Custom CDN SNI': { code: 'cdn.sni-invalid', field: 'customCdnSni' },
    'Custom CDN Host': { code: 'cdn.host-invalid', field: 'customCdnHost' },
    'Custom CDN Addresses': { code: 'cdn.addresses-invalid', field: 'customCdnAddrs' },

    // Noise and obfuscation
    'MahsaNG Noise': { code: 'noise.knocker-invalid', field: 'knockerNoiseMode' },
    'Xray Noise Delay': { code: 'noise.xray-delay-invalid', field: 'xrayUdpNoises' },
    'Xray Noise Packet': { code: 'noise.xray-packet-invalid', field: 'xrayUdpNoises' },
    'ECH Server Name': { code: 'tls.ech-server-name-invalid', field: 'echServerName' },

    // Min/max pairs. The focus target is the `Min` input of each pair.
    'Fragment Length': { code: 'range.fragment-length', field: 'fragmentLengthMin' },
    'Fragment Delay': { code: 'range.fragment-delay', field: 'fragmentDelayMin' },
    'Fragment Max Split': { code: 'range.fragment-max-split', field: 'fragmentMaxSplitMin' },
    'MahsaNG Noise Count': { code: 'range.knocker-noise-count', field: 'knockerNoiseCountMin' },
    'MahsaNG Noise Size': { code: 'range.knocker-noise-size', field: 'knockerNoiseSizeMin' },
    // Spelling matches validators.ts verbatim, including the missing space. Fixing
    // the label there is a UI change and belongs in a UI commit, not this one.
    'MahsaNGNoise Delay': { code: 'range.knocker-noise-delay', field: 'knockerNoiseDelayMin' },
    'Amnezia Noise Size': { code: 'range.amnezia-noise-size', field: 'amneziaNoiseSizeMin' },

    // Panel and subscriptions
    'Panel - Subscriptions Path': { code: 'panel.secure-path-invalid', field: 'securePath' },
    'External Raw subscriptions': { code: 'subscription.external-invalid', field: 'customSubs' },
    'Remote Settings URL': { code: 'settings.remote-url-invalid', field: 'remoteSettings' },
    'Ports': { code: 'transport.ports-invalid', field: 'ports' },

    // The aggregate's backstop. `validateSettings` wraps each validator, so a body
    // missing a field is reported here rather than thrown, and this is the one label
    // that names no single input. `field` is empty on purpose: there is nothing for a
    // UI to focus, because the failure is that the request did not carry the field at
    // all. A panel that receives this should show it at form level.
    'Settings': { code: 'settings.malformed', field: '' }
};

/** Every label this adapter recognises. Used by the drift test. */
export function knownLabels(): string[] {
    return [...Object.keys(STATIC_LABELS), ...Object.keys(protocolLabels())];
}

function resolve(label: string): LabelMapping {
    const mapping = STATIC_LABELS[label] ?? protocolLabels()[label];
    if (mapping) return mapping;

    // An unmapped label must still reach the user. Losing a real validation
    // failure because this table is stale would turn a cosmetic gap into a
    // correctness bug, so fall back to a generic code and keep the message.
    return { code: 'validation.unmapped', field: '' };
}

/**
 * Flattens a validator's `string[]` message into one line.
 *
 * The arrays are written for a `<br>`-joined modal: a summary sentence, then
 * instructions, then a bulleted list of offending values. Joining with a space
 * preserves the information and keeps `ValidationIssue.message` a single string,
 * which is what a form-field error slot can render.
 */
function flatten(message: string[]): string {
    return message
        .map(line => line.trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ');
}

/** Converts one legacy error into one issue. Exported for focused testing. */
export function toIssue(error: ValidationError, severity: IssueSeverity = 'error'): ValidationIssue {
    const { code, field } = resolve(error.field);

    return {
        code,
        field,
        label: error.field,
        message: flatten(error.message),
        severity
    };
}

/**
 * Validates settings and returns machine-readable issues.
 *
 * Every issue from the legacy validators is `error` severity, because every one of
 * them already blocks the write. Warnings are a separate concern: they come from
 * the diagnostics engine, which inspects settings that are *valid* but unwise.
 * Mixing the two here would let a warning block a save.
 */
export function validate(settings: PanelSettings | null): ValidationResult {
    const errors = validateSettings(settings);
    if (!errors) return { ok: true, issues: [] };

    const issues = errors.map(error => toIssue(error));
    return { ok: false, issues };
}

/** Groups issues by settings key, for a UI that renders errors next to inputs. */
export function byField(issues: readonly ValidationIssue[]): Map<string, ValidationIssue[]> {
    const grouped = new Map<string, ValidationIssue[]>();

    for (const issue of issues) {
        const existing = grouped.get(issue.field);
        if (existing) existing.push(issue);
        else grouped.set(issue.field, [issue]);
    }

    return grouped;
}
