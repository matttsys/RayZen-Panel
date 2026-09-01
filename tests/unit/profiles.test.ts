/**
 * Subscription profiles.
 *
 * Two things are being tested. The security properties, because a profile token is the
 * only thing between a stranger and a working subscription. And the *limits*: the module
 * deliberately does not offer byte quotas, and the tests pin the reasons so a later change
 * has to argue with them rather than quietly add a counter KV cannot keep correct.
 */
import { describe, expect, it } from 'vitest';
import {
    MAX_PROFILES,
    createProfile,
    expiryFrom,
    generateToken,
    normaliseName,
    normaliseProfiles,
    profileStatus,
    recordUse,
    resolveProfile,
    shouldPersistUse,
    type Profile
} from '../../src/features/profiles';

const NOW = Date.UTC(2026, 7, 2, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function profile(overrides: Partial<Profile> = {}): Profile {
    return {
        token: 'abcdefghijklmnopqrstuv',
        name: 'Phone',
        createdAt: NOW - DAY,
        expiresAt: null,
        enabled: true,
        requests: 0,
        requestLimit: null,
        lastSeenAt: null,
        lastSeenFrom: null,
        ...overrides
    };
}

describe('tokens are secrets', () => {
    it('are long enough and URL-safe', () => {
        const token = generateToken();

        expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/u);
    });

    it('are unpredictable', () => {
        // Not a statistical test, just a guard against a placeholder or a counter.
        const tokens = new Set(Array.from({ length: 200 }, generateToken));

        expect(tokens.size).toBe(200);
    });
});

describe('resolving a subscription request', () => {
    const profiles = [
        profile({ token: 'active0000000000000000', name: 'Laptop' }),
        profile({ token: 'expired000000000000000', name: 'Old', expiresAt: NOW - DAY }),
        profile({ token: 'disabled00000000000000', name: 'Revoked', enabled: false })
    ];

    it('resolves an active token', () => {
        const { profile: found, reason } = resolveProfile(profiles, 'active0000000000000000', NOW);

        expect(reason).toBe('ok');
        expect(found?.name).toBe('Laptop');
    });

    it('refuses an expired token', () => {
        const { profile: found, reason } = resolveProfile(profiles, 'expired000000000000000', NOW);

        expect(found).toBeNull();
        expect(reason).toBe('expired');
    });

    it('refuses a disabled token', () => {
        const { profile: found, reason } = resolveProfile(profiles, 'disabled00000000000000', NOW);

        expect(found).toBeNull();
        expect(reason).toBe('disabled');
    });

    it('refuses an unknown token', () => {
        expect(resolveProfile(profiles, 'nosuchtoken0000000000x', NOW).reason).toBe('unknown');
    });

    it('distinguishes reasons for the caller, not for the client', () => {
        // The reason exists so the Worker can log or count accurately. It must not become
        // a different HTTP status: answering 403 for a revoked token and 404 for an unknown
        // one confirms to whoever holds a revoked link that it was once real.
        const reasons = ['expired000000000000000', 'disabled00000000000000', 'nosuchtoken0000000000x']
            .map(token => resolveProfile(profiles, token, NOW));

        expect(reasons.every(result => result.profile === null)).toBe(true);
        expect(new Set(reasons.map(result => result.reason)).size).toBe(3);
    });

    it('a token one character short does not match', () => {
        const short = 'active000000000000000';

        expect(resolveProfile(profiles, short, NOW).reason).toBe('unknown');
    });

    it('expiry is inclusive at the boundary', () => {
        // A profile expiring "now" is expired. The alternative leaves a link working for
        // one more millisecond, which is not useful and is harder to reason about.
        const exact = [profile({ token: 'boundary00000000000000', expiresAt: NOW })];

        expect(resolveProfile(exact, 'boundary00000000000000', NOW).reason).toBe('expired');
        expect(resolveProfile(exact, 'boundary00000000000000', NOW - 1).reason).toBe('ok');
    });
});

