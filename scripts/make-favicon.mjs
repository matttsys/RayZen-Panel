/**
 * Generates src/assets/favicon.ico from the RayZen brand mark.
 *
 * WHY THIS EXISTS
 *
 * `src/assets/favicon.ico` was inherited from legacy upstream and still contained that project's
 * water-droplet mark. It is not only the browser tab icon: both the panel and the
 * login page embed it as the header logo, with `alt="RayZen Logo"`, so every page a
 * user saw was labelled RayZen and showed another project's logo.
 *
 * `rayzen-mark.png` is already converted into the inline SVGs the panel shell uses,
 * but an `<img src="data:image/x-icon">` and a browser tab need a raster icon, so
 * that pipeline could not supply this one.
 *
 * WHAT IT PRODUCES
 *
 * A single 64x64 32-bit ICO, which is the format and geometry the previous file used,
 * so nothing about how the pages reference it changes.
 *
 * The brand mark is white lettering on transparency. A transparent icon would be
 * invisible against a light browser tab strip, so the mark is composited onto the
 * brand's dark navy (#000328, the first stop of the login page's gradient) with the
 * rounded-square silhouette the 512x512 source uses. That is also how the panel
 * header shows it, so the tab icon and the in-page logo match.
 *
 * Committed output, so a build never runs this. Regenerate only when the brand art
 * changes:
 *
 *   node scripts/make-favicon.mjs
 *   npm run build && npm test && npm run size
 *
 * `tests/golden/brand.test.ts` re-derives the result and fails if the committed icon
 * stops matching the brand mark, so the pipeline is checked rather than trusted.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SOURCE = new URL('../rayzen-mark.png', import.meta.url);
const TARGET = new URL('../src/assets/favicon.ico', import.meta.url);
const SIZE = 64;

/** #000328, the first stop of the login page's background gradient. */
export const BACKGROUND = { r: 0x00, g: 0x03, b: 0x28 };

/** Corner radius as a fraction of the icon's width, matching the source artwork. */
const CORNER_RADIUS = 0.18;

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG into flat RGBA bytes. */
export function decodePng(buffer) {
    let position = 8;
    let header = null;
    const idat = [];

    while (position < buffer.length) {
        const length = buffer.readUInt32BE(position);
        const type = buffer.toString('ascii', position + 4, position + 8);
        const data = buffer.subarray(position + 8, position + 8 + length);

        if (type === 'IHDR') {
            header = {
                width: data.readUInt32BE(0),
                height: data.readUInt32BE(4),
                depth: data.readUInt8(8),
                colourType: data.readUInt8(9),
                interlace: data.readUInt8(12)
            };
        } else if (type === 'IDAT') {
            idat.push(data);
        } else if (type === 'IEND') {
            break;
        }

        position += 12 + length;
    }

    if (!header) throw new Error('no IHDR');
    if (header.depth !== 8 || header.interlace !== 0 || ![2, 6].includes(header.colourType)) {
        throw new Error(`unsupported PNG: depth ${header.depth}, colour type ${header.colourType}`);
    }

    const channels = header.colourType === 6 ? 4 : 3;
    const stride = header.width * channels;
    const raw = inflateSync(Buffer.concat(idat));
    const rgba = Buffer.alloc(header.width * header.height * 4);

    // Reverse the per-row filters. Types 0-4 are the only ones PNG defines.
    let previous = Buffer.alloc(stride);
    for (let y = 0; y < header.height; y++) {
        const filter = raw[y * (stride + 1)];
        const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));

        for (let x = 0; x < stride; x++) {
            const left = x >= channels ? row[x - channels] : 0;
            const up = previous[x];
            const upLeft = x >= channels ? previous[x - channels] : 0;

            if (filter === 1) row[x] = (row[x] + left) & 0xff;
            else if (filter === 2) row[x] = (row[x] + up) & 0xff;
            else if (filter === 3) row[x] = (row[x] + ((left + up) >> 1)) & 0xff;
            else if (filter === 4) {
                const p = left + up - upLeft;
                const pa = Math.abs(p - left);
                const pb = Math.abs(p - up);
                const pc = Math.abs(p - upLeft);
                row[x] = (row[x] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 0xff;
            }
        }

        for (let x = 0; x < header.width; x++) {
            const at = (y * header.width + x) * 4;
            rgba[at] = row[x * channels];
            rgba[at + 1] = row[x * channels + 1];
            rgba[at + 2] = row[x * channels + 2];
            rgba[at + 3] = channels === 4 ? row[x * channels + 3] : 0xff;
        }

        previous = row;
    }

    return { width: header.width, height: header.height, rgba };
}

/**
 * Box-downsamples RGBA to `size` x `size`, averaging in premultiplied space.
 *
 * Averaging straight RGB across a transparency boundary pulls the transparent
 * pixels' colour (which is arbitrary) into the visible edge, which shows up as a
 * dark halo around white lettering. Premultiplying avoids that.
 */
