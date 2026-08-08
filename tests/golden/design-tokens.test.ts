/**
 * The design-token contract.
 *
 * The panel's stylesheet grew in two passes and ended up with two independent token
 * layers: a `--color-*` set and a `--rz-*` set, each defining its own colors. The
 * seven themes only overrode the accent primitive that the *first* layer read, so
 * picking Ocean or Lavender changed a handful of elements and left the rest forest
 * green. Dark mode had the same shape of bug in reverse: it redefined the three
 * `-soft` status fills but not the three status text colors, so `--rz-good` kept its
 * light-mode value on a dark surface and measured 2.58:1.
 *
 * Both layers are now views of one set of primitives, and the accent and status
 * values are *solved* for contrast by `scripts/gen-tokens.py` rather than chosen.
 * These tests hold that line, because it is the sort of thing that decays one
 * convenient hex at a time.
 *
 * What is deliberately not asserted here: how anything looks. Contrast against real
 * rendered backgrounds needs a browser, since `color-mix()` only resolves in one.
 * That check lives outside the suite; this file guards the invariants that are true
 * of the text of the stylesheet.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = join(import.meta.dirname, '..', '..', 'src', 'assets', 'panel', 'style.css');
const css = readFileSync(CSS, 'utf8');

/**
 * The generated token block, which is the one place a literal color may appear.
 *
 * Bounded by the last declaration the generator emits, so the split cannot drift
 * silently: if that declaration is renamed, this throws instead of quietly treating
 * the whole file as the token block.
 */
const TOKEN_BLOCK_END = '--rz-on-accent:';

function splitAtTokenBlock(): { tokens: string; components: string } {
    const marker = css.indexOf(TOKEN_BLOCK_END);
    expect(marker, `the stylesheet no longer contains ${TOKEN_BLOCK_END}`).toBeGreaterThan(0);
    const close = css.indexOf('\n}', marker);
    return { tokens: css.slice(0, close), components: css.slice(close) };
}

const { tokens, components } = splitAtTokenBlock();

/** Every custom property the stylesheet defines, anywhere. */
const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/gu)].map(match => match[1]));

