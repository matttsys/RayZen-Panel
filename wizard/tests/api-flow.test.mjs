import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import bootstrapHandler from '../api/bootstrap.js';
import tokenHandler from '../api/auth/token.js';
import sessionHandler from '../api/session.js';
import stepHandler from '../api/deploy/step.js';
import oauthCallbackHandler from '../api/oauth/callback.js';
import openHandler from '../api/open.js';
import { deployCookie } from '../lib/api.js';
import { freshDeployment } from '../lib/deployment.js';
import { cookie, COOKIE, encrypt } from '../lib/security.js';

process.env.WIZARD_SESSION_SECRET = 'integration-secret-abcdefghijklmnopqrstuvwxyz-0123456789';

const releaseManifest = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../artifacts/manifest.json', import.meta.url), 'utf8'));
const expectedSetupBuild = releaseManifest.setupBuildMarker;

class MockResponse {
  constructor(){ this.statusCode=200; this.headers=new Map(); this.body=''; }
  setHeader(name,value){ this.headers.set(String(name).toLowerCase(),value); }
  getHeader(name){ return this.headers.get(String(name).toLowerCase()); }
  end(value=''){ this.body += value || ''; }
}

function req(method, { body='', headers={}, url='/' } = {}) {
  const stream = Readable.from(body ? [Buffer.from(body)] : []);
  stream.method = method;
  stream.url = url;
  stream.headers = { host:'wizard.test', 'x-forwarded-proto':'https', ...headers };
  return stream;
}

function absorbCookies(jar, response) {
  const values = response.getHeader('set-cookie');
  for (const raw of (Array.isArray(values) ? values : values ? [values] : [])) {
    const pair = raw.split(';',1)[0];
    const i = pair.indexOf('=');
    const name = pair.slice(0,i); const value = pair.slice(i+1);
    if (/Max-Age=0(?:;|$)/i.test(raw)) jar.delete(name); else jar.set(name,value);
  }
}
const cookieHeader = (jar) => [...jar].map(([k,v])=>`${k}=${v}`).join('; ');
const bodyJson = (res) => JSON.parse(res.body || '{}');

function cfJson(result, result_info) {
  return new Response(JSON.stringify({ success:true, errors:[], messages:[], result, ...(result_info ? {result_info}: {}) }), { status:200, headers:{'Content-Type':'application/json'} });
}

