/**
 * Unit tests for `src/auth/auth.ts`.
 *
 * Every protected route funnels through `authenticate()`, so its failure modes
 * are the whole authorization boundary. These tests pin current behaviour,
 * including the parts SECURITY.md records as known limitations, so that a fix is a
 * deliberate, visible test change.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { authenticate, generateJWTToken, logout, resetPassword } from '@auth';
import { hashPassword, verifyPassword } from '../../src/auth/password';
import { createEnv, createKvStub, initRequestGlobals } from '../helpers/worker';
import { TEST_ACCOUNT_ID, TEST_EMAIL, TEST_MAIN_DOMAIN } from '../setup/globals';

const PASSWORD = 'correct-horse-battery-staple';
const SECRET = 'a'.repeat(64);

beforeEach(async () => {
    await initRequestGlobals();
});

function post(body: unknown, cookie?: string): Request {
    return new Request(`https://${TEST_MAIN_DOMAIN}/login`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: cookie ? { Cookie: cookie } : undefined
    });
}

async function signToken(secret: string, options: { expired?: boolean } = {}): Promise<string> {
    const key = new TextEncoder().encode(secret);
    const builder = new SignJWT({ id: TEST_ACCOUNT_ID })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt();

    // 'exp' in the past produces a token jose rejects as expired.
    return builder.setExpirationTime(options.expired ? '-1h' : '24h').sign(key);
}

describe('generateJWTToken', () => {
    it('rejects a non-POST request with 405', async () => {
        const kv = createKvStub({ pwd: PASSWORD });
        const request = new Request(`https://${TEST_MAIN_DOMAIN}/login`, { method: 'GET' });
        const response = await generateJWTToken(request, createEnv(kv.namespace));

        expect(response.status).toBe(405);
    });

    it('issues a token for correct credentials', async () => {
        const kv = createKvStub({ pwd: PASSWORD, secretKey: SECRET });
        const response = await generateJWTToken(
            post({ username: TEST_EMAIL, password: PASSWORD }),
            createEnv(kv.namespace)
        );

        expect(response.status).toBe(200);
        const cookie = response.headers.get('Set-Cookie') ?? '';
        expect(cookie).toContain('jwtToken=');
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('Secure');
        expect(cookie).toContain('SameSite=Strict');
        expect(cookie).toContain(`Max-Age=${24 * 60 * 60}`);
    });

    it('matches the username case-insensitively', async () => {
        const kv = createKvStub({ pwd: PASSWORD, secretKey: SECRET });
        const response = await generateJWTToken(
            post({ username: TEST_EMAIL.toUpperCase(), password: PASSWORD }),
            createEnv(kv.namespace)
        );

        expect(response.status).toBe(200);
    });

    it('rejects malformed JSON without throwing', async () => {
        const kv = createKvStub({ pwd: PASSWORD, secretKey: SECRET });
        const request = new Request(`https://${TEST_MAIN_DOMAIN}/login`, { method: 'POST', body: '{not-json' });
        const response = await generateJWTToken(request, createEnv(kv.namespace));
        expect(response.status).toBe(400);
    });

    it('rejects oversized credential payloads', async () => {
        const kv = createKvStub({ pwd: PASSWORD, secretKey: SECRET });
        const response = await generateJWTToken(
            post({ username: TEST_EMAIL, password: 'x'.repeat(5000) }),
            createEnv(kv.namespace)
        );
        expect(response.status).toBe(413);
    });

    it('rejects a wrong password with 401', async () => {
        const kv = createKvStub({ pwd: PASSWORD, secretKey: SECRET });
        const response = await generateJWTToken(
            post({ username: TEST_EMAIL, password: 'wrong' }),
            createEnv(kv.namespace)
        );

        expect(response.status).toBe(401);
    });

    it('rejects a wrong username with 401', async () => {
        const kv = createKvStub({ pwd: PASSWORD, secretKey: SECRET });
        const response = await generateJWTToken(
            post({ username: 'someone@else.invalid', password: PASSWORD }),
            createEnv(kv.namespace)
        );

        expect(response.status).toBe(401);
    });

    it('generates and persists a secret key on first login', async () => {
        const kv = createKvStub({ pwd: PASSWORD });
        expect(kv.store.get('secretKey')).toBeUndefined();

        await generateJWTToken(post({ username: TEST_EMAIL, password: PASSWORD }), createEnv(kv.namespace));

        const secret = kv.store.get('secretKey');
        expect(secret).toBeDefined();
        expect(secret).toMatch(/^[0-9a-f]{64}$/);
    });

    it('reuses an existing secret key rather than rotating it', async () => {
        const kv = createKvStub({ pwd: PASSWORD, secretKey: SECRET });
        await generateJWTToken(post({ username: TEST_EMAIL, password: PASSWORD }), createEnv(kv.namespace));

        expect(kv.store.get('secretKey')).toBe(SECRET);
    });

    it('migrates a legacy plaintext password after a successful login', async () => {
        const kv = createKvStub({ pwd: PASSWORD, secretKey: SECRET });
        const response = await generateJWTToken(
            post({ username: TEST_EMAIL, password: PASSWORD }),
            createEnv(kv.namespace)
        );

        const verifier = kv.store.get('pwd') ?? null;
        expect(response.status).toBe(200);
        expect(verifier).not.toBe(PASSWORD);
        expect(verifier).toMatch(/^pbkdf2-sha256\$/);
        expect((await verifyPassword(PASSWORD, verifier)).valid).toBe(true);
    });

    it('accepts a salted verifier without rewriting it', async () => {
        const verifier = await hashPassword(PASSWORD);
        const kv = createKvStub({ pwd: verifier, secretKey: SECRET });
        const response = await generateJWTToken(
            post({ username: TEST_EMAIL, password: PASSWORD }),
            createEnv(kv.namespace)
        );
        expect(response.status).toBe(200);
        expect(kv.store.get('pwd')).toBe(verifier);
    });


    it('returns an explicit recovery response for an unsupported stored verifier', async () => {
        const verifier = `pbkdf2-sha256$120000$${'A'.repeat(22)}$${'A'.repeat(43)}`;
        const kv = createKvStub({ pwd: verifier, secretKey: SECRET });
        const response = await generateJWTToken(
            post({ username: TEST_EMAIL, password: PASSWORD }),
            createEnv(kv.namespace)
        );
        const payload = await response.json() as { message: string };

        expect(response.status).toBe(409);
        expect(payload.message).toContain('PBKDF2 limit');
        expect(kv.store.get('pwd')).toBe(verifier);
    });
});

describe('authenticate', () => {
    it('returns false when no secret key exists', async () => {
        const kv = createKvStub({});
        const token = await signToken(SECRET);
        const request = post({}, `jwtToken=${token}`);

        expect(await authenticate(request, createEnv(kv.namespace))).toBe(false);
    });

    it('returns false when the request carries no cookie', async () => {
        const kv = createKvStub({ secretKey: SECRET });
        expect(await authenticate(post({}), createEnv(kv.namespace))).toBe(false);
    });

    it('returns false when the cookie has no jwtToken entry', async () => {
        const kv = createKvStub({ secretKey: SECRET });
        const request = post({}, 'someOtherCookie=value');

        expect(await authenticate(request, createEnv(kv.namespace))).toBe(false);
    });

    it('accepts a validly signed, unexpired token', async () => {
        const kv = createKvStub({ secretKey: SECRET });
        const token = await signToken(SECRET);
        const request = post({}, `jwtToken=${token}`);

        expect(await authenticate(request, createEnv(kv.namespace))).toBe(true);
    });

    it('rejects a valid token issued for another account', async () => {
        const kv = createKvStub({ secretKey: SECRET });
        const key = new TextEncoder().encode(SECRET);
        const token = await new SignJWT({ id: 'another-account' })
            .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('24h').sign(key);
        expect(await authenticate(post({}, `jwtToken=${token}`), createEnv(kv.namespace))).toBe(false);
    });

    it('finds jwtToken among several cookies', async () => {
        const kv = createKvStub({ secretKey: SECRET });
        const token = await signToken(SECRET);
        const request = post({}, `other=1; jwtToken=${token}; another=2`);

        expect(await authenticate(request, createEnv(kv.namespace))).toBe(true);
    });

    it('rejects a token signed with a different secret', async () => {
        const kv = createKvStub({ secretKey: SECRET });
        const token = await signToken('b'.repeat(64));
        const request = post({}, `jwtToken=${token}`);

        expect(await authenticate(request, createEnv(kv.namespace))).toBe(false);
    });

    it('rejects a tampered signature', async () => {
        const kv = createKvStub({ secretKey: SECRET });
        const token = await signToken(SECRET);
        const tampered = `${token.slice(0, -4)}AAAA`;
        const request = post({}, `jwtToken=${tampered}`);

        expect(await authenticate(request, createEnv(kv.namespace))).toBe(false);
    });

    it('rejects a tampered payload', async () => {
        const kv = createKvStub({ secretKey: SECRET });
        const [header, , signature] = (await signToken(SECRET)).split('.');
        const forgedPayload = Buffer.from(JSON.stringify({ id: 'attacker' })).toString('base64url');
        const request = post({}, `jwtToken=${header}.${forgedPayload}.${signature}`);

        expect(await authenticate(request, createEnv(kv.namespace))).toBe(false);
    });

    it('rejects an expired token', async () => {
        const kv = createKvStub({ secretKey: SECRET });
        const token = await signToken(SECRET, { expired: true });
        const request = post({}, `jwtToken=${token}`);

        expect(await authenticate(request, createEnv(kv.namespace))).toBe(false);
    });

    it('rejects a structurally invalid token', async () => {
        const kv = createKvStub({ secretKey: SECRET });
        const request = post({}, 'jwtToken=not.a.jwt');

        expect(await authenticate(request, createEnv(kv.namespace))).toBe(false);
    });

    it('FINDING: verification passes no algorithm allowlist', async () => {
        // auth.ts:68 calls jwtVerify without `algorithms`, so the accepted
        // algorithm set is whatever the library defaults to rather than an
        // explicit ['HS256']. Documented here as the reason to add one; the
        // change is compatibility-neutral because tokens are issued as HS256.
        const kv = createKvStub({ secretKey: SECRET });
        const token = await signToken(SECRET);
        expect(await authenticate(post({}, `jwtToken=${token}`), createEnv(kv.namespace))).toBe(true);
    });
});

describe('logout', () => {
    it('clears the cookie with an epoch expiry', () => {
        const response = logout();
        const cookie = response.headers.get('Set-Cookie') ?? '';

        expect(response.status).toBe(200);
        expect(cookie).toContain('jwtToken=;');
        expect(cookie).toContain('Max-Age=0');
        expect(cookie).toContain('Expires=Thu, 01 Jan 1970');
    });

    it('clears the cookie with the same HttpOnly boundary', () => {
        expect(logout().headers.get('Set-Cookie')).toContain('HttpOnly');
    });
});

describe('resetPassword', () => {
    it('allows an unauthenticated first-time set when no password exists', async () => {
        const kv = createKvStub({});
        const response = await resetPassword(
            post({ username: TEST_EMAIL, password: 'FirstPass1' }),
            createEnv(kv.namespace)
        );

        expect(response.status).toBe(200);
        expect((await verifyPassword('FirstPass1', kv.store.get('pwd') ?? null)).valid).toBe(true);
    });

    it('rejects an unauthenticated change once a password exists', async () => {
        const kv = createKvStub({ pwd: PASSWORD, secretKey: SECRET });
        const response = await resetPassword(
            post({ username: TEST_EMAIL, password: 'AttackPass1' }),
            createEnv(kv.namespace)
        );

        expect(response.status).toBe(401);
        expect(kv.store.get('pwd')).toBe(PASSWORD);
    });

    it('allows an authenticated change', async () => {
        const kv = createKvStub({ pwd: PASSWORD, secretKey: SECRET });
        const token = await signToken(SECRET);
        const response = await resetPassword(
            post({ password: 'NewPassword1' }, `jwtToken=${token}`),
            createEnv(kv.namespace)
        );

        expect(response.status).toBe(200);
        expect((await verifyPassword('NewPassword1', kv.store.get('pwd') ?? null)).valid).toBe(true);
    });


    it('lets an existing authenticated session replace an unsupported verifier', async () => {
        const unsupported = `pbkdf2-sha256$120000$${'A'.repeat(22)}$${'A'.repeat(43)}`;
        const kv = createKvStub({ pwd: unsupported, secretKey: SECRET });
        const token = await signToken(SECRET);
        const response = await resetPassword(
            post({ password: 'RecoveredPass1' }, `jwtToken=${token}`),
            createEnv(kv.namespace)
        );

        expect(response.status).toBe(200);
        const stored = kv.store.get('pwd') ?? '';
        expect(stored).toMatch(/^pbkdf2-sha256\$100000\$/u);
        expect((await verifyPassword('RecoveredPass1', stored)).valid).toBe(true);
    });

    it('requires a username when unauthenticated', async () => {
        const kv = createKvStub({});
        const response = await resetPassword(post({ password: 'x' }), createEnv(kv.namespace));

        expect(response.status).toBe(400);
    });

    it('rejects a wrong username', async () => {
        const kv = createKvStub({});
        const response = await resetPassword(
            post({ username: 'someone@else.invalid', password: 'x' }),
            createEnv(kv.namespace)
        );

        expect(response.status).toBe(400);
    });

    it('accepts the account email typed with capitals', async () => {
        // Parity with generateJWTToken, which lowercases the submitted username.
        // Without this, an API caller typing their email as written would be
        // rejected while the panel UI (which lowercases) succeeded.
        const kv = createKvStub({});
        const response = await resetPassword(
            post({ username: 'TEST@example.invalid', password: 'ValidPass1' }),
            createEnv(kv.namespace)
        );

        expect(response.status).toBe(200);
        expect((await verifyPassword('ValidPass1', kv.store.get('pwd') ?? null)).valid).toBe(true);
    });

    it('rejects reusing the current password', async () => {
        const kv = createKvStub({ pwd: PASSWORD, secretKey: SECRET });
        const token = await signToken(SECRET);
        const response = await resetPassword(
            post({ password: PASSWORD }, `jwtToken=${token}`),
            createEnv(kv.namespace)
        );

        expect(response.status).toBe(400);
    });

    it('clears the session cookie on success, forcing a re-login', async () => {
        const kv = createKvStub({ pwd: PASSWORD, secretKey: SECRET });
        const token = await signToken(SECRET);
        const response = await resetPassword(
            post({ password: 'AnotherPass1' }, `jwtToken=${token}`),
            createEnv(kv.namespace)
        );

        expect(response.headers.get('Set-Cookie')).toContain('Expires=Thu, 01 Jan 1970');
    });

    it('enforces the same password policy as first-run setup', async () => {
        const kv = createKvStub({});
        const response = await resetPassword(
            post({ username: TEST_EMAIL, password: 'x' }),
            createEnv(kv.namespace)
        );

        expect(response.status).toBe(400);
        expect(kv.store.has('pwd')).toBe(false);
    });
});

describe('resetPassword input validation', () => {
    it('rejects a request with no password field instead of throwing', async () => {
        // Regression test. Before the request body was typed, `data.password` was
        // `any`, so a body omitting the field reached kv.put('pwd', undefined),
        // which throws and surfaces as an unhandled 500. It is a client error.
        const kv = createKvStub({});
        const request = new Request(`https://${TEST_MAIN_DOMAIN}/login`, {
            method: 'POST',
            body: JSON.stringify({ username: TEST_EMAIL })
        });

        const response = await resetPassword(request, createEnv(kv.namespace));

        expect(response.status).toBe(400);
        expect(kv.store.has('pwd')).toBe(false);
    });

    it('rejects an empty-string password', async () => {
        const kv = createKvStub({});
        const response = await resetPassword(
            post({ username: TEST_EMAIL, password: '' }),
            createEnv(kv.namespace)
        );

        expect(response.status).toBe(400);
        expect(kv.store.has('pwd')).toBe(false);
    });
});
