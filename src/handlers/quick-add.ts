import { HttpStatus, respond, safeError } from '@common';
import { authenticate } from '@auth';
import { signRayZenJwt } from '../auth/jwt';
import { getGlobals } from '@settings';
import { createStorage } from '@storage';

const QUICK_ADD_KEY_PREFIX = 'rz:quick_add:';
const DEFAULT_TTL_SECONDS = 600; // 10 minutes

interface QuickAddEntry {
    token: string;
    createdAt: number;
    expiresAt: number;
    used: boolean;
}

function sessionSubject(): string {
    const { accID, accEmail } = getGlobals();
    return accID || accEmail;
}

function generateSecretKey(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function compressAndEncodePayload(payload: Record<string, unknown>): Promise<string> {
    const jsonStr = JSON.stringify(payload);
    const stream = new Blob([jsonStr]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const compressedBuf = await new Response(stream).arrayBuffer();
    const bytes = new Uint8Array(compressedBuf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function mintQuickAdd(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }
    const isAuthed = await authenticate(request, env);
    if (!isAuthed) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
    }

    try {
        let ttlSeconds = DEFAULT_TTL_SECONDS;
        try {
            const body = await request.json() as { ttl?: number };
            if (typeof body?.ttl === 'number' && body.ttl >= 60 && body.ttl <= 3600) {
                ttlSeconds = Math.round(body.ttl);
            }
        } catch {
            // default ttl
        }

        const { hostname, securePath } = getGlobals();
        const token = crypto.randomUUID().replace(/-/g, '');
        const now = Date.now();
        const expiresAt = now + ttlSeconds * 1000;

        const entry: QuickAddEntry = {
            token,
            createdAt: now,
            expiresAt,
            used: false,
        };

        await env.kv.put(
            `${QUICK_ADD_KEY_PREFIX}${token}`,
            JSON.stringify(entry),
            { expirationTtl: Math.max(60, ttlSeconds) }
        );

        const payloadObj = {
            v: 1,
            h: hostname,
            p: securePath,
            t: token,
        };

        const encodedPayload = await compressAndEncodePayload(payloadObj);
        const code = `rayzen://v1/${encodedPayload}`;

        return respond(true, HttpStatus.OK, 'Quick add code minted successfully.', {
            code,
            token,
            expiresAt,
            ttl: ttlSeconds,
            payload: payloadObj,
        });
    } catch (err) {
        return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Failed to mint quick-add code: ${safeError(err)}`);
    }
}

export async function revokeQuickAdd(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }
    const isAuthed = await authenticate(request, env);
    if (!isAuthed) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
    }

    try {
        const body = await request.json() as { token?: string };
        const token = body?.token;
        if (!token || typeof token !== 'string') {
            return respond(false, HttpStatus.BAD_REQUEST, 'Missing or invalid token.');
        }

        await env.kv.delete(`${QUICK_ADD_KEY_PREFIX}${token}`);
        return respond(true, HttpStatus.OK, 'Quick add token revoked.');
    } catch (err) {
        return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Failed to revoke token: ${safeError(err)}`);
    }
}

export async function redeemQuickAdd(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    try {
        const body = await request.json() as { token?: string };
        const token = body?.token?.trim();
        if (!token) {
            return respond(false, HttpStatus.BAD_REQUEST, 'Missing token.');
        }

        const kvKey = `${QUICK_ADD_KEY_PREFIX}${token}`;
        const stored = await env.kv.get<QuickAddEntry>(kvKey, { type: 'json' });

        if (!stored || stored.used || stored.expiresAt < Date.now()) {
            return respond(false, HttpStatus.UNAUTHORIZED, 'Enrollment code is invalid, expired, or already used.');
        }

        // Single-use: immediately delete
        await env.kv.delete(kvKey);

        const storage = createStorage(env.kv);
        let secretKey = await storage.readSecretKey();
        if (!secretKey) {
            secretKey = generateSecretKey();
            await storage.writeSecretKey(secretKey);
        }

        const secret = new TextEncoder().encode(secretKey);
        // Mint companion session JWT with 90-day validity
        const companionJwt = await signRayZenJwt(sessionSubject(), secret, 90 * 24 * 60 * 60);
        const { hostname, securePath, accEmail } = getGlobals();

        return respond(true, HttpStatus.OK, 'Enrollment successful.', {
            token: companionJwt,
            email: accEmail,
            host: hostname,
            securePath,
            panelVersion: '1.1.0',
        });
    } catch (err) {
        return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Redemption failed: ${safeError(err)}`);
    }
}
