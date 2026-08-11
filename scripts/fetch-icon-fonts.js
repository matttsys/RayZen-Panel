/**
 * Refetches the Material Symbols subsets in src/assets/fonts/.
 *
 * Those woff2 files are *source* assets: no page embeds a font any more. They exist
 * because `scripts/extract-glyphs.py` reads the outlines out of them to produce the
 * inline SVG tables the pages carry, which cost less than the fonts did and cannot
 * render a missing icon as the literal word `content_copy`.
 *
 * Not part of `npm run build`, and a build never needs network access. Run this only
 * after adding a name to src/assets/fonts/subsets.json:
 *
 *   node scripts/fetch-icon-fonts.js      # refetch the subset
 *   python3 scripts/extract-glyphs.py     # emit the outline
 *
 * then paste the new entry into the page's table and run `npm test` and `npm run size`.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname as pathDirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = pathDirname(fileURLToPath(import.meta.url));
const FONT_PATH = join(__dirname, '../src/assets/fonts');

const green = '\x1b[32m';
const red = '\x1b[31m';
const reset = '\x1b[0m';

/**
 * Google's CSS API serves a different woff2 depending on the requesting browser's
 * declared capabilities, so a UA is required to get the variable-axis woff2 rather than
 * a legacy fallback.
 */
const UA =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/120.0.0.0 Safari/537.36';

async function get(url, attempts = 5) {
    let last = 'unknown error';
    for (let i = 0; i < attempts; i++) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': UA } });
            if (res.ok) return res;
            last = `HTTP ${res.status}`;
        } catch (error) {
            last = error.message;
        }
        await new Promise(resolve => setTimeout(resolve, 700 * (i + 1)));
    }
    throw new Error(`${url}: ${last}`);
}

const manifest = JSON.parse(readFileSync(join(FONT_PATH, 'subsets.json'), 'utf8'));
let changed = false;

for (const [page, { axes, icons }] of Object.entries(manifest.pages)) {
    const names = [...icons].sort().join(',');
    const cssUrl =
        'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:' +
        `${axes}&icon_names=${names}&display=block`;

    const css = await (await get(cssUrl)).text();
    const match = /url\((https:\/\/[^)]+)\)/.exec(css);
    if (!match) throw new Error(`no font URL in the ${page} stylesheet`);

    const font = Buffer.from(await (await get(match[1])).arrayBuffer());
    const file = join(FONT_PATH, `material-symbols-${page}.woff2`);

    let previous = null;
    try {
        previous = readFileSync(file);
    } catch {
        // First generation for this page.
    }

    if (previous?.equals(font)) {
        console.log(`  ${page}: unchanged (${font.length} B, ${icons.length} icons)`);
        continue;
    }

    writeFileSync(file, font);
    changed = true;
    const delta = previous ? ` (was ${previous.length} B)` : '';
    console.log(`  ${page}: wrote ${font.length} B, ${icons.length} icons${delta}`);

    if (manifest.pages[page].bytes !== font.length) {
        console.warn(
            `  ${red}!${reset} ${page}: subsets.json records ${manifest.pages[page].bytes} B ` +
            `but the subset is ${font.length} B. Update the manifest and the size note in ` +
            'src/assets/panel/style.css.'
        );
    }
}

console.log(
    changed
        ? `${green}✔${reset} Icon subsets regenerated. Run \`npm test\` and \`npm run size\`.`
        : `${green}✔${reset} Icon subsets already match the manifest.`
);
