/**
 * Telegram settings commands.
 *
 * These are a settings API reachable from a chat window, so the tests are mostly about
 * what they refuse: a value the panel's form would reject, an unbounded list, an index
 * that shifts under a multi-argument removal.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initRequestGlobals } from '../helpers/worker';

/** Settings-document writes, from `/adddomain` and `/removedomain`. */
const updated: Record<string, unknown>[] = [];

/**
 * Identity writes, from `/addip` and `/removeip`.
 *
 * Both stores are captured because the two lists live in different places, and an earlier
 * version of these tests mocked only `updateDataset`. That made them pass while `/addip`
 * wrote to the settings document, where nothing reads `proxyIPs`: the bot replied "Added
 * 1 Proxy IP" and `/listips` answered "None configured". A test that asserts the value
 * reached *a* write, rather than the write that owns it, cannot catch that.
 */
const identityWrites: Record<string, unknown>[] = [];

vi.mock('@kv', async () => {
    const actual = await vi.importActual<typeof import('../../src/settings/kv')>('../../src/settings/kv');
    return {
        ...actual,
        updateDataset: vi.fn(async (_env: unknown, settings: Record<string, unknown>) => {
            updated.push(settings);
            return settings;
        })
    };
});

vi.mock('@identity', async () => {
    const actual = await vi.importActual<typeof import('../../src/settings/identity')>('../../src/settings/identity');
    return {
        ...actual,
        persistIdentitySettings: vi.fn(async (_env: unknown, changes: Record<string, unknown>) => {
            identityWrites.push(changes);
        })
    };
});

vi.mock('cloudflare:sockets', () => ({
    connect: () => { throw new Error('no socket in this suite'); }
}));

const env = { kv: undefined } as never;

async function commands() {
    return import('../../src/api/telegram-commands');
}

beforeEach(async () => {
    updated.length = 0;
    identityWrites.length = 0;
    await initRequestGlobals();
});

describe('argument parsing', () => {
    it('accepts several values separated by spaces or commas', async () => {
        const { parseArguments } = await commands();

        expect(parseArguments('/addip 1.2.3.4 5.6.7.8')).toEqual(['1.2.3.4', '5.6.7.8']);
        expect(parseArguments('/addip 1.2.3.4, 5.6.7.8')).toEqual(['1.2.3.4', '5.6.7.8']);
        expect(parseArguments('/addip   1.2.3.4  ')).toEqual(['1.2.3.4']);
    });

    it('returns nothing for a bare command', async () => {
        const { parseArguments } = await commands();

        expect(parseArguments('/addip')).toEqual([]);
        expect(parseArguments('/listips')).toEqual([]);
    });
});

describe('adding entries', () => {
    it('adds a valid address and writes it', async () => {
        const { addEntries } = await commands();
        const result = await addEntries(env, 'ip', ['1.2.3.4']);

        expect(result.changed).toBe(true);
        expect(result.text).toContain('1.2.3.4');
        // The identity store, which is where `proxyIPs` is actually read from.
        expect(identityWrites).toHaveLength(1);
        expect(identityWrites[0].proxyIPs).toContain('1.2.3.4');
        expect(updated, 'a proxy IP must not go into the settings document').toHaveLength(0);
    });

    it('accepts an address with a port, and a domain', async () => {
        const { addEntries } = await commands();
        const result = await addEntries(env, 'ip', ['1.2.3.4:443', 'proxy.example.com']);

        expect(result.changed).toBe(true);
        expect(identityWrites[0].proxyIPs).toEqual(expect.arrayContaining(['1.2.3.4:443', 'proxy.example.com']));
    });

    it('rejects a value the panel form would reject, and writes nothing', async () => {
        // The whole point of sharing `isValidProxyHost` with the form: a message must not
        // be able to store a value the panel would have refused.
        const { addEntries } = await commands();
        const result = await addEntries(env, 'ip', ['not a host', '999.999.999.999', 'http://x.com']);

        expect(result.changed).toBe(false);
        expect(result.text).toContain('Nothing was added');
        expect(updated).toHaveLength(0);
        expect(identityWrites).toHaveLength(0);
    });

    it('reports partial success rather than rejecting the whole batch', async () => {
        // Rejecting all three would make the operator retype the good ones; dropping the
        // bad one silently would leave them believing it was stored.
        const { addEntries } = await commands();
        const result = await addEntries(env, 'ip', ['1.2.3.4', 'nonsense host', '5.6.7.8']);

        expect(result.changed).toBe(true);
        expect(identityWrites[0].proxyIPs).toEqual(expect.arrayContaining(['1.2.3.4', '5.6.7.8']));
        expect(result.text).toContain('Added 2');
        expect(result.text).toContain('Rejected');
    });

    it('does not add a duplicate, and says why', async () => {
        const { addEntries } = await commands();
        await addEntries(env, 'ip', ['1.2.3.4']);
        updated.length = 0;

        // Duplicates within one command, which is the case that was broken: only the
        // stored list was checked, so the same address was written twice.
        const result = await addEntries(env, 'ip', ['1.2.3.4', '1.2.3.4']);
        expect(result.text).toContain('Added 1');
        expect(result.text).toContain('Already present');
        expect((identityWrites[0].proxyIPs as string[]).filter(value => value === '1.2.3.4')).toHaveLength(1);
    });

    it('caps the list, so it cannot grow without limit', async () => {
        // KV values have a size ceiling: an oversized settings document fails on write and
        // breaks the panel, not the bot.
        const { addEntries } = await commands();
        const many = Array.from({ length: 60 }, (_, index) => `10.0.0.${index + 1}`);
        const result = await addEntries(env, 'ip', many);

        expect((identityWrites[0].proxyIPs as string[]).length).toBeLessThanOrEqual(40);
        expect(result.text).toContain('list full');
    });

    it('explains the format when called with no arguments', async () => {
        const { addEntries } = await commands();
        const result = await addEntries(env, 'ip', []);

        expect(result.changed).toBe(false);
        expect(result.text).toContain('Usage');
        expect(updated).toHaveLength(0);
        expect(identityWrites).toHaveLength(0);
    });

    it('a clean-IP entry may not carry a port', async () => {
        // The CDN address field has no port, and accepting one would produce a
        // subscription the client cannot use.
        const { addEntries } = await commands();
        const result = await addEntries(env, 'domain', ['cdn.example.com:8443']);

        expect(result.changed).toBe(false);
        expect(updated).toHaveLength(0);
        expect(identityWrites).toHaveLength(0);
    });
});

