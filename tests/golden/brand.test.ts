/**
 * Brand assets: the shipped icon and SVGs are derived from the RayZen artwork.
 *
 * Why this file exists
 *
 * `src/assets/favicon.ico` was inherited from legacy upstream and still carried that project's
 * water-droplet mark. It is not only the browser tab icon: `src/assets/panel/index.html`
 * and `src/assets/login/index.html` both embed it as the header logo with
 * `alt="RayZen Logo"`, so every page was labelled RayZen while showing another
 * project's logo. Nothing detected it, because no test looked at pixels.
 *
 * These tests re-derive the icon from `rayzen-mark.png` through the same pipeline
 * `scripts/make-favicon.mjs` uses and require the committed bytes to match, so the
 * asset cannot drift from the brand art and cannot silently revert.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFavicon, decodePng } from '../../scripts/make-favicon.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const MARK = join(ROOT, 'rayzen-mark.png');
const ICON = join(ROOT, 'src', 'assets', 'favicon.ico');

describe('the shipped icon is the RayZen mark', () => {
    it('matches a fresh derivation from rayzen-mark.png', () => {
        // Byte equality, not a similarity score: the pipeline is deterministic, so any
        // difference means the committed file was not produced by it.
        expect(readFileSync(ICON).equals(buildFavicon(readFileSync(MARK)))).toBe(true);
    });

    it('is a single 64x64 32-bit icon, which is what the pages embed', () => {
        const ico = readFileSync(ICON);

        expect(ico.readUInt16LE(0)).toBe(0);      // reserved
        expect(ico.readUInt16LE(2)).toBe(1);      // type: icon
        expect(ico.readUInt16LE(4)).toBe(1);      // one image
        expect(ico.readUInt8(6)).toBe(64);        // width
        expect(ico.readUInt8(7)).toBe(64);        // height
        expect(ico.readUInt16LE(12)).toBe(32);    // bits per pixel
    });

    it('is not the inherited droplet icon', () => {
        /**
         * The droplet was line art: a few strokes on transparency, so almost every
         * pixel was fully transparent. The RayZen mark is a filled rounded square, so
         * the interior is opaque. Distinguished on that structural difference rather
         * than on a stored hash of the old file, which would mean committing the thing
         * being removed.
         */
        const ico = readFileSync(ICON);
        const pixels = 22 + 40;
        let opaque = 0;

        for (let index = 0; index < 64 * 64; index++) {
            if (ico[pixels + index * 4 + 3] > 250) opaque++;
        }

        // A rounded square at 18% corner radius covers ~96% of its bounding box.
        expect(opaque / (64 * 64)).toBeGreaterThan(0.9);
    });

    it('renders visibly on a light browser tab strip', () => {
        // A white-on-transparent mark would be invisible there, which is why the icon
        // is composited onto the brand navy rather than shipped with transparency.
        const ico = readFileSync(ICON);
        const pixels = 22 + 40;
        const centre = pixels + ((32 * 64) + 4) * 4;

        // BGRA. The background is #000328, so the blue channel dominates and the
        // pixel is dark.
        const luminance = (ico[centre + 2] * 0.299 + ico[centre + 1] * 0.587 + ico[centre] * 0.114);
        expect(luminance).toBeLessThan(128);
    });
});

describe('the brand SVGs are traced from the same artwork', () => {
    const glyph = readFileSync(join(ROOT, 'src', 'assets', 'brand', 'glyph.svg'), 'utf8');
    const wordmark = readFileSync(join(ROOT, 'src', 'assets', 'brand', 'wordmark.svg'), 'utf8');

    it('both use currentColor so they follow the active theme', () => {
        for (const [name, svg] of [['glyph', glyph], ['wordmark', wordmark]] as const) {
            expect(svg, name).toContain('fill="currentColor"');
            // A hardcoded colour would not re-theme, which was the reason for tracing
            // the raster art in the first place.
            expect(svg, name).not.toMatch(/fill="#[0-9a-f]{3,8}"/iu);
        }
    });

    it('both carry an accessible label', () => {
        for (const [name, svg] of [['glyph', glyph], ['wordmark', wordmark]] as const) {
            expect(svg, name).toContain('role="img"');
            expect(svg, name).toContain('aria-label="RayZen"');
        }
    });

    it('the panel inlines the committed glyph rather than a placeholder', () => {
        const script = readFileSync(join(ROOT, 'src', 'assets', 'panel', 'script.js'), 'utf8');
        const path = /<path d="([^"]+)"/u.exec(glyph)?.[1];

        expect(path).toBeTruthy();
        expect(script, 'the sidebar mark drifted from src/assets/brand/glyph.svg')
            .toContain(path as string);
    });
});

describe('the brand source art is present and usable', () => {
    it('rayzen-mark.png decodes as the transparent 512x512 source', () => {
        const decoded = decodePng(readFileSync(MARK));

        expect(decoded.width).toBe(512);
        expect(decoded.height).toBe(512);

        // Transparency is what makes it usable as a mask; a flattened export would
        // silently bake in a background.
        const transparent = Array.from({ length: decoded.width * decoded.height })
            .filter((_, index) => decoded.rgba[index * 4 + 3] === 0).length;
        expect(transparent).toBeGreaterThan(0);
    });
});

/**
 * Foreign project naming on user-visible surfaces.
 *
 * The favicon tests above cover the logo. This covers the words. RayZen is a fork, so the
 * upstream project's name legitimately appears in the licence attribution and in the
 * comment explaining why five KV key names cannot be renamed; it must not appear in
 * anything an operator reads on screen.
 *
 * Verified in a browser as well, by reading every visible string from all seven panel
 * views in both languages plus the login and proxy-IP pages: 1,361 strings, none matching.
 * That run cannot live in this suite, so this is the half that catches a reintroduction.
 */
describe('no foreign project naming reaches the interface', () => {
    /** Files whose contents become visible text. */
    const SURFACES = [
        'panel/index.html',
        'panel/script.js',
        'login/index.html',
        'login/script.js',
        'setup/index.html',
        'setup/script.js',
        'proxy-ip/index.html',
        'proxy-ip/script.js',
        'error/index.html',
        'probe/index.html'
    ];

    /**
     * Deliberately not in this list: `Bypass`.
     *
     * It is the correct term for a routing rule that sends traffic around the proxy rather
     * than through it, it is not a project name, and `customBypassRules` and `bypassIran`
     * are stored settings fields that existing deployments already carry. Renaming them
     * would make the panel less clear and break the settings contract for no gain.
     */
    const FOREIGN = [/\blegacy upstream\b/u, /legacy-upstream-owner/iu, /legacy-upstream-project/iu, /\bbeta\b/iu];

    it.each(SURFACES)('%s carries no foreign project name in its content', file => {
        const source = readFileSync(join(ROOT, 'src', 'assets', file), 'utf8');

        // Comments are stripped: attribution and design rationale may name the upstream,
        // and the point of this test is what reaches the screen.
        const visible = source
            .replace(/\/\*[\s\S]*?\*\//gu, '')
            .replace(/^\s*\/\/[^\n]*/gmu, '')
            .replace(/<!--[\s\S]*?-->/gu, '');

        for (const pattern of FOREIGN) {
            expect(visible, `${file} matches ${pattern}`).not.toMatch(pattern);
        }
    });

    it('the panel names RayZen, so the branding is present rather than merely absent', () => {
        const panel = readFileSync(join(ROOT, 'src', 'assets', 'panel', 'index.html'), 'utf8');

        expect(panel).toContain('RayZen');
    });
});
