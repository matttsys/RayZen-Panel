import { requireDeploy } from '../lib/api.js';
import { method, redirect } from '../lib/http.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const state = requireDeploy(req);
    if (state.status !== 'complete' || !state.workerUrl) {
      throw Object.assign(new Error('RayZen is not ready to open.'), { statusCode: 409, code: 'DEPLOYMENT_NOT_READY' });
    }
    res.setHeader('Referrer-Policy', 'no-referrer');
    redirect(res, `${state.workerUrl}/`);
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    res.statusCode = status >= 400 && status <= 599 ? status : 500;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(error?.message || 'Unable to open RayZen.');
  }
}
