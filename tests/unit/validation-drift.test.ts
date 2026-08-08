/**
 * The label-drift test that `src/features/validation/service.ts` claims exists.
 *
 * That module's header says: "A test walks every validator's output and fails if a
 * label appears that this table does not know, so drift is caught by CI rather than
 * by a user seeing an unfocused form." Until this file, that test did not exist, so
 * the claimed guarantee was documentation only.
 *
 * Why the source is parsed rather than only exercised
 *
 * Tripping a validator proves one label is mapped. It cannot prove *completeness*:
 * a validator added tomorrow with a new label would emit an unmapped issue and no
 * dynamic test would notice, because no test would know to trip it. So the primary
 * assertion here reads `validators.ts` and extracts every label the file can
 * possibly attach to an error, then requires each one to be in `knownLabels()`.
 *
 * The extractor is deliberately strict in one direction: any `field:` expression it
 * cannot resolve to a concrete label fails the test rather than being skipped. A
 * silently-skipped indirection is exactly how a drift test rots into a no-op.
 *
 * A second block trips real validators and asserts the mapping resolves to a
 * specific code rather than the `validation.unmapped` fallback, which pins the
 * end-to-end path the panel actually uses.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { byField, knownLabels, toIssue, validate } from '@features/validation/service';
import type { ValidationError } from '@validators';
import type { PanelSettings } from '#types/settings';
import { initRequestGlobals, validSettingsForm } from '../helpers/worker';

const VALIDATORS_PATH = new URL('../../src/settings/validators.ts', import.meta.url);

beforeAll(async () => {
    // `validatePorts` reads `httpsPorts` from the module-scope request globals, and
    // `protocolLabels()` reads `_VL_CAP_` / `_TR_CAP_`, which `@settings` assigns as
    // an import side effect. Importing the helper is what triggers that.
    await initRequestGlobals();
});

/* ------------------------------------------------------------------ *
 * Static extraction
 * ------------------------------------------------------------------ */

/**
 * Every value assigned to a `field` property in `validators.ts`, as source text.
 *
 * Two spellings occur. `field: 'Remote DNS'` yields the literal; the shorthand
 * `errors.push({ field, message })` in `validateMinMax` yields `null`, meaning the
 * label came from a variable and must be resolved through the tuple table. The
 * `field: string;` member of the `ValidationError` interface is excluded: it is a
 * type declaration, not a label.
 */
function fieldExpressions(source: string): (string | null)[] {
    const expressions: (string | null)[] = [];

    for (const match of source.matchAll(/\bfield(?::\s*([^,\n]+)|\s*,)/g)) {
        if (match[1] === undefined) {
            expressions.push(null);
            continue;
        }

        const expression = match[1].trim().replace(/,$/, '');
        if (expression === 'string;') continue;
        expressions.push(expression);
    }

    return expressions;
}

/**
 * Labels reachable through a tuple table.
 *
 * Two validators declare their labels in `as const` tuple arrays and then push
 * `field: tag` or the `field` shorthand: `validateMinMax` uses
 * `['fragmentLengthMin', 'fragmentLengthMax', 'Fragment Length']` and
 * `validateCustomCdn` uses `['customCdnSni', 'Custom CDN SNI']`.
 *
 * A tuple qualifies only when its first element is a bare settings key and its last
 * element contains a space. Without both conditions the multi-line `message: [...]`
 * arrays elsewhere in the file would be mistaken for label tables, which is exactly
 * the false positive that would make this test fail for the wrong reason.
 */
