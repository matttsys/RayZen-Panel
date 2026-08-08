export const CF = Object.freeze({
  apiBase: 'https://api.cloudflare.com/client/v4',
  authorizeUrl: 'https://dash.cloudflare.com/oauth2/auth',
  tokenUrl: 'https://dash.cloudflare.com/oauth2/token',
  revokeUrl: 'https://dash.cloudflare.com/oauth2/revoke'
});

export function oauthConfigured() {
  return Boolean(
    process.env.CLOUDFLARE_OAUTH_CLIENT_ID &&
    process.env.CLOUDFLARE_OAUTH_CLIENT_SECRET &&
    process.env.CLOUDFLARE_OAUTH_SCOPES &&
    process.env.WIZARD_SESSION_SECRET
  );
}

export function publicOrigin(req) {
  if (process.env.WIZARD_PUBLIC_URL) return process.env.WIZARD_PUBLIC_URL.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) throw new Error('Unable to determine wizard origin. Set WIZARD_PUBLIC_URL.');
  return `${proto}://${host}`;
}

export function sessionSecret() {
  const secret = process.env.WIZARD_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('WIZARD_SESSION_SECRET must contain at least 32 characters.');
  return secret;
}
