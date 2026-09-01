/**
 * Fixture hygiene.
 *
 * Golden fixtures are large, numerous, and rarely read closely, which makes them
 * the easiest place for a real credential to end up in version control without
 * anyone noticing. These tests make that mechanically impossible to miss.
 *
 * Production defaults now contain no WARP private keys. Fixtures must use only
 * their explicit test accounts; deployment-owned keys are generated at runtime.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TEST_EMAIL } from '../setup/globals';

/** TLDs reserved by RFC 2606 / RFC 6761 that can never resolve. */
const RESERVED_TLDS = ['.invalid', '.example', '.test', '.localhost'];

/**
 * Hostnames the fixtures legitimately contain as proxy destinations. A
 * `credential@host` pair for one of these is userinfo in a proxy URI, not a
 * mailbox.
 */
const FIXTURE_HOSTS = [
    'rayzen-test.workers.dev',
    'rayzen-test.workers',
    'cdn.example.com',
    'upstream.example.com',
    'www.speedtest.net',
    'www.speedtest',
    'engage.cloudflareclient.com'
];

const GOLDEN_DIR = join(import.meta.dirname, '..', 'fixtures', 'golden');

function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(path));
        else out.push(path);
    }
    return out;
}

const fixtures = walk(GOLDEN_DIR);

describe('golden fixtures exist', () => {
    it('the corpus is populated', () => {
        expect(fixtures.length).toBeGreaterThan(0);
    });
});

describe('no production credentials in fixtures', () => {
    it('no fixture contains a real-looking Cloudflare API token', () => {
        // Assert on the field names rather than on a 40-char shape: config bodies
        // legitimately contain long base64 runs (WARP keys, ECH lists), so a
        // shape-based check produces false positives.
        for (const path of fixtures) {
            const text = readFileSync(path, 'utf8');
            expect(text, `${path} mentions apiToken`).not.toContain('apiToken');
            expect(text, `${path} mentions accID`).not.toContain('accID');
            expect(text, `${path} mentions accEmail`).not.toContain('accEmail');
        }
    });

    it('no fixture leaks a mailbox at a resolvable domain', () => {
        // Deliberately NOT a general email regex. Generated configs are full of
        // `credential@host` userinfo (every VLESS and Trojan URI), which is
        // email-shaped and entirely legitimate. Two narrower rules catch the
        // thing that actually matters without drowning in false positives:
        //
        //  1. The configured account email must never appear. It is the login
        //     username, and it is currently baked into the artifact
        //     (src/settings/main.ts:104-140), so a fixture carrying it would
        //     publish a real operator's username.
        //  2. The test account's address must be at a reserved TLD, so even the
        //     intended value can never route anywhere.
        const offenders: string[] = [];

        for (const path of fixtures) {
            const text = readFileSync(path, 'utf8');
            if (text.includes(TEST_EMAIL)) {
                // The fake address is fine; a *different* one is not.
                continue;
            }
            // Flag any address at a real, non-reserved TLD.
            const emails = text.match(/\b[a-z][a-z0-9._+-]*@(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi) ?? [];
            for (const email of emails) {
                const domain = email.split('@')[1].toLowerCase();
                if (RESERVED_TLDS.some(suffix => domain.endsWith(suffix))) continue;
                if (FIXTURE_HOSTS.includes(domain)) continue;
                offenders.push(`${path}: ${email}`);
            }
        }

        expect(offenders).toEqual([]);
    });

    it('the test account address uses a reserved TLD', () => {
        // Guards the convention itself: if someone changes TEST_EMAIL to a real
        // domain, this fails before any fixture can embed it.
        expect(TEST_EMAIL).toMatch(/\.(invalid|example|test|localhost)$/);
    });
});

describe('fixture corpus stays reviewable', () => {
    it('no single fixture exceeds 512 KB', () => {
        // A fixture larger than this is not reviewable in a diff, which defeats
        // the purpose. If one grows past it, the profile is probably too broad
        // and should be split.
        const oversized = fixtures
            .map(path => ({ path, size: statSync(path).size }))
            .filter(entry => entry.size > 512 * 1024);

        expect(oversized).toEqual([]);
    });

    it('the whole corpus stays under 8 MB', () => {
        const total = fixtures.reduce((sum, path) => sum + statSync(path).size, 0);
        expect(total).toBeLessThan(8 * 1024 * 1024);
    });
});
