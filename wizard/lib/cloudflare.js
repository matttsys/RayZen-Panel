import { CF } from './config.js';

export class CloudflareError extends Error {
  constructor(message, { status = 502, code = 'CLOUDFLARE_ERROR', details = [], response = null, retryAfter = null } = {}) {
    super(message);
    this.name = 'CloudflareError';
    this.statusCode = status;
    this.code = code;
    this.details = details;
    this.response = response;
    this.retryAfter = retryAfter;
    this.expose = true;
  }
}

async function parseResponse(response) {
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { body, text };
}

function retryAfterSeconds(response) {
  const raw = response.headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(raw);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

export async function cfRequest(accessToken, path, { method = 'GET', body, headers = {}, rawBody, timeoutMs = 20_000 } = {}) {
  if (!accessToken) throw new CloudflareError('Cloudflare authorization is missing.', { status: 401, code: 'AUTH_MISSING' });
  const requestHeaders = { Authorization: `Bearer ${accessToken}`, ...headers };
  let requestBody = rawBody;
  if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${CF.apiBase}${path}`, {
      method,
      headers: requestHeaders,
      body: requestBody,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const name = String(error?.name || '');
    if (name === 'AbortError' || name === 'TimeoutError') {
      throw new CloudflareError('Cloudflare took too long to respond.', { status: 504, code: 'CLOUDFLARE_TIMEOUT' });
    }
    throw new CloudflareError('Unable to reach Cloudflare.', { status: 503, code: 'CLOUDFLARE_UNAVAILABLE' });
  }

  const parsed = await parseResponse(response);
  const failures = Array.isArray(parsed.body?.errors) ? parsed.body.errors : [];
  if (!response.ok || parsed.body?.success === false) {
    const message = failures.map((item) => item?.message).filter(Boolean).join('; ') || `Cloudflare API returned ${response.status}.`;
    const rateLimited = response.status === 429;
    throw new CloudflareError(message, {
      status: response.status >= 400 && response.status <= 599 ? response.status : 502,
      code: rateLimited ? 'CLOUDFLARE_RATE_LIMITED' : failures[0]?.code ? `CF_${failures[0].code}` : `CF_HTTP_${response.status}`,
      details: failures,
      response: parsed.body,
      retryAfter: rateLimited ? retryAfterSeconds(response) : null
    });
  }
  return parsed.body;
}

export async function verifyApiToken(token) {
  const result = await cfRequest(token, '/user/tokens/verify');
  const status = result?.result?.status;
  if (status && status !== 'active') {
    throw new CloudflareError('Cloudflare API token is not active.', { status: 401, code: 'TOKEN_INACTIVE' });
  }
  return result?.result || {};
}

export async function listAccounts(token) {
  const accounts = [];
  for (let page = 1; page <= 5; page += 1) {
    const payload = await cfRequest(token, `/accounts?per_page=50&page=${page}&direction=asc`);
    const result = Array.isArray(payload?.result) ? payload.result : [];
    accounts.push(...result.map(({ id, name }) => ({ id, name })));
    const info = payload?.result_info;
    if (!info || page >= Number(info.total_pages || 1)) break;
  }
  return accounts;
}

export async function accountDetails(token, accountId) {
  const payload = await cfRequest(token, `/accounts/${encodeURIComponent(accountId)}`);
  const { id, name } = payload?.result || {};
  if (!id) throw new CloudflareError('Cloudflare account could not be read.', { code: 'ACCOUNT_UNAVAILABLE' });
  return { id, name };
}

export async function getWorkersSubdomain(token, accountId) {
  try {
    const payload = await cfRequest(token, `/accounts/${encodeURIComponent(accountId)}/workers/subdomain`);
    return payload?.result?.subdomain || null;
  } catch (error) {
    const text = `${error?.message || ''}`.toLowerCase();
    if (error?.code === 'CF_10007' || text.includes('subdomain') && (text.includes('not') || text.includes('missing'))) return null;
    throw error;
  }
}

export async function createWorkersSubdomain(token, accountId, subdomain) {
  const payload = await cfRequest(token, `/accounts/${encodeURIComponent(accountId)}/workers/subdomain`, {
    method: 'PUT', body: { subdomain }
  });
  return payload?.result?.subdomain || subdomain;
}

export async function listWorkerNames(token, accountId) {
  const payload = await cfRequest(token, `/accounts/${encodeURIComponent(accountId)}/workers/scripts`);
  return new Set((Array.isArray(payload?.result) ? payload.result : []).map((item) => item?.id).filter(Boolean));
}


export async function listKvNamespaceTitles(token, accountId) {
  const titles = new Set();
  for (let page = 1; page <= 10; page += 1) {
    const payload = await cfRequest(token, `/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces?per_page=100&page=${page}&order=title&direction=asc`);
    const result = Array.isArray(payload?.result) ? payload.result : [];
    for (const item of result) if (item?.title) titles.add(item.title);
    const info = payload?.result_info;
    if (!info || result.length === 0 || page * Number(info.per_page || 100) >= Number(info.total_count || titles.size)) break;
  }
  return titles;
}

export async function findKvNamespace(token, accountId, title) {
  for (let page = 1; page <= 10; page += 1) {
    const payload = await cfRequest(token, `/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces?per_page=100&page=${page}&order=title&direction=asc`);
    const result = Array.isArray(payload?.result) ? payload.result : [];
    const found = result.find((item) => item?.title === title);
    if (found?.id) return found;
    const info = payload?.result_info;
    if (!info || result.length === 0 || page * Number(info.per_page || 100) >= Number(info.total_count || result.length)) break;
  }
  return null;
}

export async function createKv(token, accountId, title) {
  const payload = await cfRequest(token, `/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces`, {
    method: 'POST', body: { title }
  });
  return payload?.result;
}

export async function uploadWorker(token, accountId, workerName, { code, manifest, namespaceId }) {
  const metadata = {
    main_module: manifest.entry,
    compatibility_date: manifest.compatibilityDate,
    compatibility_flags: manifest.compatibilityFlags || [],
    bindings: [{ type: 'kv_namespace', name: manifest.kvBinding, namespace_id: namespaceId }]
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append(manifest.entry, new Blob([code], { type: 'application/javascript+module' }), manifest.entry);
  return cfRequest(token, `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}`, {
    method: 'PUT', rawBody: form
  });
}


export async function publishWorker(token, accountId, workerName) {
  return cfRequest(token, `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}/subdomain`, {
    method: 'POST', body: { enabled: true, previews_enabled: false }
  });
}

export async function getWorkerSubdomainState(token, accountId, workerName) {
  const payload = await cfRequest(token, `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}/subdomain`);
  return payload?.result || {};
}
