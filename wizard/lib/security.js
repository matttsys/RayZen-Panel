import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from 'node:crypto';
import { sessionSecret } from './config.js';

export const COOKIE = Object.freeze({
  oauth: 'rz_oauth',
  auth: 'rz_auth',
  deploy: 'rz_deploy',
  csrf: 'rz_csrf'
});

const b64u = (value) => Buffer.from(value).toString('base64url');
const fromB64u = (value) => Buffer.from(value, 'base64url');
const key = () => createHash('sha256').update(sessionSecret()).digest();

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function pkceChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function encrypt(value, purpose) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(`rayzen:${purpose}:v1`));
  const plaintext = Buffer.from(JSON.stringify(value));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${b64u(iv)}.${b64u(ciphertext)}.${b64u(tag)}`;
}

export function decrypt(token, purpose) {
  if (!token || typeof token !== 'string') return null;
  try {
    const [version, ivText, dataText, tagText] = token.split('.');
    if (version !== 'v1' || !ivText || !dataText || !tagText) return null;
    const decipher = createDecipheriv('aes-256-gcm', key(), fromB64u(ivText));
    decipher.setAAD(Buffer.from(`rayzen:${purpose}:v1`));
    decipher.setAuthTag(fromB64u(tagText));
    const plaintext = Buffer.concat([decipher.update(fromB64u(dataText)), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  const result = {};
  const raw = String(req.headers.cookie || '');
  for (const segment of raw.split(';')) {
    const index = segment.indexOf('=');
    if (index < 1) continue;
    const name = segment.slice(0, index).trim();
    const value = segment.slice(index + 1).trim();
    try { result[name] = decodeURIComponent(value); } catch { result[name] = value; }
  }
  return result;
}

function secure(req) {
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || process.env.VERCEL === '1';
}

export function cookie(req, name, value, { maxAge = 900, httpOnly = true } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', `Max-Age=${Math.max(0, Math.floor(maxAge))}`, 'SameSite=Lax'];
  if (httpOnly) parts.push('HttpOnly');
  if (secure(req)) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(req, name) {
  return cookie(req, name, '', { maxAge: 0 });
}

function sign(value) {
  return createHmac('sha256', key()).update(value).digest('base64url');
}

function safeEqualText(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

export function createCsrf(req) {
  const raw = randomToken(24);
  return { raw, cookie: cookie(req, COOKIE.csrf, `${raw}.${sign(raw)}`, { maxAge: 3600 }) };
}

export function verifyCsrf(req) {
  const header = String(req.headers['x-rayzen-csrf'] || '');
  const stored = parseCookies(req)[COOKIE.csrf] || '';
  const split = stored.lastIndexOf('.');
  if (!header || split <= 0) return false;
  const raw = stored.slice(0, split);
  const signature = stored.slice(split + 1);
  return safeEqualText(header, raw) && safeEqualText(signature, sign(raw));
}

export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const actual = new URL(String(origin));
    const expectedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return actual.host === expectedHost;
  } catch {
    return false;
  }
}

export function requireMutationSecurity(req) {
  if (!sameOrigin(req)) throw Object.assign(new Error('Cross-origin request blocked.'), { statusCode: 403, code: 'ORIGIN_REJECTED' });
  if (!verifyCsrf(req)) throw Object.assign(new Error('Security token expired. Refresh and try again.'), { statusCode: 403, code: 'CSRF_REJECTED' });
}

export function authFrom(req) {
  const data = decrypt(parseCookies(req)[COOKIE.auth], 'auth');
  if (!data?.accessToken || !data?.issuedAt) return null;
  if (data.expiresAt && Date.now() > data.expiresAt) return null;
  return data;
}

export function deployFrom(req) {
  return decrypt(parseCookies(req)[COOKIE.deploy], 'deploy');
}
