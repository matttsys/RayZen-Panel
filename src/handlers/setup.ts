/**
 * First-run setup, for a deployment that bootstrapped its own identity.
 *
 * A Deploy to Cloudflare deployment starts with nothing an operator could sign in
 * with: no email, no password, and a randomly generated panel path that only the
 * Worker itself knows. Something has to hand that path over exactly once, to
 * exactly one person, and then stop existing.
 *
 * That is this page. It is served at `/` while three things are all true:
 *
 *   - the identity came from KV rather than from a packaged artifact, so this really
 *     is a bootstrap deployment and not somebody's existing panel;
 *   - no panel password has been set yet;
 *   - the request is a plain page or form POST, not a subscription or relay call.
 *
 * The moment a password exists, `/` goes back to the fallback proxy and the setup
 * routes answer as if they were never there. There is no way to re-enter setup
 * except by deleting the password from KV, which requires dashboard access to the
 * account already.
 *
 * The claim window, stated plainly
 *
 * Between the deploy finishing and the first person completing this form, the public
 * workers.dev address is unclaimed. Deployments that need to restrict first claim
 * can pin the administrator address with `RAYZEN_ADMIN_EMAIL`; setup then accepts
 * only that address.
 */
import { HttpStatus, decompressGzipBase64, respond, safeError } from '@common';
import { claimIdentity } from '@identity';
import { getGlobals } from '@settings';
import { createStorage } from '@storage';
import { hashPassword, PASSWORD_RULE, PASSWORD_RULE_MESSAGE } from '../auth/password';

const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const MAX_BODY_BYTES = 4 * 1024;


/** True when this deployment still needs to be claimed. */
export async function needsSetup(env: Env, source = getGlobals().source): Promise<boolean> {
    // A packaged deployment's operator already knows their panel URL and email, so
    // showing them a setup page would be noise on a path that is meant to look
    // uninteresting. Bootstrap deployments only.
    if (source !== 'kv') return false;
    return !(await createStorage(env.kv).readPassword());
}

/**
 * Reads the optional setup email variable the way the claim check reads it.
 *
 * Trimmed, and trimmed in both places deliberately. The page and the POST handler have
 * to agree about whether a variable is set, because they disagree in the direction that
 * locks an operator out: a whitespace-only `RAYZEN_ADMIN_EMAIL` would pin the email
 * field, so nothing can be typed into it, while the claim check would see no pinned
 * address and reject the empty submission. That is a deployment nobody can claim, from
 * a variable that looks blank in the dashboard.
 */
function setupVar(value: string | undefined): string {
    return (value ?? '').trim();
}

async function renderSetup(env: Env): Promise<Response> {
    const fixedEmail = setupVar(env.RAYZEN_ADMIN_EMAIL);
    const html = (await decompressGzipBase64(SETUP_HTML_CONTENT))
        .replaceAll('__ICON__', ICON_CONTENT)
        .replace('__EMAIL_FIXED__', fixedEmail ? 'true' : 'false')
        .replace('__EMAIL_VALUE__', escapeHtml(fixedEmail));

    return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
}

/**
 * Escapes a value interpolated into the setup page.
 *
 * The only interpolated value is `RAYZEN_ADMIN_EMAIL`, which an operator sets and so
 * is not attacker-controlled in any ordinary sense. Escaped anyway: a page whose
 * safety depends on who typed the input is a page that breaks the first time
 * something else is interpolated into it.
 */
function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

interface ClaimBody {
    email?: unknown;
    password?: unknown;
}

async function claim(request: Request, env: Env, securePath: string): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
        return respond(false, HttpStatus.PAYLOAD_TOO_LARGE, 'Request body is too large.');
    }

    let body: ClaimBody;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
        body = parsed as ClaimBody;
    } catch {
        return respond(false, HttpStatus.BAD_REQUEST, 'Malformed JSON request body.');
    }

    const fixedEmail = setupVar(env.RAYZEN_ADMIN_EMAIL).toLowerCase();
    const email = fixedEmail || (typeof body.email === 'string' ? body.email.trim().toLowerCase() : '');
    const password = typeof body.password === 'string' ? body.password : '';

    if (!EMAIL_RULE.test(email)) {
        return respond(false, HttpStatus.BAD_REQUEST, 'Enter the email address you want to sign in with.');
    }

    if (!PASSWORD_RULE.test(password)) {
        return respond(
            false,
            HttpStatus.BAD_REQUEST,
            PASSWORD_RULE_MESSAGE
        );
    }

    const storage = createStorage(env.kv);

    try {
        // Re-checked immediately before the write, not just at the route. Two people
        // loading the setup page at the same time both see a form; only the first POST
        // may take the deployment.
        if (await storage.readPassword()) {
            return respond(false, HttpStatus.FORBIDDEN, 'This deployment has already been set up.');
        }

        // Derive the verifier before changing identity. If the runtime rejects the
        // cryptographic operation, setup remains wholly unclaimed and can be retried.
        const verifier = await hashPassword(password);
        await claimIdentity(env, email);
        await storage.writePassword(verifier);
    } catch (error) {
        return respond(
            false,
            HttpStatus.INTERNAL_SERVER_ERROR,
            `Setup could not be completed: ${safeError(error)}`
        );
    }

    // `securePath` was captured before the first await in `handleSetup`, so a concurrent
    // request cannot replace it through the legacy module-level request context.
    //
    // Built from this Request's `origin` rather than from `hostname`, because `hostname` drops the
    // port. A deployed Worker never has one, but a URL that is wrong anywhere is a URL
    // nobody can trust, and this one is shown exactly once.
    const { origin } = new URL(request.url);

    return respond(true, HttpStatus.OK, 'Setup complete.', {
        panelUrl: `${origin}/${securePath}/panel`,
        loginUrl: `${origin}/${securePath}/login`,
        username: email
    }, { 'Cache-Control': 'no-store' });
}

/**
 * Handles the setup routes, or returns null when this deployment has none.
 *
 * Returning null rather than a 404 matters: the router then treats the path exactly
 * as it did before setup existed, so a claimed deployment is indistinguishable from
 * one that never had a setup page.
 */
export async function handleSetup(request: Request, env: Env): Promise<Response | null> {
    // Capture every request-specific value before the first await. Cloudflare may run
    // another request in the same isolate while KV is pending, and `getGlobals()` is a
    // module-level compatibility layer that can then be overwritten by that request.
    // The route and response URLs must therefore come from this Request, while the
    // immutable identity fields are captured synchronously here.
    const { source, securePath } = getGlobals();
    const path = new URL(request.url).pathname.replace(/\/+$/u, '');

    if (path !== '' && path !== '/setup' && path !== '/setup/claim') return null;
    if (!(await needsSetup(env, source))) return null;

    if (path === '/setup/claim') return claim(request, env, securePath);
    return renderSetup(env);
}
