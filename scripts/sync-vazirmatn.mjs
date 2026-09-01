/**
 * Fetches the pinned OFL-1.1 Vazirmatn variable font from the official npm CDN.
 * Font binaries are deliberately not committed to the RayZen source release.
 * Run this before a branded release build when network access is available.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '33.0.3';
const files = [
  {
    url: `https://cdn.jsdelivr.net/npm/vazirmatn@${version}/fonts/webfonts/Vazirmatn%5Bwght%5D.woff2`,
    destinations: [
      'src/assets/fonts/Vazirmatn.woff2',
      'wizard/assets/fonts/Vazirmatn.woff2',
    ]
  },
  {
    url: `https://cdn.jsdelivr.net/npm/vazirmatn@${version}/fonts/variable/Vazirmatn%5Bwght%5D.ttf`,
    destinations: []
  }
];

for (const file of files) {
  const response = await fetch(file.url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Vazirmatn download failed (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 20_000) throw new Error('Downloaded Vazirmatn payload is unexpectedly small.');
  for (const destination of file.destinations) {
    const absolute = path.join(root, destination);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);
    console.log(`Vazirmatn ${version} → ${destination}`);
  }
}
console.log('Vazirmatn is SIL OFL 1.1. Keep OFL attribution with redistributed binaries.');
