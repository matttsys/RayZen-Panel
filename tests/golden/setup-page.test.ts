/**
 * The setup page's markup and script have to agree, and nothing checks that at runtime.
 *
 * The page is rendered exactly once per deployment, on a Worker nobody has signed in to
 * yet. If its script reaches for an element that the markup does not have, the form
 * silently stops working, the operator never gets their panel URL, and the only way out
 * is deleting a KV key they do not know about. There is no second attempt and no error
 * anybody sees.
 *
 * So the agreement is asserted statically here: every id the script looks up exists in
 * the markup, and every placeholder the handler substitutes exists in the page. Both
 * directions, because an orphan placeholder is a literal `__TOKEN_REQUIRED__` rendered
 * to a stranger.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS = join(import.meta.dirname, '..', '..', 'src', 'assets');
const SETUP = join(ASSETS, 'setup');
const HANDLER = join(import.meta.dirname, '..', '..', 'src', 'handlers', 'setup.ts');

const html = readFileSync(join(SETUP, 'index.html'), 'utf8');
const script = readFileSync(join(SETUP, 'script.js'), 'utf8');
const style = readFileSync(join(SETUP, 'style.css'), 'utf8');
const handler = readFileSync(HANDLER, 'utf8');

/** Ids present in the markup. */
const markupIds = new Set(
    [...html.matchAll(/\bid="([^"]+)"/gu)].map(match => match[1])
);

