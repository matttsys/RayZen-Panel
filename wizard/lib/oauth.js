import { CF, publicOrigin } from './config.js';

export function redirectUri(req) {
  return `${publicOrigin(req)}/api/oauth/callback`;
}

export async function exchangeCode(req, code, verifier) {
  const clientId = process.env.CLOUDFLARE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.CLOUDFLARE_OAUTH_CLIENT_SECRET;
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(req),
    code_verifier: verifier
  });
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  let response;
  try {
    response = await fetch(CF.tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: form,
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw Object.assign(new Error('Unable to reach Cloudflare authorization.'), { statusCode: 503, code: 'OAUTH_UNAVAILABLE' });
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw Object.assign(new Error('Cloudflare authorization could not be completed.'), { statusCode: 401, code: 'OAUTH_EXCHANGE_FAILED' });
  }
  return body;
}

export async function revokeOAuthToken(accessToken) {
  if (!accessToken) return false;
  try {
    const clientId = process.env.CLOUDFLARE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.CLOUDFLARE_OAUTH_CLIENT_SECRET;
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await fetch(CF.revokeUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ token: accessToken }),
      signal: AbortSignal.timeout(8_000)
    });
    return response.ok;
  } catch {
    return false;
  }
}
