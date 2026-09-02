/**
 * Tests for the storage layer.
 *
 * The most important assertion here is the key-name contract. The five KV key
 * names are inherited from legacy upstream verbatim, and they are how an existing
 * deployment's data is found after upgrading. Renaming one orphans a live user's
 * settings silently, with no error and no obvious symptom beyond the panel
 * appearing to reset itself.
 */
import { describe, expect, it } from 'vitest';
import { createStorage, KV_KEYS } from '@storage';
import { createKvStub } from '../helpers/worker';

describe('KV key contract', () => {
    it('the five key names match what legacy upstream deployments already have', () => {
        // Hard-coded literals on purpose. If someone changes the source, this
        // test must be edited too, which forces the compatibility question to be
        // asked out loud.
        expect(KV_KEYS).toEqual({
            settings: 'proxySettings',
            warpAccounts: 'warpAccounts',
            telegramBot: 'telegramBot',
            password: 'pwd',
            secretKey: 'secretKey'
        });
    });

    it('declares exactly five keys, so a new one is a deliberate addition', () => {
        expect(Object.keys(KV_KEYS)).toHaveLength(5);
    });
});

describe('createStorage', () => {
    it('reads settings from the proxySettings key', async () => {
        const kv = createKvStub({ proxySettings: { panelVersion: '1.2.3' } });
        const storage = createStorage(kv.namespace);

        const settings = await storage.readSettings();

        expect(settings?.panelVersion).toBe('1.2.3');
        expect(kv.calls).toEqual([{ op: 'get', key: 'proxySettings' }]);
    });

    it('returns null rather than throwing when a key is absent', async () => {
        const storage = createStorage(createKvStub({}).namespace);

        await expect(storage.readSettings()).resolves.toBeNull();
        await expect(storage.readWarpAccounts()).resolves.toBeNull();
        await expect(storage.readTelegramBot()).resolves.toBeNull();
        await expect(storage.readPassword()).resolves.toBeNull();
        await expect(storage.readSecretKey()).resolves.toBeNull();
    });

    it('round-trips settings through JSON', async () => {
        const kv = createKvStub({});
        const storage = createStorage(kv.namespace);
        const settings = { panelVersion: '9.9.9', enableIPv6: true } as never;

        await storage.writeSettings(settings);

        expect(await storage.readSettings()).toEqual(settings);
    });

    it('round-trips WARP accounts', async () => {
        const kv = createKvStub({});
        const storage = createStorage(kv.namespace);
        const accounts = [
            { privateKey: 'fake-a', publicKey: 'fake-b', warpIPv6: '2001:db8::1/128', reserved: 'AAAA' }
        ];

        await storage.writeWarpAccounts(accounts);

        expect(await storage.readWarpAccounts()).toEqual(accounts);
    });

    it('round-trips the Telegram bot record', async () => {
        const kv = createKvStub({});
        const storage = createStorage(kv.namespace);
        const bot = { telegramBotToken: 'fake-token', telegramUserId: '12345' };

        await storage.writeTelegramBot(bot);

        expect(await storage.readTelegramBot()).toEqual(bot);
    });

    it('stores the password as an opaque string, not JSON', async () => {
        const kv = createKvStub({});
        const storage = createStorage(kv.namespace);

        await storage.writePassword('correct-horse');

        // A JSON-encoded write would store '"correct-horse"' with quotes, which
        // would not match what an existing legacy upstream deployment has.
        expect(kv.store.get('pwd')).toBe('correct-horse');
        expect(await storage.readPassword()).toBe('correct-horse');
    });

    it('stores the secret key as an opaque string, not JSON', async () => {
        const kv = createKvStub({});
        const storage = createStorage(kv.namespace);
        const secret = 'a'.repeat(64);

        await storage.writeSecretKey(secret);

        expect(kv.store.get('secretKey')).toBe(secret);
        expect(await storage.readSecretKey()).toBe(secret);
    });

    it('reads a plaintext password written by an existing legacy upstream deployment', async () => {
        // Migration compatibility: legacy upstream wrote these values directly with
        // env.kv.put('pwd', password). The storage layer must read them as-is.
        const kv = createKvStub({ pwd: 'legacy-bpb-password' });

        expect(await createStorage(kv.namespace).readPassword()).toBe('legacy-bpb-password');
    });

    it('touches only the namespace it was given', async () => {
        // The factory takes a KVNamespace rather than the whole Env, so nothing
        // downstream can reach another binding through it.
        const kv = createKvStub({ proxySettings: {} });
        const storage = createStorage(kv.namespace);

        await storage.readSettings();
        await storage.writeSettings({} as never);

        expect(kv.calls.map(call => call.key)).toEqual(['proxySettings', 'proxySettings']);
    });
});
