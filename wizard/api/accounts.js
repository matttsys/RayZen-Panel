import { listAccounts } from '../lib/cloudflare.js';
import { handleError, requireAuth } from '../lib/api.js';
import { json, method } from '../lib/http.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const auth = requireAuth(req);
    const accounts = await listAccounts(auth.accessToken);
    json(res, 200, { ok: true, accounts });
  } catch (error) {
    handleError(res, error);
  }
}
