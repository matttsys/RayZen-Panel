import { EmbededSettings, MainSettings, PanelSettings } from '#types/settings';
import { deployPages, getPagesDomains, setPagesDomain } from '@api/pages';
import { deployWorkers, getWorkerDomains, setWorkerDomain } from '@api/workers';
import { getGlobals, getMainSettings, getSettings } from '@settings';
import { persistIdentitySettings } from '@identity';
import { createCNAME, listZones } from '@api/dns';
import { decompressGzipBase64, safeError } from '@common';
import type { CloudflareZone } from '#types/cloudflare';

/**
 * Writes the half of the settings that lives outside the KV settings document: the
 * VLESS UUID, the Trojan password, the panel path, and the proxy-IP configuration.
 *
 * Where they go depends on where this deployment's identity came from
 * (`src/settings/identity.ts`):
 *
 *   - `kv`: one `kv.put`. The deployment reads its identity from KV on every cold
 *     start, so the next request already sees the new values. Nothing is uploaded and
 *     no Cloudflare API token is needed, which is what makes the Deploy to Cloudflare
 *     flow work with no credentials at all.
 *   - `embedded`: the values live inside the running script, so changing them means
 *     rebuilding and re-uploading it. That is the original behaviour and it needs an
 *     account id and an API token.
 *
 * The return value is the effective identity, which the panel echoes back to the UI.
 */
export async function updateMainSettings(
    env: Env,
    newSettings: PanelSettings | null
): Promise<Partial<EmbededSettings>> {
    const { accID, accEmail, apiToken, mainDomain, vlUUID, trPass, securePath, source } = getGlobals();

    const settings: EmbededSettings = {
        accID,
        accEmail,
        vlUUID: newSettings ? newSettings.vlUUID : vlUUID,
        trPass: newSettings ? newSettings.trPass : trPass,
        securePath: newSettings ? newSettings.securePath : securePath,
        proxyIpMode: newSettings ? newSettings.proxyIpMode : 'proxyip',
        proxyIPs: newSettings ? newSettings.proxyIPs : [],
        prefixes: newSettings ? newSettings.prefixes : [],
        mainDomain,
        fallback: newSettings ? newSettings.fallback : '',
        dohUrl: newSettings ? newSettings.dohUrl : ''
    };

    if (newSettings && compareMainSettings(settings)) return {};

    if (source === 'kv') {
        try {
            await persistIdentitySettings(env, {
                vlUUID: settings.vlUUID,
                trPass: settings.trPass,
                securePath: settings.securePath,
                proxyIpMode: settings.proxyIpMode,
                proxyIPs: settings.proxyIPs,
                prefixes: settings.prefixes,
                fallback: settings.fallback,
                dohUrl: settings.dohUrl
            });
        } catch (error) {
            throw new Error(`Failed to save identity settings: ${safeError(error)}`);
        }

        return settings;
    }

    if (!accID || !apiToken) {
        throw new Error(
            'These settings are baked into the deployed script, so saving them requires a ' +
            'redeploy, and this deployment has no Cloudflare account id or API token to do ' +
            'it with. Bind RAYZEN_CF_ACCOUNT_ID and the RAYZEN_CF_API_TOKEN secret, or redeploy ' +
            'with the Deploy to Cloudflare button, which stores these settings in KV instead.'
        );
    }

    try {
        const script = await buildScript(false, settings);
        const { deployType } = getSettings();

        if (deployType === 'pages') {
            await deployPages(script);
        } else {
            await deployWorkers(script);
        }

        return settings;
    } catch (error) {
        throw new Error(`An error occurred while updating the deployment: ${safeError(error)}`);
    }
}

function compareMainSettings(settings: MainSettings): boolean {
    const mainSettings = getMainSettings();
    const keys = Object.keys(mainSettings) as Array<keyof MainSettings>;

    return keys.every(key => {
        const currentValue = mainSettings[key];
        const settingValue = settings[key];
        if (Array.isArray(currentValue) && Array.isArray(settingValue)) {
            return currentValue.join(',') === settingValue.join(',');
        }

        return currentValue === settingValue;
    });
}

export async function setCustomDomain(customDomain: string) {
    if (!customDomain) return;
    const { deployType, apiToken } = getGlobals();

    if (!apiToken) {
        throw new Error(
            'Attaching a custom domain needs a Cloudflare API token with Workers Scripts ' +
            'edit permission, and this deployment has none. Add the domain in the ' +
            'Cloudflare dashboard under Workers & Pages, your Worker, Settings, Domains & ' +
            'Routes instead.'
        );
    }

    try {
        const tld = customDomain.split('.').slice(-2).join('.');
        const dnsZones = await listZones();
        const zone = dnsZones?.find((z: CloudflareZone) => z.name === tld);
        if (!zone) throw new Error(`Specified domain ${tld} is not registered on your Cloudflare account.`);
        const zoneID = zone.id;
        const customDomains = deployType === 'workers'
            ? await getWorkerDomains()
            : await getPagesDomains();

        if (customDomains.includes(customDomain)) {
            throw new Error(`Custom domain '${customDomain}' is already added to ${deployType}.`);
        }

        if (deployType === 'pages') {
            await setPagesDomain(customDomain);
            await createCNAME(zoneID, customDomain);
        } else {
            await setWorkerDomain(customDomain);
        }

        return customDomain;
    } catch (error) {
        throw new Error(`Failed to set Custom Domain: ${safeError(error)}`);
    }
}

