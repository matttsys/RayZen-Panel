import { publicDeployment, runNextStep } from '../../lib/deployment.js';
import { revokeOAuthToken } from '../../lib/oauth.js';
import { clearCookie, COOKIE } from '../../lib/security.js';
import { deployCookie, handleError, requireAuth, requireDeploy, securePost } from '../../lib/api.js';
import { json, method } from '../../lib/http.js';

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    securePost(req);
    const auth = requireAuth(req);
    const state = requireDeploy(req);
    const updated = await runNextStep(auth.accessToken, state);
    const cookies = [deployCookie(req, updated, updated.status === 'complete' ? 86_400 : 3_600)];
    if (updated.status === 'complete') {
      if (auth.kind === 'oauth') await revokeOAuthToken(auth.accessToken);
      cookies.push(clearCookie(req, COOKIE.auth));
    }
    res.setHeader('Set-Cookie', cookies);
    json(res, 200, { ok: true, deployment: publicDeployment(updated) });
  } catch (error) {
    handleError(res, error);
  }
}
