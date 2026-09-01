/**
 * Icon coverage and external-origin gates for the panel pages.
 *
 * Two invariants live here, both of which are otherwise unenforced:
 *
 * 1. Every icon name a page renders resolves to an outline the page ships, and every
 *    outline it ships is rendered somewhere. The pages used to embed a Material Symbols
 *    woff2 subset, where the glyph name *was* the element's text, so a name absent from
 *    the subset rendered as the literal word `content_copy` on a live page and nothing
 *    in the pipeline could see it. The icons are inline SVG now, which turns that into a
 *    blank box rather than English prose, and this turns it into a failing build.
 *
 * 2. The external-origin count per page never rises. This gate did not exist for a
 *    while, which is how the count drifted from three to five without anyone noticing.
 *
 * Both directions read the shipped files, so neither can drift from what ships.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS = join(import.meta.dirname, '..', '..', 'src', 'assets');

/** Pages that render icons from a table. */
const PAGES = ['panel', 'proxy-ip'] as const;

/**
 * `login` is deliberately absent. Its two icons are written inline at their call site,
 * because the password eye must be correct on the very first paint, and it has no table
 * for `availableIcons` to read. Its origin budget is still gated below.
 */

/** Every page, including the ones without a stylesheet, for the origin gate. */
const ALL_PAGES = ['panel', 'login', 'setup', 'proxy-ip', 'probe', 'error'] as const;