test('API-token path reaches the same complete Worker deployment state', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options={}) => {
    const u = String(url); const method = options.method || 'GET'; calls.push([method,u]);
    if (u.endsWith('/user/tokens/verify')) return cfJson({ status:'active' });
    if (/\/accounts\?/.test(u)) return cfJson([{ id:'a'.repeat(32), name:'Test Account' }], { page:1, per_page:50, total_pages:1, total_count:1 });
    if (u.endsWith(`/accounts/${'a'.repeat(32)}`)) return cfJson({ id:'a'.repeat(32), name:'Test Account' });
    if (u.endsWith('/workers/subdomain') && method === 'GET' && !u.includes('/scripts/')) return cfJson({ subdomain:'rayzen-test' });
    if (u.endsWith('/workers/scripts') && method === 'GET') return cfJson([]);
    if (u.includes('/storage/kv/namespaces?') && method === 'GET') return cfJson([], { page:1, per_page:100, total_count:0 });
    if (u.endsWith('/storage/kv/namespaces') && method === 'POST') return cfJson({ id:'b'.repeat(32), title:'rayzen-lunar-wave-a91f' });
    if (/\/workers\/scripts\/[^/]+$/.test(u) && method === 'PUT') {
      assert.ok(options.body instanceof FormData, 'Worker upload should use multipart FormData');
      return cfJson({ id:'uploaded' });
    }
    if (u.endsWith('/subdomain') && u.includes('/workers/scripts/') && method === 'POST') return cfJson({ enabled:true, previews_enabled:false });
    if (u.endsWith('/subdomain') && u.includes('/workers/scripts/') && method === 'GET') return cfJson({ enabled:true, previews_enabled:false });
    if (u.startsWith('https://rayzen-') && u.endsWith('.rayzen-test.workers.dev/')) return new Response(`<!doctype html><body data-rayzen-setup-build=${expectedSetupBuild}></body>`, { status:200, headers:{'Content-Type':'text/html'} });
    throw new Error(`Unexpected fetch ${method} ${u}`);
  };

  try {
    const jar = new Map();
    let res = new MockResponse();
    await bootstrapHandler(req('GET'), res);
    absorbCookies(jar,res);
    const boot = bodyJson(res);
    assert.ok(boot.csrfToken);

    res = new MockResponse();
    await tokenHandler(req('POST', {
      body: JSON.stringify({ token:'token-value-abcdefghijklmnopqrstuvwxyz' }),
      headers:{ cookie:cookieHeader(jar), origin:'https://wizard.test', 'x-rayzen-csrf':boot.csrfToken }
    }), res);
    absorbCookies(jar,res);
    assert.equal(res.statusCode,200);
    assert.equal(bodyJson(res).autoSelected,true);

    res = new MockResponse();
    await sessionHandler(req('GET',{headers:{cookie:cookieHeader(jar)}}),res);
    let session=bodyJson(res);
    assert.equal(session.deployment.status,'ready');

    for (let i=0;i<4;i+=1) {
      res = new MockResponse();
      await stepHandler(req('POST',{headers:{cookie:cookieHeader(jar), origin:'https://wizard.test', 'x-rayzen-csrf':boot.csrfToken}}),res);
      absorbCookies(jar,res);
      assert.equal(res.statusCode,200, res.body);
      session=bodyJson(res);
    }
    const beforeReconnect = session.deployment;
    assert.equal(beforeReconnect.next, 'upload');
    assert.ok(beforeReconnect.workerName);
    assert.ok(beforeReconnect.namespaceId);

    // Simulate an expired short-lived credential while the durable deployment cookie remains.
    jar.delete('rz_auth');
    res = new MockResponse();
    await tokenHandler(req('POST', {
      body: JSON.stringify({ token:'token-value-abcdefghijklmnopqrstuvwxyz' }),
      headers:{ cookie:cookieHeader(jar), origin:'https://wizard.test', 'x-rayzen-csrf':boot.csrfToken }
    }), res);
    absorbCookies(jar,res);
    assert.equal(res.statusCode,200);
    assert.equal(bodyJson(res).resumed,true);

    res = new MockResponse();
    await sessionHandler(req('GET',{headers:{cookie:cookieHeader(jar)}}),res);
    session=bodyJson(res);
    assert.equal(session.deployment.workerName,beforeReconnect.workerName);
    assert.equal(session.deployment.namespaceId,beforeReconnect.namespaceId);
    assert.equal(session.deployment.next,'upload');
    assert.equal(session.deployment.authKind,'api_token');

    for (let i=0;i<4;i+=1) {
      res = new MockResponse();
      await stepHandler(req('POST',{headers:{cookie:cookieHeader(jar), origin:'https://wizard.test', 'x-rayzen-csrf':boot.csrfToken}}),res);
      absorbCookies(jar,res);
      assert.equal(res.statusCode,200, res.body);
      session=bodyJson(res);
    }
    assert.equal(session.deployment.status,'complete');
    assert.equal(session.deployment.progress,100);
    assert.equal(session.deployment.namespaceId,'b'.repeat(32));
    assert.match(session.deployment.workerName,/^rayzen-/);
    assert.match(session.deployment.workerUrl,/\.rayzen-test\.workers\.dev$/);
    assert.equal('setupToken' in session.deployment,false);
    assert.equal('setupProtected' in session.deployment,false);
    assert.equal(calls.some(([m,u])=>m==='GET' && u.includes('raw.githubusercontent.com')), false);
    assert.equal(session.deployment.artifactSource,'RayZen 1.0.0 release');
    assert.match(session.deployment.artifactSha256,/^[a-f0-9]{64}$/);
    assert.ok(calls.some(([m,u])=>m==='PUT' && /\/workers\/scripts\/[^/]+$/.test(u)));
    assert.equal(calls.some(([m,u])=>u.endsWith('/secrets')), false);
    assert.ok(calls.some(([m,u])=>m==='POST' && u.endsWith('/storage/kv/namespaces')));
  } finally {
    global.fetch = originalFetch;
  }
});