describe('status', () => {
    it.each([
        ['active', profile()],
        ['expired', profile({ expiresAt: NOW - 1 })],
        ['disabled', profile({ enabled: false })]
    ])('reports %s', (expected, input) => {
        expect(profileStatus(input, NOW)).toBe(expected);
    });

    it('disabled outranks expired, because it is the operator\'s explicit choice', () => {
        expect(profileStatus(profile({ enabled: false, expiresAt: NOW - DAY }), NOW)).toBe('disabled');
    });
});

describe('creating a profile', () => {
    it('names it, tokenises it, and starts it enabled', () => {
        const created = createProfile('  Sister\'s phone  ', 30, NOW);

        expect(created.name).toBe("Sister's phone");
        expect(created.enabled).toBe(true);
        expect(created.requests).toBe(0);
        expect(created.expiresAt).toBe(NOW + 30 * DAY);
    });

    it('treats a missing or zero duration as no expiry', () => {
        expect(createProfile('x', undefined, NOW).expiresAt).toBeNull();
        expect(createProfile('x', 0, NOW).expiresAt).toBeNull();
        expect(createProfile('x', -5, NOW).expiresAt).toBeNull();
        expect(createProfile('x', 'nonsense', NOW).expiresAt).toBeNull();
    });

    it('expiryFrom converts days to an absolute time', () => {
        expect(expiryFrom(1, NOW)).toBe(NOW + DAY);
        expect(expiryFrom(90, NOW)).toBe(NOW + 90 * DAY);
        expect(expiryFrom(null, NOW)).toBeNull();
    });

    it('caps a very long expiry rather than overflowing', () => {
        // A large enough value overflows into a date that reads as already expired, which
        // would silently disable the link the operator just made.
        const far = createProfile('x', 1e9, NOW);

        expect(far.expiresAt).not.toBeNull();
        expect(far.expiresAt!).toBeGreaterThan(NOW);
        expect(far.expiresAt!).toBeLessThanOrEqual(NOW + 730 * DAY);
    });

    it('falls back to a placeholder rather than an empty name', () => {
        expect(createProfile('   ', 1, NOW).name).toBe('Unnamed');
        expect(createProfile(null, 1, NOW).name).toBe('Unnamed');
    });

    it('bounds the name and strips control characters', () => {
        expect(normaliseName('a'.repeat(200)).length).toBeLessThanOrEqual(40);
        expect(normaliseName('Phone\u0000\u001b[31m')).toBe('Phone[31m');
    });
});