/**
 * Rebuilds this deployment's Worker script: the current build's code plus the current
 * identity block.
 *
 * Why there is no remote fetch here
 *
 * The upgrade branch used to fetch `worker.js` from the upstream project's latest
 * release and upload it. That replaced a RayZen deployment with a different project
 * on a single POST, using the deployment's own API token, and every RayZen-only route
 * went with it. Recovering needed a `wrangler deploy`, which a panel-only user does
 * not have.
 *
 * `SOURCE_CONTENT` is this build's own gzipped source, embedded by scripts/build.js.
 * So `update-panel` redeploys the running build with a freshly assembled identity
 * block. That is still a real repair operation (it restores a Worker whose metadata or
 * bindings drifted) and it can no longer install another project.
 *
 * A genuine upgrade path belongs here, with a pinned version and a hash check, once
 * there is a signed release feed to pin to. Until then the panel's version check
 * fails closed and leaves the Update button disabled, so nothing advertises an
 * upgrade that does not exist. Deployments made with the Deploy to Cloudflare button
 * upgrade through git instead: Cloudflare rebuilds on push.
 */
export async function buildScript(upgradePanel: boolean, settings?: MainSettings): Promise<string> {
    const script = await decompressGzipBase64(SOURCE_CONTENT);
    settings ??= getSettings();

    const { accID, accEmail, mainDomain } = getGlobals();
    const embededSettings = {
        accID,
        accEmail,
        vlUUID: settings.vlUUID,
        trPass: settings.trPass,
        securePath: settings.securePath,
        proxyIpMode: settings.proxyIpMode,
        proxyIPs: settings.proxyIPs,
        prefixes: settings.prefixes,
        fallback: settings.fallback,
        dohUrl: settings.dohUrl,
        mainDomain
    };

    /**
     * Every embedded asset the redeployed script needs in its prelude.
     *
     * This list has to stay complete, and nothing about the code makes that obvious: a
     * page missing here still compiles, still passes every unit test, and produces a
     * Worker whose route serves `undefined` at runtime. `PROBE_HTML_CONTENT` was left out
     * when the measurement frame was added, which would have given anyone using the
     * panel's self-repair redeploy a deployment whose scanner reported "the measurement
     * frame did not load".
     *
     * `tests/unit/self-deploy.test.ts` now asserts this list against the globals the
     * build defines, so the next omission fails the suite instead of a deployment.
     */
    const embededContents = {
        SOURCE_CONTENT,
        PANEL_HTML_CONTENT,
        LOGIN_HTML_CONTENT,
        SETUP_HTML_CONTENT,
        ERROR_HTML_CONTENT,
        PROXY_IP_HTML_CONTENT,
        PROBE_HTML_CONTENT,
        ICON_CONTENT
    };

    const embeded = upgradePanel
        ? { EMBEDED_SETTINGS: embededSettings }
        : { ...embededContents, EMBEDED_SETTINGS: embededSettings };

    const buildTimestamp = new Date().toISOString();
    const padding = padCode();
    const worker = [
        `// RayZen Panel build`,
        `// Build: ${buildTimestamp}`,
        '// @ts-nocheck',
        `${padding}Object.assign(globalThis, ${JSON.stringify(embeded)});${script}`
    ].join('\n');

    return worker;
}

/**
 * Prepends a block of unreachable declarations to the uploaded script.
 *
 * Signature resistance, not dead weight: two deployments of the same build otherwise
 * upload byte-identical scripts, which is a fingerprint. Deliberately not removed as
 * a size optimisation; see perf-baseline.json.
 */
function padCode() {
    const minVars = 50, maxVars = 500;
    const minFuncs = 50, maxFuncs = 500;

    const varCount = Math.floor(Math.random() * (maxVars - minVars + 1)) + minVars;
    const funcCount = Math.floor(Math.random() * (maxFuncs - minFuncs + 1)) + minFuncs;

    const padVars = Array.from({ length: varCount }, (_, i) => {
        const varName = `__padd_${Math.random().toString(36).substring(2, 10)}_${i}`;
        const value = Math.floor(Math.random() * 100000);
        return `let ${varName} = ${value};`;
    }).join('\n');

    const padFuncs = Array.from({ length: funcCount }, (_, i) => {
        const funcName = `__paddFunc_${Math.random().toString(36).substring(2, 10)}_${i}`;
        return `function ${funcName}() { return ${Math.floor(Math.random() * 1000)}; }`;
    }).join('\n');

    return `${padVars}\n${padFuncs}\n`;
}