/** Ids the script looks up. */
const scriptIds = new Set(
    [...script.matchAll(/getElementById\(\s*'([^']+)'/gu)].map(match => match[1])
);

describe('the setup page is internally consistent', () => {
    it('every id the script looks up exists in the markup', () => {
        const missing = [...scriptIds].filter(id => !markupIds.has(id)).sort();
        expect(missing, 'the setup form would silently fail for these').toEqual([]);
    });

    it('the script reads more than one id, so the extractor is not vacuously passing', () => {
        expect(scriptIds.size).toBeGreaterThan(5);
    });

    it('the form and the fields it submits are present', () => {
        for (const id of ['setupForm', 'email', 'password', 'setupError']) {
            expect(markupIds, `#${id}`).toContain(id);
        }
    });

    it('carries the release marker checked by the deployment wizard', () => {
        expect(html).toContain('data-rayzen-setup-build="__SETUP_BUILD_MARKER__"');
    });

    it('never exposes the internal first-run setup capability as a form field', () => {
        expect(markupIds).not.toContain('token');
        expect(html).not.toContain('Setup token');
        expect(html).not.toContain('RAYZEN_SETUP_TOKEN');
        expect(script).not.toMatch(/setupToken|setupCapability|#setup=/u);
    });

    it('the success panel the script reveals is present', () => {
        for (const id of ['setupDone', 'panelUrl', 'openPanel', 'doneUser', 'copyUrl']) {
            expect(markupIds, `#${id}`).toContain(id);
        }
    });

    it('explains why the email field is read-only when the address is pinned', () => {
        // A read-only field with no explanation is a field people try to type into, and
        // the styling alone does not say who fixed the value or where.
        expect(markupIds).toContain('emailPinned');
        expect(html).toContain('RAYZEN_ADMIN_EMAIL');
        expect(style, 'a read-only field must not look editable').toMatch(/input\[readonly\]/u);
    });
});

describe('the handler and the page agree on placeholders', () => {
    const placeholders = ['__ICON__', '__EMAIL_FIXED__', '__EMAIL_VALUE__'];

    it.each(placeholders)('%s appears in the page and is substituted by the handler', placeholder => {
        expect(html, 'the page does not carry it').toContain(placeholder);
        expect(handler, 'the handler does not substitute it').toContain(placeholder);
    });

    it('the page carries no placeholder the handler does not substitute', () => {
        // An unsubstituted placeholder is rendered literally to whoever opens the page.
        const inPage = [...html.matchAll(/__[A-Z_]+__/gu)].map(match => match[0]);
        const orphans = [...new Set(inPage)]
            .filter(name => !['__VERSION__', '__SETUP_BUILD_MARKER__'].includes(name) && !handler.includes(name))
            .sort();

        // Build-owned placeholders are substituted before the page is compressed.
        expect(orphans).toEqual([]);
    });

    it('the version placeholder is present for the build to substitute', () => {
        expect(html).toContain('__VERSION__');
    });
});

describe('the setup page is self-contained', () => {
    it('references no external origin', () => {
        // It is the one page a stranger might reach before the deployment is claimed,
        // so an outbound request from it is a request nobody authorised.
        const withoutComments = (text: string) =>
            text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/<!--[\s\S]*?-->/gu, '');

        for (const [name, text] of [['index.html', html], ['style.css', style], ['script.js', script]] as const) {
            const origins = [...withoutComments(text).matchAll(/https?:\/\/[a-zA-Z0-9.-]+/gu)]
                .map(match => match[0])
                .filter(origin => origin !== 'http://www.w3.org');
            expect(origins, `${name} reaches off-origin`).toEqual([]);
        }
    });

    it('has no inline event handlers, which the strict CSP would block', () => {
        expect(html).not.toMatch(/\son[a-z]+\s*=/u);
    });

    it('draws the wordmark once and references it, rather than inlining it twice', () => {
        // The path is 13 KB. Two copies would be 13 KB of artifact for a page most
        // deployments render exactly once.
        const paths = html.match(/<path d="/gu) ?? [];
        const uses = html.match(/<use href="#rzWordmark"/gu) ?? [];

        expect(html).toContain('<symbol id="rzWordmark"');
        expect(uses.length).toBeGreaterThan(1);
        // The remaining paths are the small inline UI icons, not the wordmark.
        expect(paths.filter(() => true).length).toBeLessThan(12);
    });

    it('sizes the referenced wordmark, since <use> has no intrinsic dimensions', () => {
        expect(style).toContain('.rz-wordmark');
        expect(style).toMatch(/aspect-ratio\s*:/u);
    });
});


/**
 * Two hazards that only a browser reveals, asserted statically for every page.
 *
 * Both were live faults on the setup page, found by rendering it in Chromium:
 *
 *  1. `hidden` is a UA-stylesheet rule, so any author rule that sets `display` beats
 *     it. Pages that use hidden state therefore need an explicit author-level rule.
 *  2. A `style=` attribute is not covered by a CSP style hash, so the browser refuses
 *     to apply it. The sprite holding the wordmark carried `style="position:absolute"`
 *     and was therefore in flow, and the console filled with CSP violations.
 *
 * Neither produced an exception, an error page or a failing test. The first looked like
 * a form field and the second like a layout choice.
 */
describe('every page survives its own strict CSP and the hidden attribute', () => {
    const pages = ['panel', 'login', 'setup', 'proxy-ip', 'error'] as const;

    it.each(pages)('%s uses no style attribute, which the CSP would refuse', page => {
        let markup: string;
        try {
            markup = readFileSync(join(ASSETS, page, 'index.html'), 'utf8');
        } catch {
            return;
        }

        // Matched on the attribute, not the substring: `stroke-linestyle="..."` and the
        // word "style" inside a `<style>` tag are both legitimate.
        expect(markup, `${page} carries a style attribute`).not.toMatch(/\s+style\s*=\s*["']/u);
    });

    it.each(pages)('%s defines [hidden] when it relies on the attribute', page => {
        let markup: string;
        let style: string;
        try {
            markup = readFileSync(join(ASSETS, page, 'index.html'), 'utf8');
            style = readFileSync(join(ASSETS, page, 'style.css'), 'utf8');
        } catch {
            return; // `error` ships markup only and hides nothing.
        }

        // The bare boolean attribute, not `aria-hidden`.
        const usesHidden = /<[^>]*\shidden(?=[\s>])/u.test(markup);
        if (!usesHidden) return;

        expect(
            style,
            `${page} hides elements with the hidden attribute but its stylesheet has no ` +
            '[hidden] rule, so any author display rule will override it'
        ).toMatch(/\[hidden\]/u);
    });
});

describe('setup build safety', () => {
    it('uses one identifier-preserving JavaScript minifier for every page', () => {
        const build = readFileSync(join(import.meta.dirname, '..', '..', 'scripts', 'build.js'), 'utf8');
        expect(build).toContain('minifyIdentifiers: false');
        expect(build).not.toContain("dir === 'setup' ? script");
        expect(build).not.toContain('html-minifier-terser');
        expect(build).not.toContain('terser');
    });
});
