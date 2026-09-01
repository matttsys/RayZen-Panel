/**
 * Where a deployment's identity comes from.
 *
 * A RayZen deployment needs seven things before it can serve anything: the hostname
 * it answers on, the panel path, the VLESS UUID, the Trojan password, the sign-in
 * email, and optionally a Cloudflare account id. Historically these values
 * were baked into the uploaded script as `EMBEDED_SETTINGS`, which is fine
 * when a human runs `npm run package` and knows the hostname in advance.
 *
 * The Deploy to Cloudflare button does not work that way. Cloudflare clones the
 * repository, runs `npm run build`, and runs `wrangler deploy`. Nothing in that
 * sequence knows the hostname (it depends on the Worker name the user picks and on
 * their account subdomain), and nothing can invent a password on the user's behalf.
 * So the identity has to be resolved at runtime instead.
 *
 * Three sources, in precedence order:
 *
 *   1. `EMBEDED_SETTINGS`, when the running script carries it. That is a packaged
 *      artifact (`npm run package`) or a self-redeploy from the panel. Behaviour is
 *      unchanged for those, deliberately: existing deployments must keep working.
 *   2. Worker environment variables and secrets, for anything the operator chose to
 *      set in the Cloudflare dashboard or in `wrangler.jsonc`.
 *   3. The KV document at `rz:identity`, generated on first request when absent.
 *
 * The hostname is never one of the persisted values. It is read from the request,
 * because that is the only place it is reliably true: a Worker reachable on both
 * `x.workers.dev` and `panel.example.com` should generate configs for whichever one
 * the client actually asked for.
 *
 * What is deliberately not stored
 *
 * The Cloudflare account id and API token are read from the environment and never
 * written to KV. A token in KV is a token in every settings export and every
 * backup, and RayZen's whole deployment story is "no credential leaves your
 * account". Env-only keeps it in the one place Cloudflare already encrypts.
 *
 * The claim step
 *
 * A freshly deployed Worker has no email and no password, so it is *unclaimed*: it
 * serves a setup page at `/` and nothing else. The first person to complete that
 * form becomes the administrator. That window is real and is documented in
 * SECURITY.md. `RAYZEN_ADMIN_EMAIL` can pin the address the claim must use.
 *
 * Reads are amortised, not repeated
 *
 * The identity is immutable for the life of an isolate, so it is cached in module
 * scope after the first resolution. Without that cache every WebSocket relay
 * connection would cost a KV read, and the relay path deliberately touches no
 * storage at all today.
 */
import type { EmbededSettings } from '#types/settings';

/** The KV key holding a bootstrapped deployment's identity. Renaming it orphans one. */
export const IDENTITY_KV_KEY = 'rz:identity';

export type IdentitySource = 'embedded' | 'kv';

export interface Identity extends EmbededSettings {
    /** Cloudflare API token, sourced only from an encrypted Worker secret. */
    apiToken: string;
    /**
     * Which source won. A settings change is persisted differently for each: an
     * embedded identity lives in the script and needs a redeploy, a KV identity is
     * a single `kv.put`.
     */
    source: IdentitySource;
    /** The Worker script name, for the account-level Cloudflare API calls. */
    workerName: string;
}

/** The persisted half. Notably absent: the account id, the token and the hostname. */
interface IdentityRecord {
    accEmail: string;
    securePath: string;
    vlUUID: string;
    trPass: string;
    proxyIpMode: string;
    proxyIPs: string[];
    prefixes: string[];
    fallback: string;
    dohUrl: string;
    createdAt: string;
}

/**
 * The charset `validatePath` accepts, narrowed to the alphanumeric subset so that a
 * generated path needs no URL escaping in a subscription link.
 */
