/**
 * Build-time Persian typography input for Vercel.
 * The font is fetched from the pinned official npm package through jsDelivr so the
 * repository never carries font binaries while production still gets deterministic
 * Vazirmatn metrics.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../assets/fonts/Vazirmatn.woff2');
const version = '33.0.3';
const url = `https://cdn.jsdelivr.net/npm/vazirmatn@${version}/fonts/webfonts/Vazirmatn%5Bwght%5D.woff2`;
const response = await fetch(url, { redirect: 'follow' });
if (!response.ok) throw new Error(`Vazirmatn download failed (${response.status})`);
const bytes = new Uint8Array(await response.arrayBuffer());
if (bytes.byteLength < 20_000) throw new Error('Downloaded Vazirmatn payload is unexpectedly small.');
await mkdir(dirname(target), { recursive: true });
await writeFile(target, bytes);
console.log(`Vazirmatn ${version} prepared for the Wizard build.`);
