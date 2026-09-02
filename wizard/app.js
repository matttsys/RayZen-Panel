const $ = (selector, root = document) => root.querySelector(selector);
const app = $('#app');
const toast = $('#toast');
let csrf = '';
let bootstrap = { oauthConfigured: false };
let accounts = [];
let deployment = null;
let deploying = false;
let lastError = null;

const esc = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
const icon = (name, className = '') => `<svg class="icon ${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isLocal = ['localhost','127.0.0.1'].includes(location.hostname);

const WIZARD_COPY = { fa: {
  'Self-hosted on Cloudflare':'میزبانی‌شده روی کلادفلر',
  'Deploy RayZen.':'RayZen را راه‌اندازی کن.',
  'Your private RayZen instance, deployed directly to':'نسخه‌ی خصوصی RayZen، مستقیم داخل',
  'your Cloudflare account.':'حساب کلادفلر خودت.',
  'Recommended':'پیشنهاد RayZen','Continue with Cloudflare':'ادامه با Cloudflare',
  'Authorize RayZen once. The Worker, storage, bindings, and public URL are prepared automatically.':'یک‌بار دسترسی بده؛ Worker، فضای ذخیره‌سازی، Bindingها و آدرس عمومی خودکار آماده می‌شوند.',
  'Cloudflare API Token':'توکن API کلادفلر','Advanced deployment':'راه‌اندازی پیشرفته','Workers Scripts · Edit':'Workers Scripts · Edit','Workers KV Storage · Edit':'Workers KV Storage · Edit',
  'Cloudflare API token':'توکن API کلادفلر','Paste token':'توکن را وارد کن','Verify token':'تأیید توکن','Used only for this deployment. Never written to application storage.':'فقط برای همین راه‌اندازی استفاده می‌شود و در داده‌های RayZen ذخیره نمی‌شود.',
  'No GitHub':'بدون GitHub','No shared panel':'بدون پنل مشترک','Your Cloudflare account':'حساب کلادفلر شما','Cloudflare OAuth is not configured.':'ورود Cloudflare برای این Wizard تنظیم نشده است.','Enter an API token.':'توکن API را وارد کن.','Verifying…':'در حال بررسی…',
  'Select account':'انتخاب حساب','RayZen will be deployed to this Cloudflare account.':'RayZen در همین حساب Cloudflare راه‌اندازی می‌شود.','Cancel':'انصراف','Cloudflare account':'حساب Cloudflare','Deploying RayZen':'راه‌اندازی RayZen','Deployment progress':'پیشرفت راه‌اندازی','Working':'در حال انجام',
  'Deployment':'راه‌اندازی','Status':'وضعیت','In progress':'در حال انجام','Worker':'Worker','Generating…':'در حال ساخت…','Storage':'ذخیره‌سازی','KV ready':'KV آماده','Pending':'در انتظار','Network':'شبکه','Cloudflare global':'شبکه جهانی Cloudflare','Elapsed':'زمان سپری‌شده','Safe to close. Completed steps are preserved for this session.':'می‌توانی صفحه را ببندی؛ مرحله‌های کامل‌شده در همین نشست حفظ می‌شوند.',
  'Deployment complete':'راه‌اندازی کامل شد','RayZen is ready in your Cloudflare account.':'RayZen در حساب Cloudflare شما آماده است.','Open RayZen':'باز کردن RayZen','Deploy another':'راه‌اندازی یکی دیگر','Cloudflare Dashboard':'داشبورد Cloudflare','Bindings':'Bindingها','Configured':'آماده','Time':'زمان','Region':'ناحیه','Cloudflare global network':'شبکه جهانی Cloudflare','Verification':'تأیید','Reachable':'در دسترس','Verified':'تأییدشده','Source':'منبع','RayZen release':'نسخه RayZen','Copied.':'کپی شد.','Copy unavailable.':'کپی در دسترس نیست.',
  'Validating access':'بررسی دسترسی','Preparing deployment':'آماده‌سازی','Generating Worker name':'ساخت نام Worker','Creating KV':'ساخت KV','Uploading application':'آپلود RayZen','Publishing Worker':'انتشار Worker','Verifying deployment':'تأیید نسخه منتشرشده','Deployment complete':'راه‌اندازی کامل شد',
  'Authorization cancelled':'اجازه دسترسی لغو شد','No changes were made to your Cloudflare account.':'هیچ تغییری در حساب Cloudflare شما انجام نشد.','Back':'بازگشت','Cloudflare authorization failed':'اتصال به Cloudflare ناموفق بود','Cloudflare did not complete authorization.':'Cloudflare فرایند دسترسی را کامل نکرد.','Try again':'تلاش دوباره','Authorization session expired':'نشست دسترسی منقضی شد','Start Cloudflare authorization again.':'اتصال Cloudflare را دوباره شروع کن.','Cloudflare authorization is unavailable':'اتصال Cloudflare در دسترس نیست','Cloudflare could not be reached.':'ارتباط با Cloudflare برقرار نشد.','No Cloudflare account available':'حساب Cloudflare در دسترس نیست','Authorize an account that can deploy Workers.':'حسابی را متصل کن که اجازه ساخت Worker دارد.','Authorization expired':'دسترسی منقضی شد','Reconnect':'اتصال دوباره','Session expired':'نشست منقضی شد','Refresh':'بارگذاری دوباره','Cloudflare is rate limiting requests':'Cloudflare درخواست‌ها را محدود کرده','Retry':'تلاش دوباره','Cloudflare took too long to respond':'پاسخ Cloudflare طول کشید','Cloudflare is unavailable':'Cloudflare در دسترس نیست','Worker is not published':'Worker منتشر نشده','Deployment session expired':'نشست راه‌اندازی منقضی شد','Start again':'شروع دوباره','Deployment interrupted':'راه‌اندازی متوقف شد','Resume deployment':'ادامه راه‌اندازی','KV creation failed':'ساخت KV ناموفق بود','Worker upload failed':'آپلود Worker ناموفق بود','Worker publication failed':'انتشار Worker ناموفق بود','Deployment package failed verification':'بررسی بسته راه‌اندازی ناموفق بود','RayZen release is unavailable':'نسخه RayZen در دسترس نیست','RayZen release is invalid':'نسخه RayZen معتبر نیست','Published build mismatch':'نسخه منتشرشده با بسته RayZen یکسان نیست'
}};
let language = 'en';
try { language = localStorage.getItem('rayzen-wizard-language') || 'en'; } catch {}
const tr = (value) => language === 'fa' ? (WIZARD_COPY.fa[value] || value) : value;
function setLanguage(next) {
  language = next === 'fa' ? 'fa' : 'en';
  try { localStorage.setItem('rayzen-wizard-language', language); } catch {}
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr';
  const label = $('#language-label'); if (label) label.textContent = language === 'fa' ? 'EN' : 'FA';
  const footer = $('#footer-copy'); if (footer) footer.textContent = language === 'fa' ? 'خصوصی از پایه · روی Cloudflare شما' : 'Private by design · deployed to your Cloudflare';
}
function initLanguage() { setLanguage(language); $('#language-toggle')?.addEventListener('click', () => { setLanguage(language === 'fa' ? 'en' : 'fa'); rerenderCurrent(); }); }
function rerenderCurrent() { if (deployment?.status === 'complete') return renderSuccess(deployment); if (deployment) return renderProgress(); if (accounts.length) return renderAccounts(); renderHome(); }

function setTheme(theme) {
  const value = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.mode = value;
  document.querySelector('meta[name="theme-color"]').content = value === 'dark' ? '#09090e' : '#f6f7fb';
  try { localStorage.setItem('rayzen-wizard-theme', value); } catch {}
}

function initTheme() {
  const query = new URLSearchParams(location.search).get('mode');
  let saved = null;
  try { saved = localStorage.getItem('rayzen-wizard-theme'); } catch {}
  setTheme(query || saved || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  $('#theme-toggle').addEventListener('click', () => setTheme(document.documentElement.dataset.mode === 'dark' ? 'light' : 'dark'));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 1800);
}

async function api(path, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (options.method && options.method !== 'GET' && csrf) headers['X-RayZen-CSRF'] = csrf;
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    const error = new Error(body.error || `Request failed (${response.status}).`);
    error.code = body.code || 'REQUEST_FAILED';
    error.status = response.status;
    error.retryAfter = Number.isFinite(Number(body.retryAfter)) ? Number(body.retryAfter) : null;
    throw error;
  }
  return body;
}

function renderLoading() {
  app.innerHTML = `<section class="stage"><div class="card loading-card"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div></section>`;
}

function homeTemplate() {
  return `<section class="stage">
    <div class="hero">
      <div class="eyebrow"><span class="eyebrow-dot"></span>${tr('Self-hosted on Cloudflare')}</div>
      <h1>${tr('Deploy RayZen.')}</h1>
      <p>${tr('Your private RayZen instance, deployed directly to')} <strong>${tr('your Cloudflare account.')}</strong></p>
    </div>
    <div class="deploy-grid">
      <article class="card primary-card">
        <div class="card-kicker">${tr('Recommended')}</div>
        <div class="choice-icon">${icon('cloud')}</div>
        <h2>${tr('Continue with Cloudflare')}</h2>
        <p>${tr('Authorize RayZen once. The Worker, storage, bindings, and public URL are prepared automatically.')}</p>
        <a class="button button-primary" id="oauth-button" href="/api/oauth/start">${icon('cloud')} ${tr('Continue with Cloudflare')} ${icon('arrow')}</a>
      </article>
      <article class="card secondary-card" id="token-card">
        <button class="disclosure" id="token-toggle" type="button" aria-expanded="false" aria-controls="token-body">
          <span class="disclosure-copy"><span class="disclosure-icon">${icon('key')}</span><span><span class="disclosure-title">${tr('Cloudflare API Token')}</span><span class="disclosure-sub">${tr('Advanced deployment')}</span></span></span>${icon('chevron','chevron')}
        </button>
        <div class="token-body" id="token-body">
          <div class="permission-list"><span class="permission">${tr('Workers Scripts · Edit')}</span><span class="permission">${tr('Workers KV Storage · Edit')}</span></div>
          <label class="field-label" for="api-token">${tr('Cloudflare API token')}</label>
          <input class="text-input" id="api-token" name="api-token" type="password" autocomplete="off" spellcheck="false" placeholder="${tr('Paste token')}">
          <div class="token-actions"><button class="button button-secondary" id="verify-token" type="button">${tr('Verify token')}</button></div>
          <div class="privacy-note">${icon('lock')}<span>${tr('Used only for this deployment. Never written to application storage.')}</span></div>
        </div>
      </article>
    </div>
    <div class="trust-row"><span class="trust-item">${icon('shield')}${tr('No GitHub')}</span><span class="trust-item">${icon('shield')}${tr('No shared panel')}</span><span class="trust-item">${icon('shield')}${tr('Your Cloudflare account')}</span></div>
  </section>`;
}

function renderHome({ openToken = false } = {}) {
  app.innerHTML = homeTemplate();
  const card = $('#token-card');
  const toggle = $('#token-toggle');
  if (openToken) { card.classList.add('token-open'); toggle.setAttribute('aria-expanded','true'); setTimeout(() => $('#api-token')?.focus(), 30); }
  toggle.addEventListener('click', () => {
    const open = card.classList.toggle('token-open');
    toggle.setAttribute('aria-expanded', String(open));
    if (open) setTimeout(() => $('#api-token')?.focus(), 30);
  });
  const oauth = $('#oauth-button');
  if (!bootstrap.oauthConfigured && !isLocal) {
    oauth.removeAttribute('href'); oauth.setAttribute('aria-disabled','true'); oauth.classList.add('button-disabled');
    oauth.addEventListener('click', (event) => { event.preventDefault(); showToast(tr('Cloudflare OAuth is not configured.')); });
  }
  $('#verify-token').addEventListener('click', verifyToken);
  $('#api-token').addEventListener('keydown', (event) => { if (event.key === 'Enter') verifyToken(); });
}

async function verifyToken() {
  const input = $('#api-token');
  const button = $('#verify-token');
  const token = input.value.trim();
  if (!token) { input.focus(); showToast(tr('Enter an API token.')); return; }
  button.disabled = true; button.textContent = tr('Verifying…');
  try {
    const result = await api('/api/auth/token', { method: 'POST', body: JSON.stringify({ token }) });
    input.value = '';
    accounts = result.accounts || [];
    if (result.autoSelected || result.resumed) {
      await refreshSession();
      renderProgress();
      deployLoop();
    } else renderAccounts();
  } catch (error) {
    showToast(error.message);
    button.disabled = false; button.textContent = tr('Verify token');
  }
}

function renderAccounts() {
  app.innerHTML = `<section class="stage"><article class="card panel">
    <div class="panel-head"><div><h2>${tr('Select account')}</h2><p>${tr('RayZen will be deployed to this Cloudflare account.')}</p></div><button class="back-link" id="disconnect" type="button">${tr('Cancel')}</button></div>
    <div class="account-list">${accounts.map((account) => `<button class="account-item" type="button" data-account="${esc(account.id)}"><span class="account-meta"><span class="account-name">${esc(account.name || tr('Cloudflare account'))}</span><span class="account-id">${esc(account.id)}</span></span>${icon('arrow')}</button>`).join('')}</div>
  </article></section>`;
  document.querySelectorAll('[data-account]').forEach((button) => button.addEventListener('click', () => selectAccount(button.dataset.account)));
  $('#disconnect').addEventListener('click', disconnect);
}

async function selectAccount(accountId) {
  const selected = document.querySelector(`[data-account="${CSS.escape(accountId)}"]`);
  if (selected) { selected.disabled = true; }
  try {
    await api('/api/account', { method: 'POST', body: JSON.stringify({ accountId }) });
    await refreshSession();
    renderProgress();
    deployLoop();
  } catch (error) {
    if (selected) selected.disabled = false;
    showToast(error.message);
  }
}

function formatMs(ms) {
  if (!Number.isFinite(Number(ms))) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

function progressTemplate(data) {
  const completed = new Set(data.completed || []);
  const steps = data.steps || [];
  return `<section class="stage progress-layout">
    <article class="card progress-card">
      <div class="progress-head"><div><h2>${tr('Deploying RayZen')}</h2><p>${esc(data.accountName || 'Cloudflare')}</p></div><span class="progress-percent">${Math.round(data.progress || 0)}%</span></div>
      <progress class="progress-track" aria-label="${tr('Deployment progress')}" value="${Math.max(0,Math.min(100,data.progress || 0))}" max="100"></progress>
      <div class="steps">${steps.map((step) => {
        const done = completed.has(step.id); const active = data.next === step.id && data.status !== 'complete';
        return `<div class="step ${done ? 'done' : active ? 'active' : ''}"><span class="step-state">${done ? icon('check') : active ? '<span class="pulse"></span>' : ''}</span><span class="step-label">${esc(tr(step.label))}</span><span class="step-time">${done ? formatMs(data.timings?.[step.id]) : active ? tr('Working') : ''}</span></div>`;
      }).join('')}</div>
    </article>
    <aside class="card summary-card">
      <h3>${tr('Deployment')}</h3>
      <div class="summary-list">
        <div class="summary-row"><span class="summary-label">${tr('Status')}</span><span class="status-pill"><span class="pulse"></span>${tr('In progress')}</span></div>
        <div class="summary-row"><span class="summary-label">${tr('Worker')}</span><span class="summary-value">${esc(data.workerName || tr('Generating…'))}</span></div>
        <div class="summary-row"><span class="summary-label">${tr('Storage')}</span><span class="summary-value">${data.namespaceId ? tr('KV ready') : tr('Pending')}</span></div>
        <div class="summary-row"><span class="summary-label">${tr('Network')}</span><span class="summary-value">${tr('Cloudflare global')}</span></div>
        <div class="summary-row"><span class="summary-label">${tr('Elapsed')}</span><span class="summary-value">${formatMs(data.durationMs || 0)}</span></div>
      </div>
      <p class="progress-note">${tr('Safe to close. Completed steps are preserved for this session.')}</p>
    </aside>
  </section>`;
}

function renderProgress() {
  if (!deployment) return renderLoading();
  app.innerHTML = progressTemplate(deployment);
}

async function deployLoop() {
  if (deploying) return;
  deploying = true; lastError = null;
  try {
    while (deployment && deployment.status !== 'complete') {
      const started = performance.now();
      const result = await api('/api/deploy/step', { method: 'POST', body: '{}' });
      deployment = result.deployment;
      renderProgress();
      await sleep(Math.max(140, 300 - (performance.now() - started)));
    }
    if (deployment?.status === 'complete') {
      history.replaceState({}, '', '/?result=complete');
      renderSuccess(deployment);
    }
  } catch (error) {
    lastError = error;
    renderError(error);
  } finally {
    deploying = false;
  }
}

function renderSuccess(data) {
  const url = data.workerUrl || '#';
  app.innerHTML = `<section class="stage"><article class="card success-card">
    <div class="success-orb">${icon('check')}</div>
    <h1>${tr('Deployment complete')}</h1>
    <p>${tr('RayZen is ready in your Cloudflare account.')}</p>
    <div class="url-box"><span class="url-text" title="${esc(url)}">${esc(url)}</span><button class="icon-button" id="copy-url" type="button" aria-label="Copy Worker URL">${icon('copy')}</button></div>
    <div class="success-actions"><a class="button button-primary" href="/api/open" target="_blank" rel="noopener">Open Panel ${icon('external')}</a><button class="button button-secondary" id="deploy-another" type="button">${tr('Deploy another')}</button><a class="button button-secondary" href="https://dash.cloudflare.com/" target="_blank" rel="noopener">${tr('Cloudflare Dashboard')} ${icon('external')}</a></div>
    <div class="success-grid">
      <div class="success-stat"><span>Worker</span><strong title="${esc(data.workerName)}">${esc(data.workerName || 'Created')}</strong></div>
      <div class="success-stat"><span>KV</span><strong>${data.namespaceId ? 'Created' : 'Ready'}</strong></div>
      <div class="success-stat"><span>${tr('Bindings')}</span><strong>${tr('Configured')}</strong></div>
      <div class="success-stat"><span>${tr('Time')}</span><strong>${formatMs(data.durationMs || 0)}</strong></div>
      <div class="success-stat"><span>${tr('Region')}</span><strong>${esc(data.region || tr('Cloudflare global network'))}</strong></div>
      <div class="success-stat"><span>${tr('Verification')}</span><strong>${data.verification === 'reachable' ? tr('Reachable') : tr('Verified')}</strong></div>
      <div class="success-stat"><span>${tr('Source')}</span><strong>${esc(data.artifactSource || tr('RayZen release'))}</strong></div>
    </div>
  </article></section>`;
  $('#copy-url').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); showToast(tr('Copied.')); } catch { showToast(tr('Copy unavailable.')); }
  });
  $('#deploy-another').addEventListener('click', async () => {
    await disconnect();
    history.replaceState({}, '', '/');
  });
}

function errorCopy(error) {
  const map = {
    AUTH_DENIED: ['Authorization cancelled','No changes were made to your Cloudflare account.','Back'],
    AUTH_FAILED: ['Cloudflare authorization failed','Cloudflare did not complete authorization.','Try again'],
    OAUTH_STATE_INVALID: ['Authorization session expired','Start Cloudflare authorization again.','Try again'],
    OAUTH_UNAVAILABLE: ['Cloudflare authorization is unavailable','Cloudflare could not be reached.','Try again'],
    ARTIFACT_MISSING: ['RayZen release is unavailable','The Wizard deployment is missing its bundled Worker artifact.','Retry'],
    ARTIFACT_INVALID: ['RayZen release is invalid','The bundled Worker artifact failed validation.','Retry'],
    DEPLOYED_ARTIFACT_MISMATCH: ['Published build mismatch','Cloudflare is not serving the exact RayZen build this Wizard uploaded.','Retry'],
    NO_ACCOUNTS: ['No Cloudflare account available','Authorize an account that can deploy Workers.','Try again'],
    AUTH_EXPIRED: deployment?.authKind === 'api_token'
      ? ['Authorization expired','Enter a Cloudflare API token to resume this deployment.','Reconnect']
      : ['Authorization expired','Reconnect Cloudflare to resume this deployment.','Reconnect'],
    CSRF_REJECTED: ['Session expired','Refresh the page to resume this deployment.','Refresh'],
    CLOUDFLARE_RATE_LIMITED: ['Cloudflare is rate limiting requests', error.retryAfter ? `Retry in about ${error.retryAfter} seconds.` : 'Retry in a moment.', 'Retry'],
    CLOUDFLARE_TIMEOUT: ['Cloudflare took too long to respond','The current step is safe to retry.','Retry'],
    CLOUDFLARE_UNAVAILABLE: ['Cloudflare is unavailable','Completed steps are preserved. Retry when Cloudflare responds.','Retry'],
    WORKER_NOT_PUBLISHED: ['Worker is not published','Retry the publishing check.','Retry'],
    DEPLOY_SESSION_EXPIRED: ['Deployment session expired','Select your Cloudflare account again.','Start again'],
    ARTIFACT_MISMATCH: ['Deployment package failed verification','The RayZen Worker did not pass its integrity check.','Start again']
  };
  if (map[error.code]) return map[error.code];
  if (error.status >= 500 || String(error.code || '').startsWith('CF_HTTP_5')) {
    return ['Cloudflare is unavailable','Completed steps are preserved. Retry when Cloudflare responds.','Retry'];
  }
  if (String(error.code || '').startsWith('CF_') || String(error.code || '').startsWith('CF_HTTP_')) {
    const current = deployment?.next;
    if (current === 'kv') return ['KV creation failed', error.message || 'Cloudflare rejected KV creation.', 'Retry'];
    if (current === 'upload') return ['Worker upload failed', error.message || 'Cloudflare rejected the Worker upload.', 'Retry'];
    if (current === 'publish') return ['Worker publication failed', error.message || 'Cloudflare could not publish the Worker.', 'Retry'];
  }
  return ['Deployment interrupted', error.message || 'The current step could not be completed.', 'Resume deployment'];
}

function renderError(error) {
  const [title, message, action] = errorCopy(error);
  app.innerHTML = `<section class="stage"><article class="card error-card">
    <div class="error-icon">${icon('alert')}</div><h2>${esc(tr(title))}</h2><p>${esc(tr(message))}</p>
    <div class="error-actions"><button class="button button-primary" id="retry" type="button">${icon('refresh')} ${esc(tr(action))}</button><button class="button button-ghost" id="cancel" type="button">${tr('Cancel')}</button></div>
  </article></section>`;
  $('#retry').addEventListener('click', async () => {
    if (error.code === 'AUTH_DENIED') { renderHome(); return; }
    if (['AUTH_FAILED','OAUTH_STATE_INVALID','OAUTH_UNAVAILABLE','NO_ACCOUNTS'].includes(error.code)) { location.href = '/api/oauth/start'; return; }
    if (error.code === 'AUTH_EXPIRED') {
      if (deployment?.authKind === 'api_token') { renderHome({ openToken: true }); return; }
      location.href = '/api/oauth/start'; return;
    }
    if (error.code === 'CSRF_REJECTED') { location.reload(); return; }
    if (error.code === 'DEPLOY_SESSION_EXPIRED' || error.code === 'ARTIFACT_MISMATCH') { await disconnect(); return; }
    renderProgress(); deployLoop();
  });
  $('#cancel').addEventListener('click', disconnect);
}

async function disconnect() {
  try { await api('/api/disconnect', { method: 'POST', body: '{}' }); } catch {}
  deployment = null; accounts = []; lastError = null; renderHome();
}

async function refreshSession() {
  const session = await api('/api/session');
  deployment = session.deployment;
  return session;
}

function previewData(status = 'deploying') {
  const steps = [
    {id:'access',label:'Validating access'},{id:'prepare',label:'Preparing deployment'},{id:'name',label:'Generating Worker name'},{id:'kv',label:'Creating KV'},{id:'upload',label:'Uploading application'},{id:'publish',label:'Publishing Worker'},{id:'verify',label:'Verifying deployment'},{id:'complete',label:'Deployment complete'}
  ];
  if (status === 'complete') return {status:'complete',authKind:'oauth',accountId:'0123456789abcdef0123456789abcdef',accountName:'RayZen Lab',next:null,completed:steps.map(s=>s.id),timings:{access:180,prepare:420,name:230,kv:710,upload:1850,publish:540,verify:820,complete:20},workerName:'rayzen-lunar-wave-a91f',namespaceId:'a1b2c3',workerUrl:'https://rayzen-lunar-wave-a91f.edge-silent-orbit-21fe.workers.dev',verification:'reachable',durationMs:5160,region:'Cloudflare global network',progress:100,steps};
  return {status:'deploying',authKind:'oauth',accountId:'0123456789abcdef0123456789abcdef',accountName:'RayZen Lab',next:'upload',completed:['access','prepare','name','kv'],timings:{access:180,prepare:420,name:230,kv:710},workerName:'rayzen-lunar-wave-a91f',namespaceId:'a1b2c3',workerUrl:null,verification:null,durationMs:1840,region:'Cloudflare global network',progress:44,steps};
}

function runPreview(mode) {
  bootstrap.oauthConfigured = true; csrf = 'preview';
  if (mode === 'home') return renderHome();
  if (mode === 'token') return renderHome({ openToken: true });
  if (mode === 'account') { accounts = [{id:'0123456789abcdef0123456789abcdef',name:'Personal account'},{id:'fedcba9876543210fedcba9876543210',name:'RayZen Lab'}]; return renderAccounts(); }
  if (mode === 'progress') { deployment = previewData(); return renderProgress(); }
  if (mode === 'success') { deployment = previewData('complete'); return renderSuccess(deployment); }
  if (mode === 'error') { const error = new Error('Cloudflare could not complete the current request.'); error.code='DEPLOYMENT_INTERRUPTED'; return renderError(error); }
  renderHome();
}

async function start() {
  initLanguage();
  initTheme();
  const params = new URLSearchParams(location.search);
  const preview = params.get('preview');
  if (isLocal && preview) { runPreview(preview); return; }
  renderLoading();
  try {
    const first = await api('/api/bootstrap');
    bootstrap = first; csrf = first.csrfToken;
    const queryError = params.get('error');
    if (queryError) {
      history.replaceState({}, '', '/');
      const known = new Set(['OAUTH_STATE_INVALID','OAUTH_UNAVAILABLE','NO_ACCOUNTS']);
      const err = new Error(queryError === 'oauth-not-configured' ? 'Cloudflare OAuth is not configured for this wizard.' : 'Cloudflare authorization was not completed.');
      err.code = queryError === 'access_denied' ? 'AUTH_DENIED' : known.has(queryError) ? queryError : 'AUTH_FAILED';
      renderError(err); return;
    }
    const session = await refreshSession();
    const explicitContinuation = params.get('connected') || params.get('resumed') === '1';
    if (session.deployment?.status === 'complete' && params.get('result') === 'complete') {
      return renderSuccess(session.deployment);
    }
    if (session.deployment && explicitContinuation) {
      renderProgress();
      deployLoop();
      return;
    }
    if (session.deployment) {
      // An ordinary navigation to `/` is a new deployment intent. Never let a stale
      // encrypted deployment cookie hijack Wizard Home; continuation is only allowed
      // after an explicit OAuth/token action or the explicit success URL.
      try { await api('/api/disconnect', { method: 'POST', body: '{}' }); } catch {}
      deployment = null;
      accounts = [];
      history.replaceState({}, '', '/');
      return renderHome();
    }
    if (session.connected) {
      const result = await api('/api/accounts');
      accounts = result.accounts || [];
      if (accounts.length === 1) { await selectAccount(accounts[0].id); return; }
      if (accounts.length) return renderAccounts();
    }
    renderHome();
  } catch (error) {
    if (isLocal) { bootstrap.oauthConfigured = true; renderHome(); }
    else renderError(error);
  }
}

start();
