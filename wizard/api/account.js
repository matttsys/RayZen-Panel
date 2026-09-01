import { accountDetails } from '../lib/cloudflare.js';
import { freshDeployment } from '../lib/deployment.js';
import { deployCookie, handleError, requireAuth, securePost } from '../lib/api.js';
import { json, method, readJson } from '../lib/http.js';

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    securePost(req);
    const auth = requireAuth(req);
    const body = await readJson(req);
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    if (!/^[a-f0-9]{32}$/i.test(accountId)) throw Object.assign(new Error('Select a valid Cloudflare account.'), { statusCode: 400, code: 'ACCOUNT_INVALID' });
    const account = await accountDetails(auth.accessToken, accountId);
    const state = freshDeployment(account, auth.kind);
    res.setHeader('Set-Cookie', deployCookie(req, state));
    json(res, 200, { ok: true, account });
  } catch (error) {
    handleError(res, error);
  }
}
