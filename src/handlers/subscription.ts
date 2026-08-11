import { getClNormalConfig, getClWarpConfig } from '@cores/clash/configs';
import { getURLConfigs } from '@cores/common';
import { getSbCustomConfig, getSbWarpConfig } from '@cores/sing-box/configs';
import { getXrCustomConfigs, getXrWarpConfigs } from '@cores/xray/configs';
import { getGlobals, getSharedSettings } from '@settings';
import { fallback } from './utils';
import { getWireguardConfigs } from '@cores/wireguard';
import { base64EncodeUtf8, HttpStatus } from '@common';
import { SharedSettings } from '#types/settings';
import { recordUse, resolveProfile, shouldPersistUse, type Profile } from '@features/profiles';
import { createPlatform } from '@platform/context';
import { setSettings } from '@settings-loader';

/**
 * Every branch below returns. The inner client switches previously ended in
 * `default: break`, which left the outer switch to fall through to the next
 * subscription kind, so an unrecognised `?app=` did not produce a 404: it was
 * re-dispatched against every later kind in source order. `sub/raw?app=clash`
 * answered with a *WARP* Clash config, and any unmatched client on any kind
 * eventually reached `share-settings` and exported the deployment's settings
 * document. An unknown client is a client error, so it now takes the same
 * fallback path as an unknown route.
 */
/**
 * Resolves a profile subscription request, or reports why it cannot be served.
 *
 * Returns `null` when the path is not a profile link at all, so the ordinary
 * subscription routes are untouched.
 *
 * The failure answer is deliberately uniform. An unknown token, an expired one and a
 * revoked one all produce the same 404 as any other unmatched path, because a
 * distinguishable response tells whoever holds a revoked link that it was once real, and
 * tells someone guessing tokens when they are close.
 */
async function resolveProfileRequest(
    request: Request,
    env: Env,
    segments: readonly string[]
): Promise<{ profile: Profile; kind: string } | null> {
    // `['', securePath, 'p', token, 'sub', kind]`
    if (segments[2] !== 'p') return null;

    const token = segments[3] ?? '';
    const kind = segments[5] ?? '';
    if (!token || segments[4] !== 'sub' || !kind) return null;

    const platform = createPlatform(env.kv);
    try {
        const stored = await platform.services.get('repositories').profiles.list();
        const { profile } = resolveProfile(stored, token, Date.now());
        if (!profile) return null;

        // The use counter is written at most hourly per profile, so a polling client does
        // not spend the deployment's KV write budget. See src/features/profiles.ts.
        if (shouldPersistUse(profile, Date.now())) {
            const country = requestCountry(request);
            await platform.services.get('repositories').profiles.replace(
                recordUse(stored, token, Date.now(), country)
            );
        }

        return { profile, kind };
    } catch {
        // A storage failure must not serve a subscription to an unauthenticated caller.
        return null;
    } finally {
        await platform.dispose().catch(() => undefined);
    }
}

/**
 * Country of the requesting client, from Cloudflare's own request metadata.
 *
 * A country code and nothing finer. Enough for an operator to notice a link being used
 * somewhere unexpected, without the deployment keeping a record of where its users are, and
 * it costs no outbound request: Cloudflare has already attached it.
 */
function requestCountry(request: Request): string | null {
    const country = (request as { cf?: { country?: unknown } }).cf?.country;
    return typeof country === 'string' && /^[A-Z]{2}$/u.test(country) ? country : null;
}

export async function handleSubscriptions(request: Request, env: Env): Promise<Response> {
    await setSettings(env);
    const { pathname, client } = getGlobals();
    const segments = pathname.split('/');

    /**
     * A profile link serves exactly the same configurations as the ordinary link. Only
     * the authorisation differs, so the profile is resolved here and the path is then
     * treated as `sub/<kind>`: the config builders never learn that profiles exist.
     */
    const viaProfile = await resolveProfileRequest(request, env, segments);
    if (segments[2] === 'p' && !viaProfile) return fallback(request);

    const path = viaProfile ? viaProfile.kind : segments[3];

    switch (path) {
        case 'normal':
            switch (client) {
                case 'xray':
                    return getXrCustomConfigs(false);

                case 'sing-box':
                    return getSbCustomConfig(false);

                case 'clash':
                    return getClNormalConfig();

                default:
                    return fallback(request);
            }

        case 'raw':
            switch (client) {
                case 'xray':
                case 'sing-box':
                    return getURLConfigs();

                default:
                    return fallback(request);
            }

        case 'fragment':
            switch (client) {
                case 'xray':
                    return getXrCustomConfigs(true);

                case 'sing-box':
                    return getSbCustomConfig(true);

                default:
                    return fallback(request);
            }

        case 'warp':
            switch (client) {
                case 'xray':
                    return getXrWarpConfigs(false, false);

                case 'sing-box':
                    return getSbWarpConfig();

                case 'clash':
                    return getClWarpConfig(false);

                case 'wireguard':
                    return getWireguardConfigs(false);

                default:
                    return fallback(request);
            }

        case 'warp-pro':
            switch (client) {
                case 'xray':
                    return getXrWarpConfigs(true, false);

                case 'xray-knocker':
                    return getXrWarpConfigs(true, true);

                case 'clash':
                    return getClWarpConfig(true);

                case 'amnezia':
                    return getWireguardConfigs(true);

                default:
                    return fallback(request);
            }

        case 'share-settings':
            return shareSettings();

        default:
            return fallback(request);
    }
}

async function shareSettings() {
    const sharedSettings: SharedSettings = getSharedSettings();
    // `btoa` throws on any code point above U+00FF, and the settings document
    // carries `remarkSuffix`, whose default is a non-Latin1 glyph. Exporting
    // therefore failed with "btoa() can only operate on characters in the
    // Latin1 range" on a default deployment. The panel's importer reads this
    // with `atob` + `JSON.parse`, which is byte-compatible with the UTF-8
    // encoder used everywhere else in the codebase.
    const body = base64EncodeUtf8(JSON.stringify(sharedSettings));

    return new Response(body, {
        status: HttpStatus.OK,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': `attachment; filename=${_project_SM_}-settings.dat`,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET',
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0'
        }
    });
}
