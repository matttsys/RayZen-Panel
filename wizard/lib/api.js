import { json, safeError } from './http.js';
import { authFrom, cookie, COOKIE, deployFrom, encrypt, requireMutationSecurity } from './security.js';

export function handleError(res, error) {
  const safe = safeError(error);
  const body = { ok: false, error: safe.message, code: safe.code };
  if (safe.retryAfter !== null) body.retryAfter = safe.retryAfter;
  json(res, safe.status, body, safe.retryAfter !== null ? { 'Retry-After': String(safe.retryAfter) } : {});
}

export function requireAuth(req) {
  const auth = authFrom(req);
  if (!auth) throw Object.assign(new Error('Cloudflare authorization expired. Reconnect to continue.'), { statusCode: 401, code: 'AUTH_EXPIRED' });
  return auth;
}

export function requireDeploy(req) {
  const state = deployFrom(req);
  if (!state) throw Object.assign(new Error('Deployment session expired. Select the account again.'), { statusCode: 409, code: 'DEPLOY_SESSION_EXPIRED' });
  return state;
}

export function securePost(req) {
  requireMutationSecurity(req);
}

export function authCookie(req, auth, maxAge = 1200) {
  return cookie(req, COOKIE.auth, encrypt(auth, 'auth'), { maxAge });
}

export function deployCookie(req, state, maxAge = 3600) {
  return cookie(req, COOKIE.deploy, encrypt(state, 'deploy'), { maxAge });
}