const SAFE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomToken(length: number): string {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    let out = '';
    for (const byte of bytes) out += SAFE_CHARS[byte % SAFE_CHARS.length];
    return out;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const list = (value: unknown): string[] =>
    text(value)
        .split(',')
        .map(entry => entry.trim())
        .filter(Boolean);

/**
 * The Worker name, used by the self-update, usage and custom-domain calls.
 *
 * `mainDomain.split('.')[0]` is the historical derivation and it is right for a
 * `workers.dev` hostname and wrong for a custom domain, where the first label is
 * whatever the operator called the subdomain. `RAYZEN_WORKER_NAME` exists so a
 * custom-domain deployment can state it rather than have it guessed.
 */
function resolveWorkerName(env: Env, hostname: string): string {
    const declared = text(env.RAYZEN_WORKER_NAME);
    if (declared) return declared;
    return hostname.split('.')[0];
}

function emptyRecord(): IdentityRecord {
    return {
        accEmail: '',
        securePath: randomToken(24),
        vlUUID: crypto.randomUUID(),
        trPass: randomToken(32),
        proxyIpMode: 'proxyip',
        proxyIPs: [],
        prefixes: [],
        fallback: '',
        dohUrl: '',
        createdAt: new Date().toISOString()
    };
}

/** Fills a partially written or hand-edited document without discarding what is there. */
function normaliseRecord(stored: unknown): IdentityRecord {
    const base = emptyRecord();
    if (!stored || typeof stored !== 'object') return base;
    const value = stored as Partial<IdentityRecord>;

    return {
        accEmail: text(value.accEmail).toLowerCase(),
        securePath: text(value.securePath) || base.securePath,
        vlUUID: text(value.vlUUID) || base.vlUUID,
        trPass: text(value.trPass) || base.trPass,
        proxyIpMode: text(value.proxyIpMode) || 'proxyip',
        proxyIPs: Array.isArray(value.proxyIPs) ? value.proxyIPs.filter(entry => typeof entry === 'string') : [],
        prefixes: Array.isArray(value.prefixes) ? value.prefixes.filter(entry => typeof entry === 'string') : [],
        fallback: text(value.fallback),
        dohUrl: text(value.dohUrl),
        createdAt: text(value.createdAt) || base.createdAt
    };
}

/**
 * Environment overrides for the persisted fields.
 *
 * Applied over the stored document rather than instead of it, so an operator can pin
 * one value (a path they have already handed out, say) and leave the rest generated.
 */
function applyEnv(record: IdentityRecord, env: Env): IdentityRecord {
    const merged = { ...record };
    const email = text(env.RAYZEN_ADMIN_EMAIL).toLowerCase();
    if (email) merged.accEmail = email;

    const overrides: [keyof IdentityRecord, string][] = [
        ['securePath', text(env.RAYZEN_SECURE_PATH)],
        ['vlUUID', text(env.RAYZEN_VL_UUID)],
        ['trPass', text(env.RAYZEN_TR_PASS)],
        ['proxyIpMode', text(env.RAYZEN_PROXY_IP_MODE)],
        ['fallback', text(env.RAYZEN_FALLBACK)],
        ['dohUrl', text(env.RAYZEN_DOH_URL)]
    ];

    for (const [key, value] of overrides) {
        if (value) (merged as Record<string, unknown>)[key] = value;
    }

    const proxyIPs = list(env.RAYZEN_PROXY_IPS);
    if (proxyIPs.length) merged.proxyIPs = proxyIPs;

    const prefixes = list(env.RAYZEN_PREFIXES);
    if (prefixes.length) merged.prefixes = prefixes;

    return merged;
}

/**
 * The error an operator sees when nothing can supply an identity: no embedded block
 * and no KV namespace to bootstrap one in.
 *
 * Rendered as HTML by `renderError`, so it stays plain: no markup, no links.
 */
function unresolvable(): Error {
    return new Error(
        'This deployment has no KV namespace bound to the name "kv", so it cannot store ' +
        'or read its own identity. Bind one in the Cloudflare dashboard under Settings, ' +
        'Bindings, KV namespace, using exactly the variable name kv, then reload. ' +
        'Deploying with the Deploy to Cloudflare button creates and binds it for you.'
    );
}

let cached: Identity | null = null;

/** Drops the isolate's cached identity. Called after a write changes it. */
export function invalidateIdentityCache(): void {
    cached = null;
}

/**
 * Resolves this deployment's identity for the current request.
 *
 * Cheap after the first call in an isolate: the embedded path reads no storage at
 * all, and the KV path reads once and caches. Only `mainDomain` and `workerName`
 * are recomputed per request, because both follow the hostname the client used.
 */
export async function resolveIdentity(request: Request, env: Env): Promise<Identity> {
    const { hostname } = new URL(request.url);

    if (cached) {
        return { ...cached, mainDomain: hostname, workerName: resolveWorkerName(env, hostname) };
    }

    const accID = text(env.RAYZEN_CF_ACCOUNT_ID);
    const apiToken = text(env.RAYZEN_CF_API_TOKEN);

    if (typeof EMBEDED_SETTINGS !== 'undefined') {
        // A packaged or self-redeployed artifact. Its own values win, except that an
        // empty hostname falls back to the request's: `npm run package` requires the
        // hostname, but a self-redeploy from a renamed Worker can carry a stale one.
        const embedded: Identity = {
            ...EMBEDED_SETTINGS,
            accEmail: EMBEDED_SETTINGS.accEmail.toLowerCase(),
            accID: EMBEDED_SETTINGS.accID || accID,
            apiToken,
            mainDomain: EMBEDED_SETTINGS.mainDomain || hostname,
            source: 'embedded',
            workerName: resolveWorkerName(env, EMBEDED_SETTINGS.mainDomain || hostname)
        };

        cached = embedded;
        return embedded;
    }

    if (!env.kv) throw unresolvable();

    let raw: string | null;
    try {
        // Read as text and parse here, rather than with `{ type: 'json' }`, so that a
        // namespace that is unreachable and a value that is unparseable are two
        // distinguishable failures. KV's own JSON mode collapses them into one.
        raw = await env.kv.get(IDENTITY_KV_KEY);
    } catch {
        // A read failure must not be indistinguishable from an absent document: one
        // means "bootstrap me", the other means "KV is unreachable and writing would
        // hand out a second identity". Fail loudly instead.
        throw new Error(
            'This deployment could not read its identity from KV. The namespace bound to ' +
            'the name "kv" may have been deleted. Bind a namespace and reload.'
        );
    }

    let stored: unknown = null;
    if (raw !== null) {
        try {
            stored = JSON.parse(raw);
        } catch {
            // Regenerating here would be worse than refusing: it would hand the
            // deployment a new panel path and new protocol credentials, silently
            // invalidating every subscription already in circulation. The operator
            // has to decide, so the message tells them exactly what to delete.
            throw new Error(
                'This deployment\'s identity record in KV is not valid JSON, so it cannot ' +
                'be read. Fix or delete the key rz:identity in the namespace bound to kv. ' +
                'Deleting it generates a fresh identity, which changes the panel path and ' +
                'invalidates existing subscription links.'
            );
        }
    }

    const isNew = raw === null;
    const record = applyEnv(normaliseRecord(stored), env);

    if (isNew) {
        // First request ever. Two concurrent first requests can each generate a
        // record and race the write. The loser's values are never revealed to anyone,
        // because the setup page is the only thing that discloses the panel path and
        // it re-reads the document before doing so.
        try {
            await env.kv.put(IDENTITY_KV_KEY, JSON.stringify(record));
        } catch {
            throw new Error(
                'This deployment could not write its identity to KV. Check that the ' +
                'namespace bound to the name "kv" exists and that the account is within ' +
                'its daily write limit, then reload.'
            );
        }
    }

    const identity: Identity = {
        accID,
        apiToken,
        accEmail: record.accEmail,
        vlUUID: record.vlUUID,
        trPass: record.trPass,
        securePath: record.securePath,
        proxyIpMode: record.proxyIpMode,
        proxyIPs: record.proxyIPs,
        prefixes: record.prefixes,
        fallback: record.fallback,
        dohUrl: record.dohUrl,
        mainDomain: hostname,
        source: 'kv',
        workerName: resolveWorkerName(env, hostname)
    };

    cached = identity;
    return identity;
}

/**
 * Reads the stored document, or a freshly generated one when absent.
 *
 * Used by the write paths, which must not build their update on top of the cached
 * in-memory identity: that copy carries env overrides and the request hostname, and
 * writing those back would persist values that are supposed to stay derived.
 */
export async function readIdentityRecord(env: Env): Promise<IdentityRecord> {
    if (!env.kv) throw unresolvable();
    const stored = await env.kv.get(IDENTITY_KV_KEY, { type: 'json' });
    return normaliseRecord(stored);
}

/** Writes the document and drops the isolate's cache so the next request re-reads. */
export async function writeIdentityRecord(env: Env, record: IdentityRecord): Promise<void> {
    if (!env.kv) throw unresolvable();
    await env.kv.put(IDENTITY_KV_KEY, JSON.stringify(record));
    invalidateIdentityCache();
}

/** Persists the fields the panel's settings form owns. */
export async function persistIdentitySettings(
    env: Env,
    changes: Partial<Pick<IdentityRecord,
        | 'securePath'
        | 'vlUUID'
        | 'trPass'
        | 'proxyIpMode'
        | 'proxyIPs'
        | 'prefixes'
        | 'fallback'
        | 'dohUrl'
    >>
): Promise<void> {
    const record = await readIdentityRecord(env);
    await writeIdentityRecord(env, { ...record, ...changes });
}

/** Records the administrator's email, completing the claim. */
export async function claimIdentity(env: Env, accEmail: string): Promise<IdentityRecord> {
    const record = await readIdentityRecord(env);
    const claimed = { ...record, accEmail: accEmail.trim().toLowerCase() };
    await writeIdentityRecord(env, claimed);
    return claimed;
}