/** Every custom property the stylesheet reads. */
const used = new Set([...css.matchAll(/var\(\s*(--[\w-]+)/gu)].map(match => match[1]));

/**
 * Properties set from JavaScript rather than declared in CSS.
 *
 * `--score` is written by `script.js` as an inline style to drive the conic-gradient
 * ring, so it is legitimately read with a fallback and never declared here.
 */
const SET_FROM_SCRIPT = new Set(['--score']);

const THEMES = ['forest', 'aurora', 'ocean', 'midnight', 'lavender', 'sunset', 'tropical'];

describe('components never name their own colors', () => {
    it('no hex literal appears outside the token block', () => {
        // A component-level hex is invisible to the theme and mode axes: it looks
        // right in whichever combination the author had open and wrong in the other
        // thirteen. Thirty-four distinct literals had accumulated this way.
        const hexes = [...components.matchAll(/#[0-9a-fA-F]{3,8}\b/gu)].map(match => match[0]);

        expect(hexes, 'move these into the token block or express them as a color-mix of a token').toEqual([]);
    });

    it('no opaque rgb() literal appears outside the token block', () => {
        // `rgba(0,0,0,.06)` as a shadow is fine and common: it tints whatever is
        // beneath it and works in both modes. An *opaque* rgb() is a color choice and
        // has the same problem as a hex.
        const opaque = [...components.matchAll(/\brgba?\(([^)]*)\)/gu)]
            .map(match => match[0])
            .filter(value => {
                const parts = value.replace(/^rgba?\(|\)$/gu, '').split(/[,/]/u);
                if (parts.length < 4) return true;
                return Number(parts[3]) >= 0.95;
            });

        expect(opaque).toEqual([]);
    });
});

describe('every token that is read is defined', () => {
    it('no var() names a property nothing declares', () => {
        // `--rz-brand` was read by `.rz-evidence strong` and declared nowhere, with no
        // fallback, so that text rendered with no color at all.
        const missing = [...used].filter(token => !defined.has(token) && !SET_FROM_SCRIPT.has(token)).sort();

        expect(missing).toEqual([]);
    });

    it('no token is read with a hardcoded fallback', () => {
        // `var(--rz-accent, #2f6a4f)` silently wins if the token is ever renamed, which
        // is the failure mode a fallback is supposed to prevent and instead conceals.
        const withFallback = [...components.matchAll(/var\(\s*(--[\w-]+)\s*,\s*(#[0-9a-fA-F]+|rgba?\()/gu)]
            .map(match => match[1]);

        expect([...new Set(withFallback)]).toEqual([]);
    });
});

describe('the theme axis reaches every theme', () => {
    it.each(THEMES)('%s defines its own accent in both modes', theme => {
        // Forest is the default identity and is declared on bare `:root`, so its
        // selector has no theme attribute.
        const selector = theme === 'forest' ? String.raw`:root` : String.raw`:root\[data-theme="${theme}"\]`;
        const light = new RegExp(`${selector}:not\\(\\[data-mode="dark"\\]\\)\\s*\\{[^}]*--rz-p-accent:`, 'u');
        const dark = new RegExp(`${selector}\\[data-mode="dark"\\]\\s*\\{[^}]*--rz-p-accent:`, 'u');

        expect(light.test(tokens), `${theme} has no light accent`).toBe(true);
        expect(dark.test(tokens), `${theme} has no dark accent`).toBe(true);
    });

    it('every theme also has an accent when the OS asks for dark', () => {
        // A user who never touches the mode control still gets dark from
        // prefers-color-scheme, and that path needs the dark accent too, or the theme
        // silently falls back to the light value on a dark surface.
        const osDark = tokens.slice(tokens.indexOf('@media (prefers-color-scheme: dark)'));
        for (const theme of THEMES) {
            const needle = theme === 'forest' ? ':root:not([data-mode])' : `[data-theme="${theme}"]:not([data-mode])`;
            expect(osDark, `${theme} has no OS-dark accent`).toContain(needle);
        }
    });

    it('the accents are distinct, so picking a theme is visible', () => {
        const accents = [...tokens.matchAll(/--rz-p-accent:\s*(#[0-9a-f]{6})/gu)].map(match => match[1]);

        // Seven themes x light and dark, and each pair has to differ from every other
        // pair. Two themes resolving to the same hex means one of them does nothing.
        expect(accents.length).toBeGreaterThanOrEqual(THEMES.length * 2);
        expect(new Set(accents).size).toBeGreaterThanOrEqual(THEMES.length * 2 - 1);
    });
});

describe('the mode axis reaches the whole ramp', () => {
    const RAMP = [
        '--rz-p-canvas', '--rz-p-canvas-alt', '--rz-p-surface', '--rz-p-elevated',
        '--rz-p-soft', '--rz-p-line', '--rz-p-ink', '--rz-p-ink-2', '--rz-p-muted',
        '--rz-p-success', '--rz-p-warning', '--rz-p-danger'
    ];

    const darkBlock = tokens.slice(
        tokens.indexOf(':root[data-mode="dark"]'),
        tokens.indexOf('/* Follow the OS')
    );

    it.each(RAMP)('%s is redefined for dark mode', token => {
        // The original bug: `--rz-good`, `--rz-warn` and `--rz-risk` were defined once
        // for light mode and inherited into dark, where they measured 2.58, 3.61 and
        // 3.05:1. Every primitive has to be stated for both modes or none of them.
        expect(darkBlock).toContain(`${token}:`);
    });

    it('status fills are derived from the status colors, not stated separately', () => {
        // `--rz-good-soft` used to be its own hex, which is how a fill and its text
        // ended up disagreeing after a mode change. Deriving it means they cannot.
        for (const status of ['good', 'warn', 'risk']) {
            const pattern = new RegExp(`--rz-${status}-soft:\\s*color-mix\\([^;]*var\\(--rz-p-`, 'u');
            expect(pattern.test(tokens), `--rz-${status}-soft is not derived`).toBe(true);
        }
    });
});

describe('there is one source of truth', () => {
    it('the two token families alias the same primitives', () => {
        // `--color-*` and `--rz-*` both survive because 373 call sites read one or the
        // other. What must not survive is each family carrying its own colors: that is
        // what made the theme picker change some elements and not others.
        const aliases = ['--color-text-primary', '--color-bg-card', '--accent', '--surface-card'];
        for (const alias of aliases) {
            const pattern = new RegExp(`${alias}:\\s*var\\(--`, 'u');
            expect(pattern.test(tokens), `${alias} does not alias a primitive`).toBe(true);
        }
    });

    it('the primitives are declared only inside the token block', () => {
        const outside = [...components.matchAll(/(--rz-p-[\w-]+)\s*:/gu)].map(match => match[1]);

        expect([...new Set(outside)]).toEqual([]);
    });
});
