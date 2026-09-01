/**
 * Subscription profiles: separate links for the people you share with.
 *
 * The problem this solves
 *
 * Today a deployment has one subscription link. Sharing it with four people means all
 * four hold the same URL, so revoking one revokes everyone, and nothing distinguishes
 * them. A profile is a named token that produces the same configurations under its own
 * URL, so one can be revoked or allowed to expire without touching the others.
 *
 * What is honest about traffic, and what is not
 *
 * This is where a feature like this usually starts lying, so it is worth being exact.
 *
 * A Cloudflare Worker relaying a WebSocket *can* observe bytes in principle, by counting
 * chunk sizes as they pass. RayZen deliberately does not, and per-profile byte quotas are
 * therefore not offered. Three reasons, in order of weight:
 *
 *   1. **KV cannot hold a counter that matters.** `src/platform/repositories.ts` says it
 *      outright: two isolates incrementing the same day lose an increment, because both
 *      read the same base. That is fine for a dashboard trend and unacceptable for a
 *      quota, where the whole point is that the number is correct. A correct counter needs
 *      Durable Objects, which is a different storage product with a different cost.
 *   2. **The write budget forbids it.** The free plan allows 1,000 KV writes a day. A
 *      byte counter updated per connection, or worse per chunk, exhausts that with one
 *      active user, and the audit in this release exists precisely because that class of
 *      pattern is what gets an account flagged.
 *   3. **A quota that silently fails open is worse than none.** An operator who believes
 *      a profile is capped at 10 GB and finds it was not has been misled by their own
 *      tool.
 *
 * So profiles carry an **expiry** and a **revocation switch**, both of which a Worker can
 * enforce exactly, and they carry **request counts and last-seen times**, which are
 * approximate by construction and labelled as such. What the panel shows is what was
 * measured: how often a profile fetched its subscription, and when it last did. That is
 * genuinely useful for spotting a link that has been shared onward, and it is not
 * presented as traffic accounting.
 */
/** A shared subscription identity. */
export interface Profile {
    /** URL-safe token. This is the secret; it appears in the subscription link. */
    token: string;
    /** Operator-supplied label. Never used for authorisation. */
    name: string;
    /** Epoch ms. */
    createdAt: number;
    /** Epoch ms after which the link stops working, or null for no expiry. */
    expiresAt: number | null;
    /** False disables the link without deleting its history. */
    enabled: boolean;
    /** Subscription fetches observed. Approximate; see the module comment. */
    requests: number;
    /** Epoch ms of the most recent fetch, or null if never used. */
    lastSeenAt: number | null;
    /**
     * Coarse location of the last fetch, from Cloudflare's own request metadata.
     *
     * A country code, not an address. Enough to notice a link being used somewhere
     * unexpected, without the deployment keeping a log of where its users are.
     */
    lastSeenFrom: string | null;
}

/** Longest a profile name may be, so the settings document stays bounded. */
const MAX_NAME = 40;

/** Most profiles one deployment may have. */
export const MAX_PROFILES = 20;

/** Token length in bytes before encoding. 16 bytes is 22 base64url characters. */
const TOKEN_BYTES = 16;

export type ProfileStatus = 'active' | 'expired' | 'disabled';

export function profileStatus(profile: Profile, now: number): ProfileStatus {
    if (!profile.enabled) return 'disabled';
    if (profile.expiresAt !== null && profile.expiresAt <= now) return 'expired';
    return 'active';
}

/**
 * Generates a profile token.
 *
 * `crypto.getRandomValues` rather than `Math.random`, because this value is the only thing
 * standing between a stranger and a working subscription. base64url so it survives a URL
 * without encoding.
 */
export function generateToken(): string {
    const bytes = new Uint8Array(TOKEN_BYTES);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
}

/** Trims and bounds an operator-supplied name. */
export function normaliseName(value: unknown): string {
    const text = typeof value === 'string' ? value.trim() : '';
    // Control characters are stripped rather than escaped: a name is display text and has
    // no reason to contain them, and they break both the panel table and Telegram HTML.
    return text.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, MAX_NAME) || 'Unnamed';
}

/** Days to an absolute expiry, or null when the input means "no expiry". */
export function expiryFrom(days: unknown, now: number): number | null {
    const value = Number(days);
    if (!Number.isFinite(value) || value <= 0) return null;
    // Capped at two years: a longer expiry is indistinguishable from none, and an
    // unbounded value invites an overflow that reads as already expired.
    return now + Math.min(value, 730) * 24 * 60 * 60 * 1000;
}