/** Reads one object-literal block's keys out of a shipped script. */
function literalKeys(script: string, name: string): Set<string> {
    const keys = new Set<string>();
    const start = script.indexOf(`const ${name} = {`);
    if (start < 0) return keys;

    const end = script.indexOf('\n};', start);
    // Comments are stripped first: every entry in these tables is preceded by a line
    // explaining what it draws, and `// Smart setup: guided intelligence.` reads as a key
    // named `setup` to a pattern looking for `name:`.
    const body = script
        .slice(start, end < 0 ? undefined : end)
        .replace(/\/\*[\s\S]*?\*\//gu, '')
        .replace(/^\s*\/\/[^\n]*/gmu, '');

    for (const match of body.matchAll(/(?:^|[\s{,])([a-z][a-z0-9_]*)\s*:/gmu)) keys.add(match[1]);
    return keys;
}

/**
 * Icon names a page can draw, from whichever inline tables that page defines.
 *
 * The panel has three: `RZ_ICON_PATHS` (RayZen's own, stroked, on a 24 grid),
 * `RZ_ICON_ALIASES` (Material names mapped onto those) and `RZ_GLYPH_PATHS` (Material
 * outlines extracted from the woff2 the panel used to embed, filled, on a 96 grid). The
 * other pages define one table each.
 */
function availableIcons(page: string): Set<string> {
    const script = readFileSync(join(ASSETS, page, 'script.js'), 'utf8');
    const names = new Set<string>();

    for (const block of ['RZ_ICON_PATHS', 'RZ_ICON_ALIASES', 'RZ_GLYPH_PATHS', 'ICON_PATHS']) {
        for (const key of literalKeys(script, block)) names.add(key);
    }
    return names;
}

/**
 * Icon names a page renders.
 *
 * Every construct that names an icon is matched, in markup and at runtime. Each pattern
 * is anchored on the construct rather than on a bare snake_case literal, so an unrelated
 * string is not mistaken for an icon name: a false positive fails "every icon resolves"
 * and a false negative fails "carries no unused outline".
 */
function usedIcons(page: string): Set<string> {
    const names = new Set<string>();
    const html = readFileSync(join(ASSETS, page, 'index.html'), 'utf8');

    // The markup names its icons in an attribute now, not in the element's text:
    //   <span class="rz-icon" data-icon="close" aria-hidden="true"></span>
    for (const match of html.matchAll(/data-icon="([a-z][a-z0-9_]*)"/gu)) names.add(match[1]);

    const script = readFileSync(join(ASSETS, page, 'script.js'), 'utf8');

    // createIcon('refresh') and rzIcon('info').
    for (const match of script.matchAll(
        /\b(?:createIcon|rzIcon)\(\s*['"]([a-z][a-z0-9_]*)['"]/gu
    )) {
        names.add(match[1]);
    }

    // rzPaintIcon(node, isPassword ? 'visibility' : 'visibility_off'): every literal in
    // the second argument is a glyph the call can draw.
    //
    // Comparison operands are stripped first. `t('setup')` and the other translated
    // single-word strings appear in ternaries elsewhere in the file, and reading them as
    // glyph names would demand outlines for icons nothing draws.
    for (const match of script.matchAll(/rzPaintIcon\([^,)]+,\s*([^)]+)\)/gu)) {
        const argument = match[1]
            .replace(/[=!]==?\s*['"][^'"]*['"]/gu, '')
            .replace(/\bt\(\s*['"][^'"]*['"]\s*\)/gu, '');
        for (const literal of argument.matchAll(/['"]([a-z][a-z0-9_]*)['"]/gu)) {
            names.add(literal[1]);
        }
    }

    // startWaiting(btn, '', 'refresh'): the third argument replaces the glyph.
    for (const match of script.matchAll(
        /startWaiting\(\s*[^,]+,\s*[^,]*,\s*['"]([a-z][a-z0-9_]*)['"]/gu
    )) {
        names.add(match[1]);
    }

    return names;
}

/** Strip CSS and HTML comments, so prose naming an origin is not counted as a load. */
function withoutComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/<!--[\s\S]*?-->/gu, '');
}

/**
 * Distinct external origins a page's shipped assets reference.
 *
 * `http://www.w3.org` is excluded: it appears only as the SVG namespace declaration,
 * which is an identifier and never fetched.
 */
function externalOrigins(page: string): Set<string> {
    const files = ['index.html', 'style.css', 'script.js'];
    const origins = new Set<string>();

    for (const file of files) {
        let text: string;
        try {
            text = readFileSync(join(ASSETS, page, file), 'utf8');
        } catch {
            continue; // `error` ships markup only.
        }
        for (const match of withoutComments(text).matchAll(/https?:\/\/[a-zA-Z0-9.-]+/gu)) {
            if (match[0] === 'http://www.w3.org') continue;
            origins.add(match[0]);
        }
    }
    return origins;
}

/**
 * The origin budget, ratchet-down-only.
 *
 * Every entry is a deliberate, reviewed dependency. Lower this when one is removed;
 * do not raise it. The two IP-echo services are the user-initiated "my IP" panel
 * feature. Everything else a page needs is embedded in the artifact: no fonts, no
 * icons, no scripts and no release feed are fetched from anywhere.
 *
 * The setup page is on this list deliberately. It is the one page a stranger might
 * reach before the deployment is claimed, so an outbound request from it would be an
 * outbound request nobody authorised.
 */
const ORIGIN_BUDGET: Record<string, string[]> = {
    panel: [
        'https://ipv4.geojs.io',
        'https://ipv4.icanhazip.com'
    ],
    login: [],
    setup: [],
    'proxy-ip': [],
    /**
     * The measurement frame connects to bare Cloudflare IP addresses at runtime, which
     * is its entire purpose, but it must reference no external *origin* in its markup:
     * no script, no stylesheet, no font. A third-party script in the one document with
     * a permissive `connect-src` would be the worst place in the product to have one.
     */
    probe: [],
    error: []
};

describe('inline icon coverage', () => {
    for (const page of PAGES) {
        it(`${page}: every icon the page renders has an outline`, () => {
            const used = usedIcons(page);
            expect(used.size, `${page} renders no icons, so the extractor is broken`)
                .toBeGreaterThan(0);

            const available = availableIcons(page);
            const missing = [...used].filter(name => !available.has(name)).sort();

            expect(
                missing,
                `${page} would draw an empty box for these. Add the outline with ` +
                '`python3 scripts/extract-glyphs.py`.'
            ).toEqual([]);
        });

        it(`${page}: carries no outline the page never renders`, () => {
            const script = readFileSync(join(ASSETS, page, 'script.js'), 'utf8');
            const used = usedIcons(page);

            // An alias is a name, not an outline: several exist so pre-RayZen call sites
            // keep working. They cost a few bytes each and are excluded from the waste
            // direction, but their *targets* count as rendered.
            const aliases = literalKeys(script, 'RZ_ICON_ALIASES');
            const aliasStart = script.indexOf('const RZ_ICON_ALIASES = {');
            if (aliasStart >= 0) {
                const body = script.slice(aliasStart, script.indexOf('\n};', aliasStart));
                for (const match of body.matchAll(/:\s*'([a-z][a-z0-9_]*)'/gu)) used.add(match[1]);
            }

            const extra = [...availableIcons(page)]
                .filter(name => !used.has(name) && !aliases.has(name))
                .sort();

            expect(
                extra,
                `${page} ships outlines nothing renders. Every path costs bundle bytes.`
            ).toEqual([]);
        });
    }

    it('no page embeds a font at all', () => {
        // The subsets cost 6,414 B and 1,542 B of page gzip. They are gone, `font-src`
        // is `'none'`, and this is what stops a future page quietly adding one back.
        for (const page of ALL_PAGES) {
            for (const asset of ['index.html', 'style.css']) {
                let text: string;
                try {
                    text = withoutComments(readFileSync(join(ASSETS, page, asset), 'utf8'));
                } catch {
                    continue; // `error` ships markup only.
                }
                expect(text, `${page}/${asset} declares a font-face`).not.toContain('@font-face');
                expect(text, `${page}/${asset}`).not.toContain('fonts.googleapis.com');
                expect(text, `${page}/${asset}`).not.toContain('fonts.gstatic.com');
            }
        }
    });
});

describe('external origin budget', () => {
    for (const page of ALL_PAGES) {
        it(`${page}: references no origin outside the recorded budget`, () => {
            const budget = ORIGIN_BUDGET[page];
            const actual = [...externalOrigins(page)].sort();
            const added = actual.filter(origin => !budget.includes(origin));

            expect(
                added,
                `${page} gained an external origin. Removing it is the default; ` +
                'adding one requires editing ORIGIN_BUDGET with a justification.'
            ).toEqual([]);
        });
    }

    it('no page loads a third-party script CDN', () => {
        for (const page of ALL_PAGES) {
            for (const origin of externalOrigins(page)) {
                expect(origin, `${page} imports from a script CDN`).not.toMatch(
                    /skypack|jsdelivr|unpkg|cdnjs|esm\.sh/u
                );
            }
        }
    });
});
