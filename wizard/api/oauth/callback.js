import { listAccounts } from '../../lib/cloudflare.js';
import { exchangeCode } from '../../lib/oauth.js';
import { publicOrigin } from '../../lib/config.js';
import { redirect } from '../../lib/http.js';
import { authCookie, deployCookie } from '../../lib/api.js';
import { clearCookie, COOKIE, decrypt, deployFrom, parseCookies } from '../../lib/security.js';
import { freshDeployment } from '../../lib/deployment.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(); }
  const origin = publicOrigin(req);
  const query = new URL(req.url, origin).searchParams;
  if (query.get('error')) return redirect(res, `/?error=${encodeURIComponent(query.get('error'))}`, [clearCookie(req, COOKIE.oauth)]);
  try {
    const oauth = decrypt(parseCookies(req)[COOKIE.oauth], 'oauth');
    const state = query.get('state');
    const code = query.get('code');
    if (!oauth || !state || state !== oauth.state || Date.now() - oauth.issuedAt > 10 * 60_000) {
      throw Object.assign(new Error('Authorization session expired.'), { code: 'OAUTH_STATE_INVALID' });
    }
    if (!code) throw Object.assign(new Error('Cloudflare did not return an authorization code.'), { code: 'OAUTH_CODE_MISSING' });
    const token = await exchangeCode(req, code, oauth.verifier);
    const rawExpiresIn = Number(token.expires_in);
    const expiresIn = Number.isFinite(rawExpiresIn) && rawExpiresIn > 0 ? Math.min(Math.floor(rawExpiresIn), 1200) : 900;
    const now = Date.now();
    const auth = {
      kind: 'oauth',
      accessToken: token.access_token,
      issuedAt: now,
      expiresAt: now + expiresIn * 1000
    };
    const accounts = await listAccounts(auth.accessToken);
    if (!accounts.length) throw Object.assign(new Error('No Cloudflare account is available for this authorization.'), { code: 'NO_ACCOUNTS' });
    const cookies = [authCookie(req, auth, expiresIn), clearCookie(req, COOKIE.oauth)];
    const existing = deployFrom(req);
    const resumable = existing?.status !== 'complete' && accounts.some((account) => account.id === existing?.accountId);
    if (resumable) {
      existing.authKind = 'oauth';
      cookies.push(deployCookie(req, existing));
    } else if (accounts.length === 1) {
      cookies.push(deployCookie(req, freshDeployment(accounts[0], 'oauth')));
    } else if (existing) {
      cookies.push(clearCookie(req, COOKIE.deploy));
    }
    return redirect(res, `/?connected=oauth&accounts=${accounts.length}${resumable ? '&resumed=1' : ''}`, cookies);
  } catch (error) {
    return redirect(res, `/?error=${encodeURIComponent(error.code || 'oauth-failed')}`, [clearCookie(req, COOKIE.oauth)]);
  }
}
