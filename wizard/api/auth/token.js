import { listAccounts, verifyApiToken } from '../../lib/cloudflare.js';
import { freshDeployment } from '../../lib/deployment.js';
import { deployFrom } from '../../lib/security.js';
import { authCookie, deployCookie, handleError, securePost } from '../../lib/api.js';
import { json, method, readJson } from '../../lib/http.js';

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    securePost(req);
    const body = await readJson(req, 8192);
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (token.length < 20 || token.length > 4096) throw Object.assign(new Error('Enter a valid Cloudflare API token.'), { statusCode: 400, code: 'TOKEN_INVALID' });
    await verifyApiToken(token);
    const accounts = await listAccounts(token);
    if (!accounts.length) throw Object.assign(new Error('This token cannot access a Cloudflare account.'), { statusCode: 403, code: 'NO_ACCOUNTS' });
    const auth = { kind: 'api_token', accessToken: token, issuedAt: Date.now(), expiresAt: Date.now() + 20 * 60_000 };
    const cookies = [authCookie(req, auth, 1200)];
    const existing = deployFrom(req);
    const resumable = existing?.status !== 'complete' && accounts.some((account) => account.id === existing?.accountId);
    if (resumable) {
      existing.authKind = 'api_token';
      cookies.push(deployCookie(req, existing));
    } else if (accounts.length === 1) {
      cookies.push(deployCookie(req, freshDeployment(accounts[0], 'api_token')));
    }
    res.setHeader('Set-Cookie', cookies);
    json(res, 200, { ok: true, accounts, resumed: Boolean(resumable), autoSelected: Boolean(resumable) || accounts.length === 1 });
  } catch (error) {
    handleError(res, error);
  }
}
