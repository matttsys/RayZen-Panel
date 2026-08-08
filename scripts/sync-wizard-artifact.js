import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'dist', 'worker.js');
const target = join(root, 'wizard', 'artifacts', 'worker.js');
const manifestPath = join(root, 'wizard', 'artifacts', 'manifest.json');
const buildManifestPath = join(root, 'dist', 'build-manifest.json');
const bytes = readFileSync(source);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const buildManifest = JSON.parse(readFileSync(buildManifestPath, 'utf8'));
if (buildManifest.workerSha256 !== sha256) throw new Error('dist/worker.js does not match dist/build-manifest.json');
if (!buildManifest.setupBuildMarker) throw new Error('Setup build marker is missing from dist/build-manifest.json');

copyFileSync(source, target);
manifest.sha256 = sha256;
manifest.size = bytes.length;
manifest.setupBuildMarker = buildManifest.setupBuildMarker;
manifest.buildMode = buildManifest.buildMode;
manifest.toolchain = buildManifest.toolchain;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Wizard artifact synced: ${bytes.length} bytes`);
console.log(`SHA-256: ${sha256}`);