describe('reading a stored list', () => {
    it('drops an entry whose token could never match a URL segment', () => {
        // The document is hand-editable in the Cloudflare dashboard, and a settings import
        // carries whatever the exporting deployment had.
        const list = normaliseProfiles([
            { token: 'valid00000000000000000', name: 'Keep' },
            { token: 'short', name: 'Too short' },
            { token: 'has spaces in it 00000', name: 'Invalid' },
            { token: 'has/slash/0000000000000', name: 'Invalid' },
            { token: '', name: 'Empty' },
            { name: 'No token at all' }
        ]);

        expect(list.map(entry => entry.name)).toEqual(['Keep']);
    });

    it('drops duplicate tokens rather than keeping an ambiguous pair', () => {
        const list = normaliseProfiles([
            { token: 'dupe00000000000000000x', name: 'First' },
            { token: 'dupe00000000000000000x', name: 'Second' }
        ]);

        expect(list).toHaveLength(1);
        expect(list[0].name).toBe('First');
    });

    it('treats a missing enabled flag as enabled', () => {
        // A document written before the field existed must not have every link silently
        // disabled by an upgrade.
        const list = normaliseProfiles([{ token: 'legacy0000000000000000', name: 'Old' }]);

        expect(list[0].enabled).toBe(true);
    });

    it('respects an explicit false', () => {
        const list = normaliseProfiles([{ token: 'off00000000000000000000', name: 'Off', enabled: false }]);

        expect(list[0].enabled).toBe(false);
    });

    it('discards a nonsense counter rather than trusting it', () => {
        const list = normaliseProfiles([
            { token: 'counter000000000000000', requests: -50, lastSeenAt: -1, expiresAt: -1 }
        ]);

        expect(list[0].requests).toBe(0);
        expect(list[0].lastSeenAt).toBeNull();
        expect(list[0].expiresAt).toBeNull();
    });

    it('keeps only a two-letter country code', () => {
        const list = normaliseProfiles([
            { token: 'geo00000000000000000000', lastSeenFrom: 'DE' },
            { token: 'geo11111111111111111111', lastSeenFrom: 'Germany' },
            { token: 'geo22222222222222222222', lastSeenFrom: '' }
        ]);

        expect(list.map(entry => entry.lastSeenFrom)).toEqual(['DE', null, null]);
    });

    it('bounds the list, so the settings document cannot grow without limit', () => {
        const many = Array.from({ length: 100 }, (_, index) => ({
            token: `token${String(index).padStart(17, '0')}`,
            name: `Profile ${index}`
        }));

        expect(normaliseProfiles(many).length).toBeLessThanOrEqual(MAX_PROFILES);
    });

    it('returns an empty list for anything that is not an array', () => {
        for (const value of [null, undefined, 'string', 42, {}]) {
            expect(normaliseProfiles(value)).toEqual([]);
        }
    });
});

describe('recording a use', () => {
    it('increments the count and stamps the time', () => {
        const list = recordUse([profile({ token: 'seen00000000000000000x' })], 'seen00000000000000000x', NOW, 'NL');

        expect(list[0].requests).toBe(1);
        expect(list[0].lastSeenAt).toBe(NOW);
        expect(list[0].lastSeenFrom).toBe('NL');
    });

    it('leaves other profiles untouched', () => {
        const before = [profile({ token: 'aaa00000000000000000000' }), profile({ token: 'bbb00000000000000000000' })];
        const after = recordUse(before, 'aaa00000000000000000000', NOW, 'FR');

        expect(after[1]).toEqual(before[1]);
    });

    it('keeps the previous country when the new one is unusable', () => {
        const list = recordUse([profile({ token: 'geo00000000000000000000', lastSeenFrom: 'DE' })],
            'geo00000000000000000000', NOW, 'XX-not-a-code');

        expect(list[0].lastSeenFrom).toBe('DE');
    });
});

describe('the write budget is respected, and the count is honest about it', () => {
    it('persists the first use', () => {
        expect(shouldPersistUse(profile({ lastSeenAt: null }), NOW)).toBe(true);
    });

    it('does not persist again within the hour', () => {
        // A subscription client polls every few minutes. Writing on each poll would spend
        // the free plan's entire 1,000-write daily budget on about three clients.
        expect(shouldPersistUse(profile({ lastSeenAt: NOW - 5 * 60 * 1000 }), NOW)).toBe(false);
        expect(shouldPersistUse(profile({ lastSeenAt: NOW - 59 * 60 * 1000 }), NOW)).toBe(false);
    });

    it('persists once an hour has passed', () => {
        expect(shouldPersistUse(profile({ lastSeenAt: NOW - HOUR }), NOW)).toBe(true);
    });

    it('so the request count is a lower bound, which is why quotas are not built on it', () => {
        // This test documents a deliberate limitation. If a later change wants byte or
        // request quotas, it has to replace the storage first: a counter that undercounts
        // by design cannot enforce a limit, and a quota that fails open silently is worse
        // than no quota at all.
        const polled = profile({ lastSeenAt: NOW - 10 * 60 * 1000, requests: 1 });

        expect(shouldPersistUse(polled, NOW)).toBe(false);
        expect(polled.requests).toBe(1);
    });
});