function tupleLabels(source: string): string[] {
    const labels: string[] = [];

    for (const match of source.matchAll(/\[\s*((?:'[^']*'\s*,\s*)+'[^']*')\s*\]/g)) {
        const parts = match[1]
            .split(',')
            .map(part => part.trim())
            .filter(part => part.startsWith("'"))
            .map(part => part.slice(1, -1));

        const first = parts[0];
        const label = parts[parts.length - 1];
        if (!first || !label) continue;
        if (!/^[a-z][A-Za-z0-9]*$/.test(first)) continue;
        if (!/\s/.test(label)) continue;

        labels.push(label);
    }

    return labels;
}

/** Resolves the two template-literal labels against the live globals. */
function resolveTemplate(expression: string): string | null {
    const body = expression.slice(1, -1);
    const resolved = body
        .replace('${_VL_CAP_}', _VL_CAP_)
        .replace('${_TR_CAP_}', _TR_CAP_);

    return resolved.includes('${') ? null : resolved;
}

interface Extraction {
    labels: Set<string>;
    /** `field` expressions the extractor could not resolve. Must stay empty. */
    unresolved: string[];
    /** Indirections resolved through a tuple table, e.g. `tag` or the shorthand. */
    indirect: string[];
}

function extractLabels(source: string): Extraction {
    const labels = new Set<string>();
    const unresolved: string[] = [];
    const indirect: string[] = [];
    const fromTuples = tupleLabels(source);

    for (const expression of fieldExpressions(source)) {
        // The `{ field, message }` shorthand: the label is whatever the enclosing
        // tuple table holds, so every tuple label is treated as reachable.
        if (expression === null) {
            indirect.push('<shorthand>');
            for (const label of fromTuples) labels.add(label);
            continue;
        }

        if (expression.startsWith("'") && expression.endsWith("'")) {
            labels.add(expression.slice(1, -1));
            continue;
        }

        if (expression.startsWith('`') && expression.endsWith('`')) {
            const resolved = resolveTemplate(expression);
            if (resolved === null) unresolved.push(expression);
            else labels.add(resolved);
            continue;
        }

        // A bare identifier means the label came from a tuple table.
        if (/^[A-Za-z_$][\w$]*$/.test(expression)) {
            indirect.push(expression);
            for (const label of fromTuples) labels.add(label);
            continue;
        }

        unresolved.push(expression);
    }

    return { labels, unresolved, indirect };
}

const source = readFileSync(VALIDATORS_PATH, 'utf8');

describe('validation label drift', () => {
    it('the extractor resolves every `field:` expression in validators.ts', () => {
        // Guards the guard: an extractor that matched nothing, or that silently
        // dropped an indirection, would make the drift assertion below vacuous.
        const extraction = extractLabels(source);

        expect(extraction.unresolved).toEqual([]);
        expect(extraction.labels.size).toBeGreaterThan(30);
        // `validateCustomCdn` (`field: tag`) and `validateMinMax` (`field`) are the
        // only indirections today. A third one appearing is worth noticing, but it
        // is still resolved through the tuple table, so this is an equality check on
        // the known set rather than a count.
        expect([...new Set(extraction.indirect)].sort()).toEqual(['<shorthand>', 'tag']);
    });

    it('every label validators.ts can emit is mapped by the adapter', () => {
        const known = new Set(knownLabels());
        const emitted = [...extractLabels(source).labels].sort();

        const unmapped = emitted.filter(label => !known.has(label));

        // The failure message names the offending labels, because "add these to
        // STATIC_LABELS in src/features/validation/service.ts" is the entire fix.
        expect(unmapped).toEqual([]);
    });

    it('the two protocol labels are built from the live runtime globals', () => {
        // These are the labels most likely to drift undetected, because they are
        // template literals whose text does not appear anywhere in either file.
        expect(knownLabels()).toContain(`${_VL_CAP_} UUID`);
        expect(knownLabels()).toContain(`${_TR_CAP_} Password`);
    });

    it('declares no label the validators cannot emit', () => {
        // The reverse direction. A stale mapping is not a correctness bug the way an
        // unmapped label is, but it is dead weight in a bundle measured in kilobytes
        // and it misleads the next reader about what the validators produce.
        const emitted = extractLabels(source).labels;
        const orphaned = knownLabels().filter(label => !emitted.has(label));

        expect(orphaned).toEqual([]);
    });

    it('maps each label to a distinct code', () => {
        // Two labels sharing a code would make the code useless as an identity for a
        // translation catalogue or a per-field UI mapping.
        const codes = knownLabels().map(label => toIssue({ field: label, message: ['x'] }).code);

        expect(new Set(codes).size).toBe(codes.length);
    });

    it('never maps a known label to the unmapped fallback', () => {
        for (const label of knownLabels()) {
            const issue = toIssue({ field: label, message: ['x'] });
            expect(issue.code, label).not.toBe('validation.unmapped');
        }
    });

    it('every label names an input to focus, except the form-level backstop', () => {
        // A label with no `field` cannot be deep-linked, so the set of such labels is
        // pinned rather than left to grow. `Settings` is the aggregate's backstop for a
        // body that omitted a field entirely, and there is nothing to focus because the
        // input was never submitted; a panel shows it at form level.
        const fieldless = knownLabels().filter(
            label => toIssue({ field: label, message: ['x'] }).field === ''
        );

        expect(fieldless).toEqual(['Settings']);
    });
});

/* ------------------------------------------------------------------ *
 * Dynamic exercise
 * ------------------------------------------------------------------ */

function validateForm(overrides: Record<string, unknown>) {
    return validate({ ...validSettingsForm(), ...overrides } as unknown as PanelSettings);
}

/**
 * One input per validator that reaches a distinct label, chosen so a failure names
 * exactly one validator. `chainProxy` is excluded: `validators.ts:291` calls
 * `new URL()` on unvalidated input and throws for a malformed value, which
 * tests/unit/validators.test.ts already pins as a FINDING.
 */
const TRIPS: readonly { label: string; overrides: Record<string, unknown> }[] = [
    { label: 'Remote DNS', overrides: { remoteDNS: 'not a url' } },
    { label: 'Anti Sanction DNS', overrides: { antiSanctionDNS: 'not a host!' } },
    { label: 'Warp Remote DNS', overrides: { warpRemoteDNS: 'nope' } },
    { label: 'Local DNS', overrides: { localDNS: 'nope' } },
    { label: 'Routing Custom Rules', overrides: { customBypassRules: ['not a rule!'] } },
    { label: 'Routing Sanction Rules', overrides: { customBypassSanctionRules: ['not a domain!'] } },
    { label: 'Clean IPs - Domains', overrides: { cleanIPs: ['not a host!'] } },
    { label: 'Proxy IPs - Domains', overrides: { proxyIPs: ['not a host!'] } },
    { label: 'NAT64 Prefixes', overrides: { prefixes: ['not a prefix'] } },
    { label: 'Warp Endpoints', overrides: { warpEndpoints: ['no-port.example.com'] } },
    { label: 'Fragment Length', overrides: { fragmentLengthMin: 500, fragmentLengthMax: 100 } },
    { label: 'Fragment Delay', overrides: { fragmentDelayMin: 9, fragmentDelayMax: 1 } },
    { label: 'Fragment Max Split', overrides: { fragmentMaxSplitMin: 9, fragmentMaxSplitMax: 1 } },
    { label: 'MahsaNG Noise Count', overrides: { knockerNoiseCountMin: 9, knockerNoiseCountMax: 1 } },
    { label: 'MahsaNG Noise Size', overrides: { knockerNoiseSizeMin: 9, knockerNoiseSizeMax: 1 } },
    { label: 'MahsaNGNoise Delay', overrides: { knockerNoiseDelayMin: 9, knockerNoiseDelayMax: 1 } },
    { label: 'Amnezia Noise Size', overrides: { amneziaNoiseSizeMin: 9, amneziaNoiseSizeMax: 1 } },
    { label: 'Upstream Proxy', overrides: { upstreamProxy: 'no-port.example.com' } },
    {
        label: 'Custom CDN',
        overrides: { customCdnAddrs: ['cdn.example.com'], customCdnHost: '', customCdnSni: '' }
    },
    {
        label: 'Custom CDN SNI',
        overrides: {
            customCdnAddrs: ['cdn.example.com'],
            customCdnHost: 'host.example.com',
            customCdnSni: 'not a domain!'
        }
    },
    {
        label: 'Custom CDN Host',
        overrides: {
            customCdnAddrs: ['cdn.example.com'],
            customCdnHost: 'not a domain!',
            customCdnSni: 'sni.example.com'
        }
    },
    {
        label: 'Custom CDN Addresses',
        overrides: {
            customCdnAddrs: ['not a host!'],
            customCdnHost: 'host.example.com',
            customCdnSni: 'sni.example.com'
        }
    },
    { label: 'MahsaNG Noise', overrides: { knockerNoiseMode: 'not-a-mode' } },
    {
        label: 'Xray Noise Delay',
        overrides: { xrayUdpNoises: [{ type: 'rand', packet: '1-2', delay: '9-1', count: 1 }] }
    },
    {
        label: 'Xray Noise Packet',
        overrides: { xrayUdpNoises: [{ type: 'hex', packet: 'zz', delay: '1-2', count: 1 }] }
    },
    { label: 'ECH Server Name', overrides: { echServerName: 'not a domain!' } },
    { label: `${_VL_CAP_} UUID`, overrides: { vlUUID: 'not-a-uuid' } },
    { label: `${_TR_CAP_} Password`, overrides: { trPass: 'has spaces and #' } },
    { label: 'Fallback Domain', overrides: { fallback: 'not a domain!' } },
    { label: 'Underlying DoH URL', overrides: { dohUrl: 'http://example.com/other' } },
    { label: 'Panel - Subscriptions Path', overrides: { securePath: 'has spaces' } },
    { label: 'Custom Domain', overrides: { customDomain: 'not a domain!' } },
    { label: 'External Raw subscriptions', overrides: { customSubs: ['not a url'] } },
    { label: 'Remote Settings URL', overrides: { remoteSettings: 'not a url' } },
    { label: 'Ports', overrides: { ports: [80] } },
    // Trippable as of the guarded return in `validateChainProxy`. It used to throw,
    // which is why the coverage assertion below previously excluded it.
    { label: 'Chain Proxy', overrides: { chainProxy: 'garbage' } }
];

describe('validate() over real validator output', () => {
    it.each(TRIPS)('$label resolves to a specific code', ({ label, overrides }) => {
        const result = validateForm(overrides);

        expect(result.ok).toBe(false);

        const issue = result.issues.find(candidate => candidate.label === label);
        expect(issue, `no issue with label '${label}' was produced`).toBeDefined();
        expect(issue?.code).not.toBe('validation.unmapped');
        expect(issue?.field).not.toBe('');
        expect(issue?.severity).toBe('error');
    });

    it('every trip case above collectively covers every mapped label', () => {
        // Ties the dynamic block to the static one: if a label is mapped and reachable
        // through a settings value, there should be a trip for it. `Settings` is the
        // one exception, because it is only reachable by omitting a field rather than
        // by supplying a bad one, which the aggregate test in validators.test.ts
        // covers ("reports a partial body as a validation error rather than throwing").
        const tripped = new Set(TRIPS.map(trip => trip.label));
        const missing = knownLabels().filter(label => !tripped.has(label));

        expect(missing).toEqual(['Settings']);
    });

    it('returns ok with no issues for a valid form', () => {
        expect(validateForm({})).toEqual({ ok: true, issues: [] });
    });

    it('treats a null form as valid, matching validateSettings', () => {
        // `validateSettings(null)` returns null, which this adapter reads as "no
        // errors". Pinned because the alternative reading (null means "could not
        // validate") would need a third result state.
        expect(validate(null)).toEqual({ ok: true, issues: [] });
    });

    it('flattens a multi-line validator message into one collapsed line', () => {
        const result = validateForm({ cleanIPs: ['bad one!', 'bad two!'] });
        const issue = result.issues.find(candidate => candidate.label === 'Clean IPs - Domains');

        expect(issue?.message).not.toContain('\n');
        expect(issue?.message).not.toMatch(/ {2}/);
        expect(issue?.message).toContain('+ bad one!');
        expect(issue?.message).toContain('+ bad two!');
    });

    it('reports several independent issues from one form', () => {
        const result = validateForm({ localDNS: 'nope', warpRemoteDNS: 'nope' });

        expect(result.issues.map(issue => issue.code).sort()).toEqual([
            'dns.local-invalid',
            'dns.warp-remote-invalid'
        ]);
    });
});

describe('toIssue', () => {
    it('falls back to a generic code rather than dropping an unknown label', () => {
        // The fallback is the safety property: an unmapped label must still reach the
        // user, because losing a real validation failure would turn a cosmetic gap
        // into a correctness bug.
        const error: ValidationError = { field: 'Label From The Future', message: ['Broken.'] };
        const issue = toIssue(error);

        expect(issue).toEqual({
            code: 'validation.unmapped',
            field: '',
            label: 'Label From The Future',
            message: 'Broken.',
            severity: 'error'
        });
    });

    it('honours an explicit severity', () => {
        const issue = toIssue({ field: 'Ports', message: ['x'] }, 'warning');
        expect(issue.severity).toBe('warning');
    });

    it('drops blank message lines instead of emitting double spaces', () => {
        const issue = toIssue({ field: 'Ports', message: ['first', '   ', '', 'second'] });
        expect(issue.message).toBe('first second');
    });
});

describe('byField', () => {
    it('groups issues by settings key', () => {
        const grouped = byField([
            toIssue({ field: 'Ports', message: ['a'] }),
            toIssue({ field: 'Xray Noise Packet', message: ['b'] }),
            toIssue({ field: 'Xray Noise Delay', message: ['c'] })
        ]);

        // Both Xray noise labels intentionally map to `xrayUdpNoises`, so the panel
        // shows both messages against the one input that produced them.
        expect(grouped.get('ports')).toHaveLength(1);
        expect(grouped.get('xrayUdpNoises')).toHaveLength(2);
    });

    it('groups unmapped issues under the empty key rather than losing them', () => {
        const grouped = byField([toIssue({ field: 'Unknown', message: ['x'] })]);
        expect(grouped.get('')).toHaveLength(1);
    });

    it('returns an empty map for no issues', () => {
        expect(byField([]).size).toBe(0);
    });
});
