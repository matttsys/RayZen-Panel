/**
 * Where a deployment is allowed to send traffic.
 *
 * A privacy tool's outbound surface is part of its contract, and it is the sort of thing
 * that grows one convenient API at a time. `ip-api.com` arrived that way: two call sites
 * that were never in any allowlist, never in the docs, and invisible to an operator
 * auditing their deployment, because the Worker made them server-side rather than the
 * browser. One of them POSTed the operator's whole configured proxy list over plain HTTP.
 *
 * This test is the gate that makes the next one visible in review.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..', '..', 'src');

function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            // `assets/` is browser code, governed by the CSP and by
            // tests/golden/icon-subset.test.ts instead.
            if (entry.name === 'assets') continue;
            out.push(...walk(path));
        } else if (/\.ts$/.test(entry.name)) {
            out.push(path);
        }
    }
    return out;
}

/** Comments stripped, so a URL discussed in prose is not read as a call. */
function code(path: string): string {
    return readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//gu, '')
        .replace(/(^|[^:])\/\/[^\n]*/gu, '$1');
}

const files = walk(SRC);

/**
 * Hosts the Worker may contact, each with the reason it is here.
 *
 * Every entry is Cloudflare's own infrastructure or a service the operator explicitly
 * configured. Adding a host to this list is a decision about where a deployment's data
 * goes, which is why it needs a diff rather than a fetch call.
 */
const ALLOWED_HOSTS: Record<string, string> = {
    'api.cloudflare.com': 'The operator\'s own account API, only with a token they supplied.',
    'api.telegram.org': 'Only when the operator has configured a bot, and only with their token.',
    'api.cloudflareclient.com': 'WARP account registration, which is what makes the WARP subscriptions work.',
    'cloudflare-dns.com': 'The default DoH resolver, overridable in settings.'
};

describe('the Worker contacts nothing unexpected', () => {
    const literals: { file: string; host: string }[] = [];

    for (const path of files) {
        const source = code(path);
        for (const match of source.matchAll(/\bfetch\(\s*[`'"](https?:\/\/)([^`'"$/]+)/gu)) {
            literals.push({ file: path.replace(SRC + '/', ''), host: match[2] });
        }
    }

    it('every literal fetch destination is on the allowlist', () => {
        const unexpected = literals
            .filter(entry => !(entry.host in ALLOWED_HOSTS))
            .map(entry => `${entry.host} (${entry.file})`);

        expect(
            [...new Set(unexpected)],
            'add the host to ALLOWED_HOSTS with a reason, or route it through an operator-configured endpoint'
        ).toEqual([]);
    });

    it('no plaintext HTTP destination', () => {
        // `http://ip-api.com/batch` was one of these, carrying the operator's endpoint
        // list. There is no destination for which plaintext is the right choice here.
        const plaintext: string[] = [];
        for (const path of files) {
            for (const match of code(path).matchAll(/\bfetch\(\s*[`'"]http:\/\/([^`'"$/]+)/gu)) {
                plaintext.push(`${match[1]} (${path.replace(SRC + '/', '')})`);
            }
        }

        expect(plaintext).toEqual([]);
    });

    it('the allowlist stays small, and every entry carries a reason', () => {
        // A growing list is the thing to notice. Each reason has to be a sentence
        // someone can disagree with, not a label.
        expect(Object.keys(ALLOWED_HOSTS).length).toBeLessThanOrEqual(5);
        for (const [host, reason] of Object.entries(ALLOWED_HOSTS)) {
            expect(reason.length, `${host} has no real reason recorded`).toBeGreaterThan(30);
        }
    });
});

describe('geo lookup is opt-in', () => {
    const geo = code(join(SRC, 'api', 'geo.ts'));

    it('contacts no host unless the operator configured one', () => {
        // The default has to be "we do not know where this address is", because the
        // alternative is telling a stranger which endpoints this deployment routes
        // through.
        expect(geo).toContain('RAYZEN_GEO_ENDPOINT');
        expect(geo).toMatch(/if \(!endpoint \|\| !addresses\.length\) return unknown\(\)/u);
    });

    it('refuses a non-https endpoint even when configured', () => {
        expect(geo).toMatch(/protocol !== 'https:'/u);
    });

    it('bounds how many addresses one page load can look up', () => {
        // Without a cap, a long proxy list turns one page view into a dozen outbound
        // requests, which is the shape of traffic that gets a deployment noticed.
        expect(geo).toMatch(/addresses\.slice\(0, 200\)/u);
    });

    it('reports how each location was determined', () => {
        // A colo code from Cloudflare and a city from a third-party endpoint are
        // different claims, and the UI must not present them identically.
        expect(geo).toContain("'cloudflare-edge'");
        expect(geo).toContain("'operator-endpoint'");
        expect(geo).toContain("'unknown'");
    });
});

describe('the relay path stays free of API calls', () => {
    /**
     * The protocol handlers carry user traffic. An outbound API call on that path would
     * multiply by every connection, which is exactly what would get an account flagged.
     */
    const RELAY = ['protocols/vless.ts', 'protocols/trojan.ts', 'handlers/websocket.ts'];

    it.each(RELAY)('%s makes no Cloudflare API call', file => {
        const source = code(join(SRC, file));

        expect(source).not.toContain('api.cloudflare.com');
        expect(source).not.toContain('api.cloudflareclient.com');
    });

    it.each(RELAY)('%s performs no KV write', file => {
        const source = code(join(SRC, file));

        // A write per connection would exhaust the free plan's 1,000 daily writes with a
        // single active user.
        expect(source).not.toMatch(/kv\.put|write(Settings|WarpAccounts|TelegramBot|Password|SecretKey)\(/u);
    });
});
