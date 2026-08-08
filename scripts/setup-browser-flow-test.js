/**
 * Executes the actual setup script embedded in dist/worker.js against a tiny DOM stub.
 * This catches client-side scope/TDZ regressions that server-only setup tests cannot see.
 */
import vm from 'node:vm';

const artifact = await import('../dist/worker.js');
const worker = artifact.default;
const store = new Map();
const kv = {
  async get(key, options) {
    const raw = store.get(key);
    if (raw === undefined) return null;
    const type = typeof options === 'string' ? options : options?.type;
    return type === 'json' ? JSON.parse(raw) : raw;
  },
  async put(key, value) { store.set(key, typeof value === 'string' ? value : JSON.stringify(value)); },
  async delete(key) { store.delete(key); },
  async list() { return { keys: [...store.keys()].map(name => ({ name })), list_complete: true, cacheStatus: null }; }
};
const env = { CF_PAGES: '0', kv };
const page = await worker.fetch(new Request('https://rayzen-test.workers.dev/'), env);
const html = await page.text();
const script = /<script>([\s\S]*?)<\/script>/u.exec(html)?.[1];
if (!script) throw new Error('Setup script missing from built Worker');
if (/setup token|RAYZEN_SETUP_TOKEN|#setup=/i.test(html + script)) throw new Error('Obsolete setup-token flow remains in the built page');
if (/id=["']?confirm["']?/i.test(html)) throw new Error('First-run setup should ask only for email and password');
if (!/data-rayzen-setup-build=(?:["']?rayzen-setup-[a-f0-9]{16}["']?)/u.test(html)) throw new Error('Built setup release marker is missing');

function element(extra = {}) {
  return {
    value: '', textContent: '', hidden: false, disabled: false, readOnly: false, href: '', type: 'text',
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    querySelector() { return null; },
    setAttribute() {},
    ...extra
  };
}

const submitLabel = element();
const submitButton = element({ querySelector: selector => selector === 'span' ? submitLabel : null });
const form = element({ querySelector: selector => selector === 'button[type=submit]' ? submitButton : null });
const toggle = element({ querySelector: () => null });
const elements = {
  setupForm: form,
  setupError: element(),
  email: element({ value: 'owner@example.invalid', type: 'email' }),
  fixedEmail: element(),
  emailPinned: element({ hidden: true }),
  password: element({ value: 'Protected1', type: 'password' }),
  panelUrl: element(),
  openPanel: element(),
  doneUser: element(),
  setupDone: element({ hidden: true }),
  togglePassword: toggle,
  copyUrl: element()
};

const context = {
  console,
  Error,
  Response,
  setTimeout,
  clearTimeout,
  navigator: { clipboard: { async writeText() {} } },
  document: {
    body: { dataset: { emailFixed: 'false' } },
    getElementById(id) {
      if (!(id in elements)) throw new Error(`Unexpected DOM id: ${id}`);
      return elements[id];
    }
  },
  fetch: async (_url, options) => {
    const payload = JSON.parse(options.body);
    if ('token' in payload) throw new Error('Obsolete setup token was submitted');
    if (payload.email !== 'owner@example.invalid') throw new Error('Email was not submitted');
    return new Response(JSON.stringify({
      success: true,
      message: 'Setup complete.',
      body: {
        panelUrl: 'https://rayzen-test.workers.dev/private/panel',
        loginUrl: 'https://rayzen-test.workers.dev/private/login',
        username: 'owner@example.invalid'
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
};

vm.runInNewContext(script, context, { filename: 'built-setup-page.js' });
if (typeof form.listeners.submit !== 'function') throw new Error('Setup submit handler was not registered');

await form.listeners.submit({ preventDefault() {} });
if (!form.hidden) throw new Error('Setup form did not complete');
if (elements.setupDone.hidden) throw new Error('Success state was not revealed');
if (elements.doneUser.textContent !== 'owner@example.invalid') throw new Error('Setup result was not rendered');
if (elements.setupError.textContent) throw new Error(`Unexpected setup error: ${elements.setupError.textContent}`);

console.log('✔ Built first-run setup page executes without TDZ and submits only email/password');
