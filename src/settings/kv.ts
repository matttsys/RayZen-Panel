import { DnsHost, KvSettings, PanelSettings, TelegramBot, WarpAccount } from '#types/settings';
import { extractProxyParams, extractUpstreamParams, getDomain, resolveDNS } from '@utils';
import { fetchWarpAccounts } from '@api/warp';
import { safeError } from '@common';
import { getKvSettings } from '@settings';
import { setCustomDomain } from '@main';
import { createStorage } from '@storage';

export async function getDataset(env: Env): Promise<{
    settings: KvSettings,
    telegramBot: TelegramBot,
    warpAccounts: WarpAccount[]
}> {
    let settings: KvSettings | null, warpAccounts: WarpAccount[] | null;
    const kvSettings = getKvSettings();
    const storage = createStorage(env.kv);

    try {
        settings = await storage.readSettings();
        warpAccounts = await storage.readWarpAccounts();
        if (!settings) {
            await storage.writeSettings(kvSettings);
            settings = kvSettings;
        }

        if (!warpAccounts) {
            warpAccounts = await fetchWarpAccounts(env);
        }

        if (VERSION !== settings.panelVersion) {
            settings = await updateDataset(env);
        }

        let telegramBot: TelegramBot | null = await storage.readTelegramBot();
        if (!telegramBot) {
            telegramBot = { telegramBotToken: '', telegramUserId: '' };
            await storage.writeTelegramBot(telegramBot);
        }

        return {
            settings,
            telegramBot,
            warpAccounts
        };
    } catch (error) {
        console.log(error);
        throw new Error(`An error occurred while getting KV: ${safeError(error)}`);
    }
}

/**
 * Keys whose value differs between two settings snapshots.
 *
 * Exported so the settings-save path can publish `settings.updated` with an honest
 * `changed` list. It returns *key names only*, never values, which is the property
 * the history engine's redaction guarantee depends on: an audit entry may say
 * `vlUUID changed` and must never say what it changed to.
 *
 * Comparison is by JSON form. Every value in `KvSettings` is a scalar, a flat array
 * of scalars, or one of two small records (`remoteDnsHost`, `upstreamParams`), so
 * serialising is both correct and cheaper than a recursive walk. Key order inside
 * those records is stable because both sides are produced by the same code paths.
 */
export function changedKeys(before: KvSettings | null, after: KvSettings): string[] {
    if (!before) return [];

    const changed: string[] = [];

    for (const key of Object.keys(after) as (keyof KvSettings)[]) {
        // `panelVersion` is stamped on every write, so it differs whenever the build
        // differs and would appear in the changed list of a save that changed
        // nothing the user touched.
        if (key === 'panelVersion') continue;

        if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.push(key);
    }

    return changed;
}

/**
 * Writes settings and reports which keys changed.
 *
 * `updateDataset` remains the entry point every existing caller uses and keeps its
 * exact signature and behaviour; this is the same work with the diff surfaced. The
 * diff is free: the merge already reads the current value in order to fall back to
 * it, so no second KV read is performed.
 */
