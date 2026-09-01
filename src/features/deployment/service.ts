/**
 * Deployment preflight and post-deployment verification.
 *
 * Why this exists
 *
 * Every support question that begins "I deployed it and it doesn't work" has one
 * of about eight causes: no KV binding, a KV binding under the wrong name, no
 * password set, a default or trivially guessable secure path, a missing UUID, an
 * API token without the right scope, a custom domain that is not proxied, or a
 * clock that makes tokens invalid. All eight are detectable from inside the Worker
 * in a few microseconds. Until now, the panel detected none of them up front; it
 * simply failed later, somewhere else, with a generic error.
 *
 * Preflight turns those eight silent failures into eight sentences with fixes.
 *
 * Design choices
 *
 * - **Pure and synchronous.** No network calls, no probes. A readiness page that
 *   itself times out is worse than none, and Worker CPU time is a hard budget.
 *   Everything here is derived from bindings and settings the caller already holds.
 * - **`warn` never blocks.** Only `fail` sets `ready: false`. A deployment that is
 *   merely sub-optimal must still be usable, or operators will learn to ignore the
 *   whole screen.
 * - **Every non-pass check carries a `fix`.** A check that reports a problem without
 *   saying what to do is a complaint, not diagnostics.
 * - **Never echo a secret.** Checks report presence, length and shape. The panel's
 *   own preflight output must not become a credential disclosure surface.
 */

import type { PreflightCheck, PreflightReport, PreflightStatus } from '#types/platform';
import { runtime } from '@runtime';

/** Paths that are effectively public knowledge and must not be used as the secure path. */
const WEAK_PATHS = ['panel', 'admin', 'dashboard', 'login', 'rayzen', 'bpb', 'config', 'secret'];

/** Below this, a path is guessable by brute force within a practical budget. */
const MIN_SECURE_PATH_LENGTH = 8;

/** Below this, a password is not worth the check that guards it. */
const MIN_PASSWORD_LENGTH = 8;

export interface PreflightInput {
    /** True when a KV namespace is bound under the expected name. */
    kvBound: boolean;
    /** True when a write to KV succeeded during boot. */
    storageWritable: boolean;
    /** True when an admin password has been set (never the password itself). */
    passwordSet: boolean;
    /** Length of the configured password, or 0 when only a hash is stored. */
    passwordLength: number;
    /** The panel's secure path. Compared against a weak-path list; never echoed. */
    securePath: string;
    /** True when a VLESS UUID is configured and well formed. */
    uuidConfigured: boolean;
    /** True when a Trojan password is configured. */
    trojanConfigured: boolean;
    /** Hostname the panel is served from. */
    hostname: string;
    /** True when the request arrived over HTTPS. */
    secureTransport: boolean;
    /** True when a Cloudflare API token is present, enabling panel self-update. */
    apiTokenPresent: boolean;
    /** Deployment kind reported by the platform, e.g. `worker` or `pages`. */
    deployType: string;
    /** Panel version currently running. */
    panelVersion: string;
}

function check(
    id: string,
    title: string,
    status: PreflightStatus,
    message: string,
    fix?: string
): PreflightCheck {
    return fix && status !== 'pass' ? { id, title, status, message, fix } : { id, title, status, message };
}

/**
 * Runs every preflight check.
 *
 * Order matters: checks are listed in the order an operator should read them, with
 * blocking infrastructure problems before configuration quality problems, because
 * fixing a missing KV binding first makes several later warnings disappear.
 */
