/** Password verification for administrator access.
 *
 * The verifier stays in the existing `pwd` KV key so upgrades do not orphan an
 * installation. Older deployments stored the password itself in that key. A
 * successful login against one of those legacy values returns `needsUpgrade`, and
 * the caller replaces it with a salted PBKDF2 verifier before issuing a session.
 */

const PREFIX = 'pbkdf2-sha256';
// Cloudflare Workers currently rejects PBKDF2 costs above 100,000.
// Keep the emitted verifier at the runtime ceiling so first-run setup, login, and
// password rotation behave identically in local tests and on the edge.
export const PASSWORD_HASH_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

const encoder = new TextEncoder();

/** Shared by first-run setup and the authenticated password-change route. */
export const PASSWORD_RULE = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
export const PASSWORD_RULE_MESSAGE = 'The password needs at least 8 characters, one capital letter and one digit.';

function encodeBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
    if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('invalid base64url');
    const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array<ArrayBuffer>> {
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
        key,
        HASH_BYTES * 8
    );
    return new Uint8Array(bits);
}

/** Constant-work comparison for byte/string values, including unequal lengths. */
function safeEqual(left: Uint8Array, right: Uint8Array): boolean {
    const length = Math.max(left.length, right.length);
    let diff = left.length ^ right.length;
    for (let index = 0; index < length; index++) {
        diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
    }
    return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
    const salt = new Uint8Array(SALT_BYTES);
    crypto.getRandomValues(salt);
    const hash = await derive(password, salt, PASSWORD_HASH_ITERATIONS);
    return `${PREFIX}$${PASSWORD_HASH_ITERATIONS}$${encodeBase64Url(salt)}$${encodeBase64Url(hash)}`;
}

export interface PasswordVerification {
    valid: boolean;
    /** True for a valid legacy plaintext or lower-cost PBKDF2 verifier. */
    needsUpgrade: boolean;
    /**
     * A verifier created above the Workers PBKDF2 ceiling cannot be checked by the
     * current runtime. It must never be treated as a wrong password or plaintext.
     */
    issue?: 'unsupported-iterations';
}

export async function verifyPassword(password: string, stored: string | null): Promise<PasswordVerification> {
    if (!stored) return { valid: false, needsUpgrade: false };

    if (!stored.startsWith(`${PREFIX}$`)) {
        return {
            valid: safeEqual(encoder.encode(password), encoder.encode(stored)),
            needsUpgrade: true
        };
    }

    try {
        const parts = stored.split('$');
        if (parts.length !== 4 || parts[0] !== PREFIX) return { valid: false, needsUpgrade: false };
        const iterations = Number(parts[1]);
        if (!Number.isSafeInteger(iterations) || iterations < 10_000) {
            return { valid: false, needsUpgrade: false };
        }
        if (iterations > PASSWORD_HASH_ITERATIONS) {
            return { valid: false, needsUpgrade: false, issue: 'unsupported-iterations' };
        }
        const salt = decodeBase64Url(parts[2]);
        const expected = decodeBase64Url(parts[3]);
        if (salt.byteLength < 16 || expected.byteLength !== HASH_BYTES) return { valid: false, needsUpgrade: false };
        const actual = await derive(password, salt, iterations);
        const valid = safeEqual(actual, expected);
        return { valid, needsUpgrade: valid && iterations < PASSWORD_HASH_ITERATIONS };
    } catch {
        // A corrupted verifier is an authentication failure, never a plaintext
        // fallback. The operator can recover by deleting `pwd` from their own KV.
        return { valid: false, needsUpgrade: false };
    }
}
