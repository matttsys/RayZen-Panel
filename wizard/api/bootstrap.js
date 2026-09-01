import { oauthConfigured } from '../lib/config.js';
import { json, method } from '../lib/http.js';
import { createCsrf } from '../lib/security.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  const csrf = createCsrf(req);
  res.setHeader('Set-Cookie', csrf.cookie);
  json(res, 200, {
    ok: true,
    csrfToken: csrf.raw,
    oauthConfigured: oauthConfigured(),
    product: 'RayZen',
    wizardVersion: '2.0.1',
    wizardBuild: 'rayzen-wizard-20260808-1'
  });
}
