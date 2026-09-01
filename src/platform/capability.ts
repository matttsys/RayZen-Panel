/**
 * Capability and diagnostics context assembly.
 *
 * Why this is A module and not A method
 *
 * `CapabilityContext` and `DiagnosticsContext` are deliberately plain data: the
 * feature registry and every diagnostic check are pure functions of them, which is
 * what makes them testable without KV, without a request and without settings
 * globals. The cost of that decision is that *someone* has to assemble the data,
 * and if each call site did it there would be four slightly different versions of
 * "does this deployment have a password?".
 *
 * This module is that someone. It is the only place in the codebase that reads live
 * settings and storage in order to answer capability questions, so the answer is
 * consistent across the panel, the diagnostics view and the recommendation list.
 *
 * What it reads and what that costs
 *
 * One KV read for the password and one for the Telegram bot, both of which the
 * panel path already performs, plus in-memory settings. `hasWarpAccounts` is
 * derived from the already-loaded accounts rather than re-read. No network calls:
 * a capability check must never depend on an external service being reachable,
 * because then an unreachable service would look like a missing capability.
 */

import type { KvSettings, PanelSettings } from '#types/settings';
import type { EndpointIntelligence, StatisticsSummary } from '#types/platform';
import type { CapabilityContext } from './features';
import type { DiagnosticsContext } from '@features/diagnostics/service';
import type { Storage } from '@storage';

/** Settings fields the contexts need, in the shape the callers already hold. */
type SettingsLike = Pick<
    KvSettings,
    | 'protocols'
    | 'ports'
    | 'remoteDNS'
    | 'localDNS'
    | 'antiSanctionDNS'
    | 'enableIPv6'
    | 'allowLANConnection'
    | 'logLevel'
    | 'fakeDNS'
    | 'enableECH'
    | 'cleanIPs'
    | 'customCdnAddrs'
    | 'warpEndpoints'
    | 'blockAds'
    | 'blockMalware'
    | 'blockPhishing'
    | 'customBypassRules'
    | 'customBlockRules'
    | 'panelVersion'
    | 'customDomain'
>;

export interface CapabilityInput {
    settings: SettingsLike;
    deployType: string;
    hasKv: boolean;
    hasApiToken: boolean;
    hasPassword: boolean;
    hasTelegramBot: boolean;
    hasWarpAccounts: boolean;
}

/**
 * Splits the comma-joined protocol string the settings shape uses.
 *
 * Filtering empties matters: `''.split(',')` is `['']`, which would make an empty
 * protocol list look like one enabled protocol and turn the
 * `config.protocols-enabled` check into a false pass.
 */
export function protocolList(protocols: string): string[] {
    return protocols
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
}

export function toCapabilityContext(input: CapabilityInput): CapabilityContext {
    return {
        deployType: input.deployType,
        hasPassword: input.hasPassword,
        hasTelegramBot: input.hasTelegramBot,
        hasWarpAccounts: input.hasWarpAccounts,
        hasApiToken: input.hasApiToken,
        hasKv: input.hasKv,
        hasCustomDomain: Boolean(input.settings.customDomain),
        protocols: protocolList(input.settings.protocols)
    };
}

export function toDiagnosticsContext(
    input: CapabilityInput,
    currentVersion: string,
    statistics: StatisticsSummary | null,
    scanner: EndpointIntelligence | null = null
): DiagnosticsContext {
    const { settings } = input;

    return {
        capabilities: toCapabilityContext(input),
        settings: {
            protocols: protocolList(settings.protocols),
            ports: settings.ports,
            remoteDNS: settings.remoteDNS,
            localDNS: settings.localDNS,
            antiSanctionDNS: settings.antiSanctionDNS,
            enableIPv6: settings.enableIPv6,
            allowLANConnection: settings.allowLANConnection,
            logLevel: settings.logLevel,
            fakeDNS: settings.fakeDNS,
            enableECH: settings.enableECH,
            cleanIPs: settings.cleanIPs,
            customCdnAddrs: settings.customCdnAddrs,
            warpEndpoints: settings.warpEndpoints,
            blockAds: settings.blockAds,
            blockMalware: settings.blockMalware,
            blockPhishing: settings.blockPhishing,
            customBypassRules: settings.customBypassRules,
            customBlockRules: settings.customBlockRules,
            panelVersion: settings.panelVersion
        },
        currentVersion,
        statistics,
        scanner
    };
}

/**
 * Reads the two storage-backed capability facts.
 *
 * Kept separate from `toCapabilityContext` so the pure assembly stays pure and so
 * a caller that already knows these facts (the panel settings handler reads both)
 * does not pay for a second read.
 */
export async function readStorageCapabilities(
    storage: Storage
): Promise<{ hasPassword: boolean; hasTelegramBot: boolean }> {
    const [password, bot] = await Promise.all([storage.readPassword(), storage.readTelegramBot()]);

    return {
        hasPassword: Boolean(password),
        // A stored record with an empty token is the shape `getDataset` writes on
        // first run, so presence of the record is not presence of a bot.
        hasTelegramBot: Boolean(bot?.telegramBotToken)
    };
}

/**
 * Narrows a full `PanelSettings` to the subset the contexts read.
 *
 * Explicit rather than a cast: the point of `SettingsLike` is that a check cannot
 * reach a credential, and a cast would quietly hand it the whole object.
 */
export function settingsSubset(settings: PanelSettings): SettingsLike {
    return {
        protocols: settings.protocols,
        ports: settings.ports,
        remoteDNS: settings.remoteDNS,
        localDNS: settings.localDNS,
        antiSanctionDNS: settings.antiSanctionDNS,
        enableIPv6: settings.enableIPv6,
        allowLANConnection: settings.allowLANConnection,
        logLevel: settings.logLevel,
        fakeDNS: settings.fakeDNS,
        enableECH: settings.enableECH,
        cleanIPs: settings.cleanIPs,
        customCdnAddrs: settings.customCdnAddrs,
        warpEndpoints: settings.warpEndpoints,
        blockAds: settings.blockAds,
        blockMalware: settings.blockMalware,
        blockPhishing: settings.blockPhishing,
        customBypassRules: settings.customBypassRules,
        customBlockRules: settings.customBlockRules,
        panelVersion: settings.panelVersion,
        customDomain: settings.customDomain
    };
}