export function createProfile(name: unknown, days: unknown, now: number): Profile {
    return {
        token: generateToken(),
        name: normaliseName(name),
        createdAt: now,
        expiresAt: expiryFrom(days, now),
        enabled: true,
        requests: 0,
        lastSeenAt: null,
        lastSeenFrom: null
    };
}

/**
 * Validates a stored profile list.
 *
 * Applied on read, because the document can be edited by hand in the Cloudflare dashboard
 * and because a settings import carries whatever the exporting deployment had. A malformed
 * entry is dropped rather than repaired: a profile whose token is unusable is not a
 * profile, and inventing one would give an operator a link that authorises nothing.
 */
export function normaliseProfiles(value: unknown): Profile[] {
    if (!Array.isArray(value)) return [];

    const out: Profile[] = [];
    const seen = new Set<string>();

    for (const entry of value.slice(0, MAX_PROFILES)) {
        if (!entry || typeof entry !== 'object') continue;
        const row = entry as Record<string, unknown>;

        const token = typeof row.token === 'string' ? row.token.trim() : '';
        // The token is compared against a URL segment, so anything outside the
        // URL-safe set could never match and is more likely a corrupted document than
        // a usable profile.
        if (!/^[A-Za-z0-9_-]{16,64}$/u.test(token) || seen.has(token)) continue;
        seen.add(token);

        const createdAt = Number(row.createdAt);
        const expiresAt = Number(row.expiresAt);
        const lastSeenAt = Number(row.lastSeenAt);
        const requests = Number(row.requests);

        out.push({
            token,
            name: normaliseName(row.name),
            createdAt: Number.isFinite(createdAt) ? createdAt : 0,
            expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null,
            // Absent means enabled: a document written before this field existed, or one
            // an operator hand-edited, should not silently disable every link.
            enabled: row.enabled !== false,
            requests: Number.isFinite(requests) && requests > 0 ? Math.floor(requests) : 0,
            lastSeenAt: Number.isFinite(lastSeenAt) && lastSeenAt > 0 ? lastSeenAt : null,
            lastSeenFrom: typeof row.lastSeenFrom === 'string' && /^[A-Z]{2}$/u.test(row.lastSeenFrom)
                ? row.lastSeenFrom
                : null
        });
    }

    return out;
}

/**
 * Finds the profile a subscription request belongs to.
 *
 * Returns the profile only when it is usable. An expired or disabled profile resolves to
 * `null` with a reason, so the caller answers 404 rather than 403: a 403 confirms the
 * token was real, which tells whoever holds a revoked link that they had the right one.
 */
export function resolveProfile(
    profiles: readonly Profile[],
    token: string,
    now: number
): { profile: Profile | null; reason: 'ok' | 'unknown' | 'expired' | 'disabled' } {
    const found = profiles.find(profile => timingSafeEqual(profile.token, token));
    if (!found) return { profile: null, reason: 'unknown' };

    const status = profileStatus(found, now);
    if (status === 'expired') return { profile: null, reason: 'expired' };
    if (status === 'disabled') return { profile: null, reason: 'disabled' };
    return { profile: found, reason: 'ok' };
}

/**
 * Compares a token without leaking its prefix through timing.
 *
 * `===` short-circuits at the first differing byte, which is enough to recover a token one
 * character at a time. The length comparison is not secret: an attacker controls their own
 * guess.
 */
function timingSafeEqual(expected: string, supplied: string): boolean {
    if (expected.length !== supplied.length) return false;
    let diff = 0;
    for (let index = 0; index < expected.length; index++) {
        diff |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
    }
    return diff === 0;
}

/**
 * Records a use, returning the updated list.
 *
 * Pure, so the caller decides whether the write is worth making. It usually is not on
 * every request: see `shouldPersistUse`.
 */
export function recordUse(
    profiles: readonly Profile[],
    token: string,
    now: number,
    country: string | null
): Profile[] {
    return profiles.map(profile => profile.token !== token ? profile : {
        ...profile,
        requests: profile.requests + 1,
        lastSeenAt: now,
        lastSeenFrom: country && /^[A-Z]{2}$/u.test(country) ? country : profile.lastSeenFrom
    });
}

/**
 * Whether a use is worth a KV write.
 *
 * A subscription client polls every few minutes. Writing on each one would spend the
 * free plan's entire daily write budget on three clients, so the counter is persisted at
 * most once per hour per profile. The count is therefore a lower bound on requests, which
 * is why the panel labels it "seen" rather than "requests", and why quotas are not built
 * on it.
 */
export function shouldPersistUse(profile: Profile, now: number): boolean {
    if (profile.lastSeenAt === null) return true;
    return now - profile.lastSeenAt >= 60 * 60 * 1000;
}
