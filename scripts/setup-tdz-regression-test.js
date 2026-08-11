/**
 * Release gate for the first-run setup bundle.
 *
 * The historical production failure was a lexical binding collision introduced while
 * minifying the inline submit handler. This test runs the *exact production esbuild
 * identifier minifier* and executes every response branch that used to live in that
 * handler. A compile-only test is insufficient: TDZ failures are runtime-only.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { transform } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = join(root, 'src/assets/setup/script.js');
const sourcefile = 'src/assets/setup/script.js';
const source = readFileSync(sourcePath, 'utf8');
const transformed = await transform(source, {
  loader: 'js',
  target: 'esnext',
  sourcefile,
  sourcemap: 'external',
  sourcesContent: true,
  minifySyntax: true,
  minifyWhitespace: true,
  minifyIdentifiers: true
});

const map = JSON.parse(transformed.map);
if (!map.sources.some(item => item.endsWith(sourcefile))) {
  throw new Error(`Setup source map does not reference ${sourcefile}`);
}
if (!transformed.code || transformed.code.length >= source.length) {
  throw new Error('Setup regression did not exercise identifier-minified output');
}

function element(extra = {}) {
  return {
    value: '', textContent: '', hidden: false, disabled: false, readOnly: false,
    href: '', type: 'text', listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    querySelector() { return null; }, setAttribute() {}, ...extra
  };
}

function createHarness(fetchImpl) {
  const submitLabel = element();
  const submitButton = element({ querySelector: selector => selector === 'span' ? submitLabel : null });
  const form = element({ querySelector: selector => selector === 'button[type=submit]' ? submitButton : null });
  const elements = {
    setupForm: form,
    setupError: element(),
    email: element({ value: 'owner@example.invalid', type: 'email' }),
    password: element({ value: 'Protected1', type: 'password' }),
    fixedEmail: element(), emailPinned: element({ hidden: true }),
    setupDone: element({ hidden: true }), panelUrl: element(), openPanel: element(), doneUser: element(),
    togglePassword: element({ querySelector: () => null }), copyUrl: element()
  };
  const captured = [];
  const context = {
    Error, ReferenceError, Response, setTimeout, clearTimeout,
    console: { ...console, error(...args) { captured.push(args); } },
    navigator: { clipboard: { async writeText() {} } },
    DOMParser: class {
      parseFromString() {
        return { querySelector() { return { textContent: 'Server rejected setup' }; } };
      }
    },
    document: {
      body: { dataset: { emailFixed: 'false' } },
      getElementById(id) {
        if (!(id in elements)) throw new Error(`Unexpected DOM id: ${id}`);
        return elements[id];
      }
    },
    fetch: fetchImpl
  };
  vm.runInNewContext(`${transformed.code}\n//# sourceURL=rayzen-setup.min.js`, context, { filename: 'rayzen-setup.min.js' });
  if (typeof form.listeners.submit !== 'function') throw new Error('Minified setup handler was not registered');
  return { form, elements, captured };
}

async function runCase(name, fetchImpl, expectedMessage = null) {
  const h = createHarness(fetchImpl);
  await h.form.listeners.submit({ preventDefault() {} });
  for (const args of h.captured) {
    const value = args.find(item => item instanceof Error) || args[1];
    const text = String(value?.stack || value?.message || value || '');
    if (value instanceof ReferenceError || /before initialization|temporal dead zone/i.test(text)) {
      throw new Error(`${name}: minified setup produced a TDZ ReferenceError: ${text}`);
    }
  }
  if (expectedMessage && !h.elements.setupError.textContent.includes(expectedMessage)) {
    throw new Error(`${name}: expected setup error containing ${JSON.stringify(expectedMessage)}, got ${JSON.stringify(h.elements.setupError.textContent)}`);
  }
  return h;
}

const success = await runCase('json-success', async () => new Response(JSON.stringify({
  success: true,
  body: { panelUrl: 'https://example.invalid/private', username: 'owner@example.invalid' }
}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
if (!success.form.hidden || success.elements.setupDone.hidden) throw new Error('json-success did not render completion');

await runCase('json-application-error', async () => new Response(JSON.stringify({ success: false, message: 'Claim denied' }), {
  status: 409, headers: { 'Content-Type': 'application/json' }
}), 'Claim denied');

await runCase('invalid-json', async () => new Response('{broken', {
  status: 500, headers: { 'Content-Type': 'application/json' }
}), 'invalid setup response');

await runCase('html-error', async () => new Response('<html><b>failure</b></html>', {
  status: 502, headers: { 'Content-Type': 'text/html' }
}), 'Server rejected setup');

await runCase('network-error', async () => { throw new Error('network unavailable'); }, 'network unavailable');

const validation = createHarness(async () => { throw new Error('fetch should not run'); });
validation.elements.password.value = 'weak';
await validation.form.listeners.submit({ preventDefault() {} });
if (!validation.elements.setupError.textContent.includes('at least 8 characters')) throw new Error('Password validation branch failed');

console.log(`✔ Setup TDZ regression: minified runtime branches passed; source map owns ${sourcefile}`);