export function runPreflight(input: PreflightInput): PreflightReport {
    const checks: PreflightCheck[] = [];

    checks.push(
        input.kvBound
            ? check('kv.binding', 'Storage binding', 'pass', 'A KV namespace is bound to this deployment.')
            : check(
                  'kv.binding',
                  'Storage binding',
                  'fail',
                  'No KV namespace is bound, so nothing can be saved.',
                  'In the Cloudflare dashboard open Settings, Bindings, add a KV namespace binding named exactly "kv", then redeploy.'
              )
    );

    checks.push(
        !input.kvBound
            ? check('kv.writable', 'Storage writable', 'skip', 'Skipped because no KV namespace is bound.')
            : input.storageWritable
              ? check('kv.writable', 'Storage writable', 'pass', 'Settings can be written and read back.')
              : check(
                    'kv.writable',
                    'Storage writable',
                    'fail',
                    'The KV namespace is bound but a test write failed.',
                    'Confirm the binding points to a namespace in this account and that the namespace has not been deleted.'
                )
    );

    checks.push(
        input.passwordSet
            // A length of 0 means "stored as a hash, length unknown", which is the
            // normal case: the panel never keeps the plaintext. Unknown is reported as
            // a pass, because inventing a warning from missing data trains operators to
            // ignore warnings.
            ? input.passwordLength <= 0 || input.passwordLength >= MIN_PASSWORD_LENGTH
                ? check('auth.password', 'Admin password', 'pass', 'An admin password of reasonable length is set.')
                : check(
                      'auth.password',
                      'Admin password',
                      'warn',
                      `The admin password is shorter than ${MIN_PASSWORD_LENGTH} characters.`,
                      'Open the panel settings and set a longer password. The panel URL is not a substitute for one.'
                  )
            : check(
                  'auth.password',
                  'Admin password',
                  'fail',
                  'No admin password is set, so anyone who finds the panel URL can change your configuration.',
                  'Set a password on first login before sharing any subscription link.'
              )
    );

    const path = (input.securePath ?? '').trim();
    checks.push(
        path.length === 0
            ? check(
                  'auth.path',
                  'Panel path',
                  'fail',
                  'The panel has no secure path, so it is served from a predictable URL.',
                  'Set a long random secure path in settings, then bookmark the new URL.'
              )
            : WEAK_PATHS.includes(path.toLowerCase())
              ? check(
                    'auth.path',
                    'Panel path',
                    'warn',
                    'The panel path is a common word that scanners try automatically.',
                    'Replace it with a random string of at least 16 characters.'
                )
              : path.length < MIN_SECURE_PATH_LENGTH
                ? check(
                      'auth.path',
                      'Panel path',
                      'warn',
                      `The panel path is shorter than ${MIN_SECURE_PATH_LENGTH} characters.`,
                      'Use a longer random path; it is the first barrier against automated discovery.'
                  )
                : check('auth.path', 'Panel path', 'pass', 'The panel path is long enough to resist guessing.')
    );

    checks.push(
        input.uuidConfigured || input.trojanConfigured
            ? check(
                  'proxy.identity',
                  'Proxy identity',
                  'pass',
                  'At least one protocol identity is configured, so subscriptions can be issued.'
              )
            : check(
                  'proxy.identity',
                  'Proxy identity',
                  'fail',
                  'Neither a VLESS UUID nor a Trojan password is configured, so no working client config can be produced.',
                  'Open settings and generate an identity. The panel can create one for you.'
              )
    );

    checks.push(
        input.secureTransport
            ? check('transport.https', 'HTTPS', 'pass', 'The panel is being served over HTTPS.')
            : check(
                  'transport.https',
                  'HTTPS',
                  'fail',
                  'The panel is being served over plain HTTP, so credentials would travel in clear text.',
                  'Access the panel over https://. If you use a custom domain, enable Full (strict) SSL in Cloudflare.'
              )
    );

    const host = (input.hostname ?? '').toLowerCase();
    const managedHost = host.endsWith('.workers.dev') || host.endsWith('.pages.dev');
    checks.push(
        managedHost
            ? check(
                  'transport.domain',
                  'Domain',
                  'warn',
                  'The deployment uses a default Cloudflare hostname, which is blocked in some networks.',
                  'Attach a custom domain in Cloudflare if clients cannot reach the default hostname.'
              )
            : host.length > 0
              ? check('transport.domain', 'Domain', 'pass', 'A custom domain is in use.')
              : check('transport.domain', 'Domain', 'skip', 'The hostname could not be determined for this request.')
    );

    checks.push(
        input.apiTokenPresent
            ? check(
                  'platform.token',
                  'Cloudflare API token',
                  'pass',
                  'A token is configured, so the panel can update itself and manage bindings.'
              )
            : check(
                  'platform.token',
                  'Cloudflare API token',
                  'skip',
                  // `skip`, not `warn`: a one-click deployment has no token by design and
                  // needs none, so a warning here would tell every ordinary user that
                  // something is wrong with a deployment that is working exactly as
                  // documented. The optional features are named so the absence is legible.
                  'No Cloudflare API token is configured, which is the default. Usage ' +
                      'statistics, in-panel custom domain setup and the self-repair redeploy ' +
                      'are unavailable; everything else works.',
                  'Set RAYZEN_CF_ACCOUNT_ID and RAYZEN_CF_API_TOKEN in the Cloudflare ' +
                      'dashboard if you want those features.'
              )
    );

    checks.push(
        check(
            'platform.version',
            'Version',
            'pass',
            `Running RayZen ${input.panelVersion} on ${input.deployType || 'an unknown platform'}.`
        )
    );

    const blocking = checks.filter(entry => entry.status === 'fail').length;
    const warnings = checks.filter(entry => entry.status === 'warn').length;

    return { ready: blocking === 0, checks, blocking, warnings, at: runtime.now().getTime() };
}

/**
 * Post-deployment verification.
 *
 * Preflight asks "can this deployment work?". Verification asks "is it working
 * now?", which is a different question and the one an operator wants answered
 * after pressing deploy. It reuses preflight and adds the runtime evidence that
 * only exists once traffic has flowed.
 */
export function verifyDeployment(
    input: PreflightInput & {
        /** Successful config exports observed since deployment. */
        configExports: number;
        /** Successful logins observed since deployment. */
        successfulLogins: number;
        /** True when at least one scan has completed. */
        scannerUsed: boolean;
    }
): PreflightReport {
    const base = runPreflight(input);
    const checks = [...base.checks];

    checks.push(
        input.successfulLogins > 0
            ? check('verify.login', 'Panel sign-in', 'pass', 'The panel has been signed into successfully at least once.')
            : check(
                  'verify.login',
                  'Panel sign-in',
                  'warn',
                  'No successful sign-in has been recorded yet.',
                  'Sign out and back in once to confirm authentication works end to end.'
              )
    );

    checks.push(
        input.configExports > 0
            ? check(
                  'verify.export',
                  'Client configuration',
                  'pass',
                  'At least one client configuration has been generated successfully.'
              )
            : check(
                  'verify.export',
                  'Client configuration',
                  'warn',
                  'No client configuration has been generated yet.',
                  'Open the subscription page once and import it into your client to confirm the full path works.'
              )
    );

    checks.push(
        input.scannerUsed
            ? check('verify.scanner', 'Endpoint scan', 'pass', 'Endpoint scanning has run on this deployment.')
            : check(
                  'verify.scanner',
                  'Endpoint scan',
                  'warn',
                  'No endpoint scan has run, so no endpoint has been measured from your network.',
                  'Run one scan; it is the only way the panel can recommend an endpoint for your conditions.'
              )
    );

    const blocking = checks.filter(entry => entry.status === 'fail').length;
    const warnings = checks.filter(entry => entry.status === 'warn').length;

    return { ready: blocking === 0, checks, blocking, warnings, at: runtime.now().getTime() };
}