export async function updateDatasetDetailed(
    env: Env,
    newSettings?: Partial<PanelSettings>
): Promise<{ settings: KvSettings; changed: string[] }> {
    const storage = createStorage(env.kv);

    if (!newSettings) {
        const kvSettings = getKvSettings();
        await storage.writeSettings(kvSettings);
        // A reset asserts the defaults wholesale. Reporting every key as changed
        // would be technically true and useless, so a reset publishes no key list
        // and is distinguished by its own event.
        return { settings: kvSettings, changed: [] };
    }

    let currentSettings: KvSettings | null;
    const kvSettings = getKvSettings();

    try {
        currentSettings = await storage.readSettings();
    } catch (error) {
        console.log(error);
        throw new Error(`An error occurred while getting current KV settings: ${safeError(error)}`);
    }

    const getParam = async <T extends keyof KvSettings>(
        key: T,
        cbKey?: T,
        callback?: (value: KvSettings[T]) => any | Promise<any>
    ) => {
        const resolve = (k: T) => newSettings?.[k] ?? currentSettings?.[k] ?? kvSettings[k];

        if (callback && cbKey) {
            const cbValue = resolve(cbKey);
            if (cbValue !== currentSettings?.[cbKey]) {
                return callback(cbValue);
            }
        }

        const value = newSettings?.[key] ?? currentSettings?.[key] ?? kvSettings[key];
        return value;
    };

    const fields: Array<
        [keyof KvSettings] |
        [keyof KvSettings, keyof KvSettings, (key: any) => any | Promise<any>]
    > = [
            ['remoteDNS'],
            ['remoteDnsHost', 'remoteDNS', getDnsParams],
            ['localDNS'],
            ['antiSanctionDNS'],
            ['enableIPv6'],
            ['fakeDNS'],
            ['logLevel'],
            ['clientCompat'],
            ['allowLANConnection'],
            ['customDomain', 'customDomain', setCustomDomain],
            ['upstreamProxy'],
            ['upstreamParams', 'upstreamProxy', extractUpstreamParams],
            ['chainProxy'],
            ['chainProxyParams', 'chainProxy', extractProxyParams],
            ['cleanIPs'],
            ['customCdnAddrs'],
            ['customCdnHost'],
            ['customCdnSni'],
            ['bestPingInterval'],
            ['protocols'],
            ['ports'],
            ['fingerprint'],
            ['enableTFO'],
            ['fragmentMode'],
            ['fragmentLengthMin'],
            ['fragmentLengthMax'],
            ['fragmentDelayMin'],
            ['fragmentDelayMax'],
            ['fragmentMaxSplitMin'],
            ['fragmentMaxSplitMax'],
            ['fragmentPackets'],
            ['enableECH'],
            ['echServerName'],
            ['remarkSeparator'],
            ['remarkSuffix'],
            ['bypassIran'],
            ['bypassChina'],
            ['bypassRussia'],
            ['bypassOpenAi'],
            ['bypassGoogleAi'],
            ['bypassMicrosoft'],
            ['bypassOracle'],
            ['bypassDocker'],
            ['bypassAdobe'],
            ['bypassEpicGames'],
            ['bypassIntel'],
            ['bypassAmd'],
            ['bypassNvidia'],
            ['bypassAsus'],
            ['bypassHp'],
            ['bypassLenovo'],
            ['blockAds'],
            ['blockPorn'],
            ['blockUDP443'],
            ['blockMalware'],
            ['blockPhishing'],
            ['blockCryptominers'],
            ['customBypassRules'],
            ['customBlockRules'],
            ['customBypassSanctionRules'],
            ['warpRemoteDNS'],
            ['warpEndpoints'],
            ['warpBestPingInterval'],
            ['warpReservedBytes'],
            ['xrayUdpNoises'],
            ['knockerNoiseMode'],
            ['knockerNoiseCountMin'],
            ['knockerNoiseCountMax'],
            ['knockerNoiseSizeMin'],
            ['knockerNoiseSizeMax'],
            ['knockerNoiseDelayMin'],
            ['knockerNoiseDelayMax'],
            ['amneziaNoiseCount'],
            ['amneziaNoiseSizeMin'],
            ['amneziaNoiseSizeMax'],
            ['customSubs'],
            ['remoteSettings'],
            ['customConfigs']
        ];

    try {
        const entries = await Promise.all(
            fields.map(async ([key, callbackKey, callbackFunc]) => {
                return [key, await getParam(key, callbackKey, callbackFunc)];
            })
        );

        const updatedSettings: KvSettings = {
            ...Object.fromEntries(entries),
            panelVersion: VERSION
        };

        await storage.writeSettings(updatedSettings);
        return { settings: updatedSettings, changed: changedKeys(currentSettings, updatedSettings) };
    } catch (error) {
        console.log(error);
        throw new Error(`An error occurred while updating KV: ${safeError(error)}`);
    }
}

export async function updateDataset(env: Env, newSettings?: Partial<PanelSettings>): Promise<KvSettings> {
    const { settings } = await updateDatasetDetailed(env, newSettings);
    return settings;
}

async function getDnsParams(dns: string): Promise<DnsHost> {
    const { host, isHostDomain } = getDomain(dns);
    const dohHost: DnsHost = { host, isDomain: isHostDomain, ipv4: [], ipv6: [] };

    if (isHostDomain) {
        const { ipv4, ipv6 } = await resolveDNS(host);
        dohHost.ipv4 = ipv4;
        dohHost.ipv6 = ipv6;
    }

    return dohHost;
}
