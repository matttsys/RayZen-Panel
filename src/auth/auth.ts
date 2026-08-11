import { HttpStatus, respond } from '@common';
import { signRayZenJwt, verifyRayZenJwt } from './jwt';
import { getGlobals } from '@settings';
import { createStorage } from '@storage';
import { withRecorder } from '@platform/record';
import { hashPassword, PASSWORD_RULE, PASSWORD_RULE_MESSAGE, verifyPassword } from './password';

const MAX_AUTH_BODY_BYTES = 4 * 1024;

/**
 * The session token's subject.
 *
 * Historically the Cloudflare account id, which every packaged deployment has. A
 * deployment made with the Deploy to Cloudflare button has no account id unless the
 * operator supplied one, so it falls back to the sign-in email. The account id is
 * preferred when present so that existing sessions survive an upgrade to this build.
 *
 * Either way the value is not a secret and carries no authority on its own: the
 * signature does, and it is verified against the per-deployment key in KV.
 */
function sessionSubject(): string {
    const { accID, accEmail } = getGlobals();
    return accID || accEmail;
}

type Credentials = { username?: string; password?: string };

type AuthBody =
    | { ok: true; value: Credentials }
    | { ok: false; response: Response };

async function readAuthBody(request: Request): Promise<AuthBody> {
    const declared = Number(request.headers.get('Content-Length'));
    if (Number.isFinite(declared) && declared > MAX_AUTH_BODY_BYTES) {
        return { ok: false, response: respond(false, HttpStatus.PAYLOAD_TOO_LARGE, 'Request body is too large.') };
    }

    let raw: string;
    try {
        raw = await request.text();
    } catch {
        return { ok: false, response: respond(false, HttpStatus.BAD_REQUEST, 'Unable to read request body.') };
    }

    if (new TextEncoder().encode(raw).byteLength > MAX_AUTH_BODY_BYTES) {
        return { ok: false, response: respond(false, HttpStatus.PAYLOAD_TOO_LARGE, 'Request body is too large.') };
    }

    try {
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid shape');
        return { ok: true, value: value as Credentials };
    } catch {
        return { ok: false, response: respond(false, HttpStatus.BAD_REQUEST, 'Malformed JSON request body.') };
    }
}

export function logout(): Response {
    return respond(true, HttpStatus.OK, 'Successfully logged out!', null, {
        'Set-Cookie': 'jwtToken=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
    });
}

export async function generateJWTToken(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    const body = await readAuthBody(request);
    if (!body.ok) return body.response;
    const data = body.value;
    const storage = createStorage(env.kv);
    const savedPass = await storage.readPassword();
    const { accEmail } = getGlobals();
    const username = data.username?.toLowerCase();
    const verification = await verifyPassword(data.password ?? '', savedPass);

    if (verification.issue === 'unsupported-iterations') {
        return respond(
            false,
            HttpStatus.CONFLICT,
            'This deployment uses a password verifier above the Cloudflare Workers PBKDF2 limit. Use an existing signed-in session to change the password, or follow the documented KV recovery procedure.'
        );
    }

    if (username !== accEmail || !verification.valid) {
        // Counted, never described. The event carries `ok: false` and nothing else:
        // no username, no IP, no timestamp beyond the UTC day the counter rolls up
        // into. A log of who tried and when would be a record of the operator's
        // habits, and under a guessing attack it would be an attacker-controlled
        // write amplifier.
        await withRecorder(env, platform => {
            platform.events.emit('auth.attempt', { ok: false });
        });

        return respond(false, HttpStatus.UNAUTHORIZED, 'Wrong Credentials.');
    }

    // Existing installations are upgraded in place after a successful proof of
    // knowledge. No reset, logout or migration command is required.
    if (verification.needsUpgrade) {
        await storage.writePassword(await hashPassword(data.password ?? ''));
    }

    let secretKey = await storage.readSecretKey();
    if (!secretKey) {
        secretKey = generateSecretKey();
        await storage.writeSecretKey(secretKey);
    }

    const secret = new TextEncoder().encode(secretKey);
    const jwtToken = await signRayZenJwt(sessionSubject(), secret);

    // Two events, deliberately: `auth.attempt` feeds the success-rate counter that
    // the diagnostics `platform.auth-failures` check reads, and `auth.login` is
    // what the history engine records. Only successful logins reach history; see
    // `subscribeHistory` in src/features/history/service.ts for why.
    await withRecorder(env, platform => {
        platform.events.emit('auth.attempt', { ok: true });
        platform.events.emit('auth.login', {});
    });

    return respond(true, HttpStatus.OK, 'Signed in.', {
        user: { email: accEmail },
        panelVersion: VERSION,
        expiresIn: 24 * 60 * 60
    }, {
        'Set-Cookie': `jwtToken=${jwtToken}; Path=/; HttpOnly; Secure; Max-Age=${24 * 60 * 60}; SameSite=Strict`,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
    });
}

function generateSecretKey(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);

    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function authenticate(request: Request, env: Env): Promise<boolean> {
    try {
        const secretKey = await createStorage(env.kv).readSecretKey();
        if (secretKey === null) {
            return false;
        }

        const secret = new TextEncoder().encode(secretKey);
        const cookie = request.headers.get('Cookie')?.match(/(^|;\s*)jwtToken=([^;]*)/);
        const token = cookie ? cookie[2] : null;
        if (!token) {
            return false;
        }

        const payload = await verifyRayZenJwt(token, secret);
        const subject = sessionSubject();
        // An empty subject would make every well-signed token valid, so it is
        // rejected rather than compared. It can only happen on a deployment that has
        // neither an account id nor a claimed email, which has no password either.
        return Boolean(subject) && payload.id === subject;
    } catch {
        return false;
    }
}

export async function resetPassword(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    const auth = await authenticate(request, env);
    const storage = createStorage(env.kv);
    const oldVerifier = await storage.readPassword();
    if (oldVerifier && !auth) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized.');
    }

    const body = await readAuthBody(request);
    if (!body.ok) return body.response;
    const data = body.value;
    const { accEmail } = getGlobals();

    if (!auth && !data.username) {
        return respond(false, HttpStatus.BAD_REQUEST, 'Missing username.');
    }

    if (data.username && data.username.toLowerCase() !== accEmail) {
        return respond(false, HttpStatus.BAD_REQUEST, 'Wrong username.');
    }

    if (!data.password) {
        return respond(false, HttpStatus.BAD_REQUEST, 'Missing password.');
    }

    if (!PASSWORD_RULE.test(data.password)) {
        return respond(false, HttpStatus.BAD_REQUEST, PASSWORD_RULE_MESSAGE);
    }

    if (oldVerifier && (await verifyPassword(data.password, oldVerifier)).valid) {
        return respond(false, HttpStatus.BAD_REQUEST, 'Please enter a new Password.');
    }

    await storage.writePassword(await hashPassword(data.password));

    return respond(true, HttpStatus.OK, 'Successfully changed password.', null, {
        'Set-Cookie': 'jwtToken=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-store'
    });
}