describe('removing entries', () => {
    it('removes by value', async () => {
        const { addEntries, removeEntries } = await commands();
        await addEntries(env, 'domain', ['a.example.com', 'b.example.com']);
        updated.length = 0;

        const result = await removeEntries(env, 'domain', ['a.example.com']);
        expect(result.text).toMatch(/Removed|Nothing matched/u);
    });

    it('reports a value that is not configured rather than failing silently', async () => {
        const { removeEntries } = await commands();
        const result = await removeEntries(env, 'domain', ['never-added.example.com']);

        expect(result.changed).toBe(false);
        expect(result.text).toMatch(/No .* is configured|Nothing matched/u);
    });

    it('explains itself when called with no arguments', async () => {
        const { removeEntries } = await commands();
        const result = await removeEntries(env, 'ip', []);

        expect(result.changed).toBe(false);
        expect(result.text).toContain('Usage');
    });
});

describe('listing entries', () => {
    it('shows the list with its cap, and how to add to it', async () => {
        const { listEntries } = await commands();
        const result = await listEntries('domain');

        expect(result.changed).toBe(false);
        // The suite's globals seed a clean-IP list, so this asserts the populated form.
        // The empty form is covered by the proxy-IP list, which starts empty.
        expect(result.text).toMatch(/of 40 used/u);
        expect(result.text).toContain('Clean IP or domain');
    });

    it('says so when a list is empty, and how to add to it', async () => {
        const { listEntries } = await commands();
        const result = await listEntries('ip');

        expect(result.text).toContain('None configured');
        expect(result.text).toContain('/addip');
    });

    it('numbers the entries, so removal by index is possible', async () => {
        // These values are long and awkward to retype on a phone, which is why index
        // removal exists and why the list has to be numbered.
        const { addEntries, listEntries } = await commands();
        await addEntries(env, 'domain', ['a.example.com', 'b.example.com']);

        const result = await listEntries('domain');
        expect(result.text).toMatch(/1\./u);
    });

    it('never reports a change', async () => {
        const { listEntries } = await commands();

        expect((await listEntries('ip')).changed).toBe(false);
        expect(updated).toHaveLength(0);
    });
});

describe('dispatch', () => {
    it('routes each settings command', async () => {
        const { handleSettingsCommand } = await commands();

        for (const text of ['/listips', '/listdomains', '/addip 1.2.3.4', '/adddomain a.example.com']) {
            expect(await handleSettingsCommand(env, text), text).not.toBeNull();
        }
    });

    it('is case-insensitive on the command', async () => {
        const { handleSettingsCommand } = await commands();

        expect(await handleSettingsCommand(env, '/ListIPs')).not.toBeNull();
    });

    it('returns null for anything else, so the existing menu still handles it', async () => {
        // Returning an error instead would change how unrelated messages are handled, and
        // the fallback keyboard is what makes the bot usable without memorising commands.
        const { handleSettingsCommand } = await commands();

        for (const text of ['/status', '/start', 'hello', '', '/addipx 1.2.3.4']) {
            expect(await handleSettingsCommand(env, text), text).toBeNull();
        }
    });

    it('writes nothing for a read-only command', async () => {
        const { handleSettingsCommand } = await commands();
        await handleSettingsCommand(env, '/listips');

        expect(updated).toHaveLength(0);
        expect(identityWrites).toHaveLength(0);
    });

    it('each list is written to the store that owns it', async () => {
        // The distinction that was wrong: `proxyIPs` is identity, `cleanIPs` is settings.
        const { handleSettingsCommand } = await commands();

        await handleSettingsCommand(env, '/addip 7.7.7.7');
        expect(identityWrites).toHaveLength(1);
        expect(updated).toHaveLength(0);

        identityWrites.length = 0;
        await handleSettingsCommand(env, '/adddomain fresh.example.com');
        expect(updated).toHaveLength(1);
        expect(updated[0].cleanIPs).toContain('fresh.example.com');
        expect(identityWrites).toHaveLength(0);
    });
});

describe('output is safe to send', () => {
    it('escapes HTML in stored values', async () => {
        // Telegram rejects a whole message whose HTML does not parse, so an unescaped `<`
        // in a stored value would make the reply fail rather than render oddly.
        const { addEntries } = await commands();
        const result = await addEntries(env, 'ip', ['<script>alert(1)</script>']);

        expect(result.text).not.toContain('<script>');
        expect(result.text).toContain('&lt;');
    });
});
