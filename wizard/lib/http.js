export function json(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(JSON.stringify(body));
}

export function redirect(res, location, cookies = []) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.end();
}

export async function readJson(req, maxBytes = 16_384) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON body.'), { statusCode: 400 });
  }
}

export function method(req, res, allowed) {
  if (allowed.includes(req.method)) return true;
  res.setHeader('Allow', allowed.join(', '));
  json(res, 405, { error: 'Method not allowed.' });
  return false;
}

export function safeError(error) {
  const status = Number(error?.statusCode || 500);
  return {
    status: status >= 400 && status <= 599 ? status : 500,
    message: status >= 500 && error?.expose !== true ? 'The deployment service could not complete this request.' : String(error?.message || 'Request failed.'),
    code: String(error?.code || 'REQUEST_FAILED'),
    retryAfter: Number.isFinite(Number(error?.retryAfter)) ? Math.max(0, Math.ceil(Number(error.retryAfter))) : null
  };
}
