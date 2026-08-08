import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const js = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const vercel = await readFile(new URL('../vercel.json', import.meta.url), 'utf8');

test('UI has no emoji dependency and includes accessible controls', () => {
  assert.match(html, /aria-label="Switch theme"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<symbol id="i-cloud"/);
  assert.doesNotMatch(html + js, /[😀-🙏]/u);
});

test('responsive targets and reduced motion are handled', () => {
  assert.match(css, /@media \(max-width:760px\)/);
  assert.match(css, /@media \(max-width:430px\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test('localhost preview covers required deployment states', () => {
  for (const state of ['home','token','account','progress','success','error']) assert.match(js, new RegExp(`mode === '${state}'`));
});


test('production CSP and progress UI are compatible', () => {
  assert.match(vercel, /style-src 'self'/);
  assert.doesNotMatch(vercel, /style-src[^;]*'unsafe-inline'/);
  assert.match(js, /<progress class="progress-track"/);
  assert.doesNotMatch(js, /progress-fill/);
  assert.doesNotMatch(js, /style="/);
});



test('current Wizard shell is identifiable and never reusable as stale state', () => {
  assert.match(html, /data-rayzen-wizard-build="rayzen-wizard-20260808-1"/);
  assert.match(html, /app\.js\?v=rayzen-wizard-20260808-1/);
  assert.match(html, /style\.css\?v=rayzen-wizard-20260808-1/);
  assert.match(vercel, /"Cache-Control"\s*,\s*"value": "no-store, max-age=0, must-revalidate"/);
  assert.match(vercel, /"Vercel-CDN-Cache-Control"\s*,\s*"value": "no-store"/);
});

test('completed deployments do not hijack a clean future visit', () => {
  assert.match(js, /params\.get\('result'\) === 'complete'/);
  assert.match(js, /const explicitContinuation = params\.get\('connected'\) \|\| params\.get\('resumed'\) === '1'/);
  assert.match(js, /id="deploy-another"/);
  assert.match(js, /api\('\/api\/disconnect', \{ method: 'POST', body: '\{\}' \}\)/);
});


test('wizard deploys the manifest-pinned bundled release artifact', async () => {
  const bundledWorker = await readFile(new URL('../artifacts/worker.js', import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('../artifacts/manifest.json', import.meta.url), 'utf8'));
  assert.equal(bundledWorker.length, manifest.size);
  assert.equal(createHash('sha256').update(bundledWorker).digest('hex'), manifest.sha256);
  assert.match(manifest.setupBuildMarker, /^rayzen-setup-[a-f0-9]{16}$/u);
  const workerText = bundledWorker.toString('utf8');
  assert.doesNotMatch(workerText, /#setup=/);
  const deploymentSource = await readFile(new URL('../lib/deployment.js', import.meta.url), 'utf8');
  assert.doesNotMatch(deploymentSource, /raw\.githubusercontent\.com/);
});
