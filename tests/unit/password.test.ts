import { describe, expect, it } from 'vitest';
import { hashPassword, PASSWORD_HASH_ITERATIONS, verifyPassword } from '../../src/auth/password';

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

async function verifier(password: string, iterations: number): Promise<string> {
    const salt = new Uint8Array(16);
    salt.fill(7);
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
        key,
        256
    );
    return `pbkdf2-sha256$${iterations}$${base64Url(salt)}$${base64Url(new Uint8Array(bits))}`;
}

describe('Cloudflare PBKDF2 compatibility', () => {
    it('creates verifiers at the Workers-supported ceiling', async () => {
        const stored = await hashPassword('ValidPass1');
        expect(PASSWORD_HASH_ITERATIONS).toBe(100_000);
        expect(stored).toMatch(/^pbkdf2-sha256\$100000\$/u);
        expect((await verifyPassword('ValidPass1', stored)).valid).toBe(true);
    });

    it('identifies verifiers above the Workers ceiling without calling deriveBits', async () => {
        const stored = `pbkdf2-sha256$120000$${'A'.repeat(22)}$${'A'.repeat(43)}`;
        await expect(verifyPassword('ValidPass1', stored)).resolves.toEqual({
            valid: false,
            needsUpgrade: false,
            issue: 'unsupported-iterations'
        });
    });

    it('accepts and marks a lower-cost valid verifier for rehash-on-login', async () => {
        const stored = await verifier('ValidPass1', 10_000);
        await expect(verifyPassword('ValidPass1', stored)).resolves.toEqual({
            valid: true,
            needsUpgrade: true
        });
    });
});