export function downsample({ width, height, rgba }, size) {
    const out = Buffer.alloc(size * size * 4);
    const scaleX = width / size;
    const scaleY = height / size;

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const x0 = Math.floor(x * scaleX);
            const x1 = Math.max(x0 + 1, Math.floor((x + 1) * scaleX));
            const y0 = Math.floor(y * scaleY);
            const y1 = Math.max(y0 + 1, Math.floor((y + 1) * scaleY));

            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            let count = 0;

            for (let sy = y0; sy < y1; sy++) {
                for (let sx = x0; sx < x1; sx++) {
                    const at = (sy * width + sx) * 4;
                    const alpha = rgba[at + 3] / 255;
                    r += rgba[at] * alpha;
                    g += rgba[at + 1] * alpha;
                    b += rgba[at + 2] * alpha;
                    a += rgba[at + 3];
                    count++;
                }
            }

            const at = (y * size + x) * 4;
            const alpha = a / count;
            const scale = alpha === 0 ? 0 : 255 / alpha;
            out[at] = Math.min(255, Math.round((r / count) * scale));
            out[at + 1] = Math.min(255, Math.round((g / count) * scale));
            out[at + 2] = Math.min(255, Math.round((b / count) * scale));
            out[at + 3] = Math.round(alpha);
        }
    }

    return { width: size, height: size, rgba: out };
}

/** Coverage of a rounded square at a pixel centre, 4x4 supersampled for smooth edges. */
function roundedSquareCoverage(x, y, size, radius) {
    const samples = 4;
    let inside = 0;

    for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
            const px = x + (sx + 0.5) / samples;
            const py = y + (sy + 0.5) / samples;
            const dx = Math.max(radius - px, px - (size - radius), 0);
            const dy = Math.max(radius - py, py - (size - radius), 0);
            if (dx * dx + dy * dy <= radius * radius) inside++;
        }
    }

    return inside / (samples * samples);
}

/** Composites the mark onto the brand background inside a rounded square. */
export function composite({ width, height, rgba }, background) {
    const out = Buffer.alloc(width * height * 4);
    const radius = width * CORNER_RADIUS;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const at = (y * width + x) * 4;
            const markAlpha = rgba[at + 3] / 255;
            const shape = roundedSquareCoverage(x, y, width, radius);

            out[at] = Math.round(rgba[at] * markAlpha + background.r * (1 - markAlpha));
            out[at + 1] = Math.round(rgba[at + 1] * markAlpha + background.g * (1 - markAlpha));
            out[at + 2] = Math.round(rgba[at + 2] * markAlpha + background.b * (1 - markAlpha));
            out[at + 3] = Math.round(255 * shape);
        }
    }

    return { width, height, rgba: out };
}

/** Wraps RGBA in a single-image 32-bit ICO (BMP payload, bottom-up, BGRA). */
export function encodeIco({ width, height, rgba }) {
    const pixels = Buffer.alloc(width * height * 4);

    for (let y = 0; y < height; y++) {
        // ICO stores rows bottom-up.
        const source = (height - 1 - y) * width * 4;
        const target = y * width * 4;
        for (let x = 0; x < width; x++) {
            pixels[target + x * 4] = rgba[source + x * 4 + 2];
            pixels[target + x * 4 + 1] = rgba[source + x * 4 + 1];
            pixels[target + x * 4 + 2] = rgba[source + x * 4];
            pixels[target + x * 4 + 3] = rgba[source + x * 4 + 3];
        }
    }

    const info = Buffer.alloc(40);
    info.writeUInt32LE(40, 0);
    info.writeInt32LE(width, 4);
    // Doubled: the format expects colour data plus an AND mask, even at 32bpp
    // where the mask is unused because alpha carries the transparency.
    info.writeInt32LE(height * 2, 8);
    info.writeUInt16LE(1, 12);
    info.writeUInt16LE(32, 14);
    info.writeUInt32LE(0, 16);
    info.writeUInt32LE(pixels.length, 20);

    const image = Buffer.concat([info, pixels]);

    const directory = Buffer.alloc(22);
    directory.writeUInt16LE(0, 0);
    directory.writeUInt16LE(1, 2);
    directory.writeUInt16LE(1, 4);
    directory.writeUInt8(width === 256 ? 0 : width, 6);
    directory.writeUInt8(height === 256 ? 0 : height, 7);
    directory.writeUInt8(0, 8);
    directory.writeUInt8(0, 9);
    directory.writeUInt16LE(1, 10);
    directory.writeUInt16LE(32, 12);
    directory.writeUInt32LE(image.length, 14);
    directory.writeUInt32LE(22, 18);

    return Buffer.concat([directory, image]);
}

/** The whole pipeline, exported so a test can re-derive it from the same source. */
export function buildFavicon(pngBuffer, size = SIZE, background = BACKGROUND) {
    return encodeIco(composite(downsample(decodePng(pngBuffer), size), background));
}

// Only write the file when run directly, so the test can import the pipeline.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const ico = buildFavicon(readFileSync(SOURCE));
    writeFileSync(TARGET, ico);
    console.log(`\x1b[32m✔\x1b[0m wrote src/assets/favicon.ico  ${ico.length} B  ${SIZE}x${SIZE}`);
    console.log('  Run `npm run build`, `npm test` and `npm run size`.');
}
