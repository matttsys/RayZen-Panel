/** Dependency-free HS256 JWT for the Cloudflare Worker runtime. */
export interface RayZenJwtPayload {
    id: string;
    iat: number;
    exp: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeBase64Url(value: string | Uint8Array): string {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

/**
 * Returned as `Uint8Array<ArrayBuffer>` rather than the default
 * `Uint8Array<ArrayBufferLike>`: `crypto.subtle` takes `BufferSource`, which excludes
 * a `SharedArrayBuffer`-backed view, so the narrower type is what makes the WebCrypto
 * calls below typecheck without a cast.
 */
function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
    if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('invalid base64url');
    const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function hmacKey(secret: Uint8Array<ArrayBuffer>, usage: KeyUsage[]): Promise<CryptoKey> {
    return crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, usage);
}

export async function signRayZenJwt(id: string, secret: Uint8Array<ArrayBuffer>, lifetimeSeconds = 24 * 60 * 60): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = encodeBase64Url(JSON.stringify({ id, iat: now, exp: now + lifetimeSeconds } satisfies RayZenJwtPayload));
    const input = `${header}.${payload}`;
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret, ['sign']), encoder.encode(input)));
    return `${input}.${encodeBase64Url(signature)}`;
}

export async function verifyRayZenJwt(token: string, secret: Uint8Array<ArrayBuffer>): Promise<RayZenJwtPayload> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('invalid token');
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = JSON.parse(decoder.decode(decodeBase64Url(encodedHeader))) as { alg?: unknown; typ?: unknown };
    if (header.alg !== 'HS256') throw new Error('unsupported algorithm');

    const verified = await crypto.subtle.verify(
        'HMAC',
        await hmacKey(secret, ['verify']),
        decodeBase64Url(encodedSignature),
        encoder.encode(`${encodedHeader}.${encodedPayload}`)
    );
    if (!verified) throw new Error('invalid signature');

    const payload = JSON.parse(decoder.decode(decodeBase64Url(encodedPayload))) as Partial<RayZenJwtPayload>;
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.id !== 'string' || typeof payload.iat !== 'number' || typeof payload.exp !== 'number') throw new Error('invalid payload');
    if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp) || payload.exp <= now || payload.iat > now + 60) throw new Error('expired token');
    return payload as RayZenJwtPayload;
}
