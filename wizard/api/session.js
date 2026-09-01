import { publicDeployment } from '../lib/deployment.js';
import { json, method } from '../lib/http.js';
import { authFrom, deployFrom } from '../lib/security.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  const auth = authFrom(req);
  const state = deployFrom(req);
  json(res, 200, {
    ok: true,
    connected: Boolean(auth) || state?.status === 'complete',
    authKind: auth?.kind || null,
    deployment: publicDeployment(state)
  });
}