test('completed deployment opens the Worker root without a setup capability', async () => {
  const jar = new Map();
  const cookieReq = req('GET');
  const state = freshDeployment({ id:'e'.repeat(32), name:'Setup Account' }, 'oauth');
  state.status = 'complete';
  state.next = null;
  state.workerName = 'rayzen-crystal-harbor-abcdef';
  state.workerUrl = 'https://rayzen-crystal-harbor-abcdef.rayzen-test.workers.dev';
  const raw = deployCookie(cookieReq, state, 86_400);
  const pair = raw.split(';',1)[0];
  const i = pair.indexOf('=');
  jar.set(pair.slice(0,i), pair.slice(i+1));

  const res = new MockResponse();
  await openHandler(req('GET',{headers:{cookie:cookieHeader(jar)}}),res);
  assert.equal(res.statusCode,302);
  assert.equal(res.getHeader('referrer-policy'),'no-referrer');
  assert.equal(res.getHeader('location'), `${state.workerUrl}/`);
  assert.doesNotMatch(String(res.getHeader('location')), /#setup=|token/i);
});


test('OAuth reauthorization resumes the same partially-created deployment', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (u === 'https://dash.cloudflare.com/oauth2/token') {
      return new Response(JSON.stringify({ access_token:'oauth-access-token', expires_in:600, token_type:'bearer' }), { status:200, headers:{'Content-Type':'application/json'} });
    }
    if (/\/accounts\?/.test(u)) return cfJson([{ id:'c'.repeat(32), name:'OAuth Account' }], { page:1, per_page:50, total_pages:1, total_count:1 });
    throw new Error(`Unexpected fetch ${u}`);
  };
  try {
    const jar = new Map();
    const cookieReq = req('GET');
    const state = freshDeployment({ id:'c'.repeat(32), name:'OAuth Account' }, 'oauth');
    state.status = 'deploying'; state.next = 'upload'; state.completed = ['access','prepare','name','kv'];
    state.subdomain = 'existing-subdomain'; state.workerName = 'rayzen-silent-wave-abcdef';
    state.namespaceId = 'd'.repeat(32); state.namespaceTitle = state.workerName;

    const oauthValue = encrypt({ state:'oauth-state', verifier:'oauth-verifier', issuedAt:Date.now() }, 'oauth');
    for (const raw of [cookie(cookieReq, COOKIE.oauth, oauthValue, { maxAge:600 }), deployCookie(cookieReq, state)]) {
      const pair = raw.split(';',1)[0]; const i = pair.indexOf('='); jar.set(pair.slice(0,i), pair.slice(i+1));
    }

    const res = new MockResponse();
    await oauthCallbackHandler(req('GET', {
      url:'/?code=auth-code&state=oauth-state',
      headers:{ cookie:cookieHeader(jar) }
    }), res);
    absorbCookies(jar,res);
    assert.equal(res.statusCode,302);
    assert.match(String(res.getHeader('location')), /resumed=1/);

    const sessionRes = new MockResponse();
    await sessionHandler(req('GET',{headers:{cookie:cookieHeader(jar)}}), sessionRes);
    const session = bodyJson(sessionRes);
    assert.equal(session.deployment.workerName,state.workerName);
    assert.equal(session.deployment.namespaceId,state.namespaceId);
    assert.equal(session.deployment.next,'upload');
    assert.equal(session.deployment.authKind,'oauth');
  } finally { global.fetch = originalFetch; }
});
