import { oauthConfigured, CF } from '../../lib/config.js';
import { redirectUri } from '../../lib/oauth.js';
import { redirect } from '../../lib/http.js';
import { cookie, COOKIE, encrypt, pkceChallenge, randomToken, sameOrigin } from '../../lib/security.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(); }
  if (!sameOrigin(req)) return redirect(res, '/?error=origin');
  if (!oauthConfigured()) return redirect(res, '/?error=oauth-not-configured');
  const state = randomToken(24);
  const verifier = randomToken(48);
  const session = encrypt({ state, verifier, issuedAt: Date.now() }, 'oauth');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.CLOUDFLARE_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri(req),
    scope: process.env.CLOUDFLARE_OAUTH_SCOPES,
    state,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: 'S256'
  });
  return redirect(res, `${CF.authorizeUrl}?${params.toString()}`, [cookie(req, COOKIE.oauth, session, { maxAge: 600 })]);
}
