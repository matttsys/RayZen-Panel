/**
 * Storage layer: the single place that knows KV key names.
 *
 * Before this module, `env.kv.get('pwd')` and friends appeared in 22 places
 * across five files (settings/kv.ts, api/warp.ts, api/telegram.ts, auth/auth.ts,
 * handlers/panel.ts). That meant:
 *
 *   - A key rename was a repo-wide search, and getting it wrong orphans a live
 *     deployment's data silently.
 *   - Nothing could be asserted about read/write counts, which matter because the
 *     free plan allows 100,000 KV reads but only 1,000 writes per day.
 *   - Handlers and API clients reached into storage directly, so there was no
 *     layer at which caching or a consistency policy could be added.
 *
 * The five key names are a compatibility contract: they are how an existing legacy upstream
 * deployment's data is found after upgrading to RayZen. They are asserted in
 * tests and must not change.
 *
 * This is a thin, honest wrapper. It does not add caching, retries, or a
 * consistency model, each of which would need its own justification. It only
 * moves the key strings behind one door.
 */
import type { KvSettings, TelegramBot, WarpAccount } from '#types/settings';

/**
 * Every KV key RayZen uses. Inherited from legacy upstream verbatim.
 *
 * Renaming any value here orphans existing deployments' data. The names are
 * pinned by a test.
 */
export const KV_KEYS = {
    /** Main configurable panel settings, migrated when the version changes. */
    settings: 'proxySettings',
    /** WARP account material used for WARP/WireGuard config generation. */
    warpAccounts: 'warpAccounts',
    /** Telegram bot token and user id. */
    telegramBot: 'telegramBot',
    /** Salted PBKDF2 password verifier; legacy plaintext values migrate on login. */
    password: 'pwd',
    /** HS256 signing secret for session tokens, generated on first login. */
    secretKey: 'secretKey'
} as const;

export type KvKey = (typeof KV_KEYS)[keyof typeof KV_KEYS];

/**
 * Read and write access to panel storage.
 *
 * Methods are named for intent rather than for the key, so a caller cannot
 * accidentally read the wrong shape.
 */
export interface Storage {
    readSettings(): Promise<KvSettings | null>;
    writeSettings(settings: KvSettings): Promise<void>;

    readWarpAccounts(): Promise<WarpAccount[] | null>;
    writeWarpAccounts(accounts: WarpAccount[]): Promise<void>;

    readTelegramBot(): Promise<TelegramBot | null>;
    writeTelegramBot(bot: TelegramBot): Promise<void>;

    readPassword(): Promise<string | null>;
    writePassword(password: string): Promise<void>;

    readSecretKey(): Promise<string | null>;
    writeSecretKey(secret: string): Promise<void>;
}

/**
 * Binds a `Storage` to a request's KV namespace.
 *
 * Takes the namespace rather than the whole `Env` so that nothing downstream can
 * reach other bindings through it.
 */
export function createStorage(kv: KVNamespace): Storage {
    const readJson = <T>(key: KvKey): Promise<T | null> =>
        kv.get(key, { type: 'json' }) as Promise<T | null>;

    const writeJson = (key: KvKey, value: unknown): Promise<void> =>
        kv.put(key, JSON.stringify(value));

    return {
        readSettings: () => readJson<KvSettings>(KV_KEYS.settings),
        writeSettings: settings => writeJson(KV_KEYS.settings, settings),

        readWarpAccounts: () => readJson<WarpAccount[]>(KV_KEYS.warpAccounts),
        writeWarpAccounts: accounts => writeJson(KV_KEYS.warpAccounts, accounts),

        readTelegramBot: () => readJson<TelegramBot>(KV_KEYS.telegramBot),
        writeTelegramBot: bot => writeJson(KV_KEYS.telegramBot, bot),

        // Password and secret are opaque strings, not JSON.
        readPassword: () => kv.get(KV_KEYS.password),
        writePassword: password => kv.put(KV_KEYS.password, password),

        readSecretKey: () => kv.get(KV_KEYS.secretKey),
        writeSecretKey: secret => kv.put(KV_KEYS.secretKey, secret)
    };
}
