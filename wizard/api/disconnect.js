import { revokeOAuthToken } from '../lib/oauth.js';
import { handleError, securePost } from '../lib/api.js';
import { json, method } from '../lib/http.js';
import { authFrom, clearCookie, COOKIE } from '../lib/security.js';

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    securePost(req);
    const auth = authFrom(req);
    if (auth?.kind === 'oauth') await revokeOAuthToken(auth.accessToken);
    res.setHeader('Set-Cookie', [clearCookie(req, COOKIE.auth), clearCookie(req, COOKIE.deploy)]);
    json(res, 200, { ok: true });
  } catch (error) {
    handleError(res, error);
  }
}
