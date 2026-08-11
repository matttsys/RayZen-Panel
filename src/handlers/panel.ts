import { PanelSettings, TelegramBot } from '#types/settings';
import { deployPages, deletePagesProject } from '@api/pages';
import { getUsage } from '@api/usage';
import { fetchWarpAccounts } from '@api/warp';
import { deployWorkers, deleteWorker } from '@api/workers';
import { resetPassword, logout, authenticate } from '@auth';
import { decompressGzipBase64, respond, HttpStatus, safeError } from '@common';
import { getDataset, updateDataset, updateDatasetDetailed } from '@kv';
import { buildScript, updateMainSettings } from '@main';
import { getGlobals, getMainSettings, subscriptions, clients } from '@settings';
import { validateSettings } from '@validators';
import { fallback } from './utils';
import { setTelegramBot } from '@api/telegram';
import { createStorage } from '@storage';
import { handlePlatform } from '@api/platform';
import { withRecorder } from '@platform/record';
import { edgeLocation, lookupAddresses } from '@api/geo';

export async function handlePanel(request: Request, env: Env): Promise<Response> {
    const { pathname } = getGlobals();
    const parts = pathname.split('/');
    const path = parts.slice(2).join('/');

    // Platform routes live under `panel/platform/` so the original eleven
    // sub-routes keep their exact paths. `handlePlatform` returns null for anything
    // it does not own, so an unknown `panel/platform/*` path still reaches the
    // fallback below rather than 404ing differently from every other path.
    const platformPrefix = 'panel/platform/';
    if (path.startsWith(platformPrefix)) {
        const handled = await handlePlatform(request, env, path.slice(platformPrefix.length));
        if (handled) return handled;
    }

    switch (path) {
        case 'panel':
            return renderPanel(request, env);

        case 'panel/settings':
            return getPanelSettings(request, env);

        case 'panel/update-settings':
            return updatePanelSettings(request, env);

        case 'panel/reset-settings':
            return resetPanelSettings(request, env);

        case 'panel/reset-password':
            return resetPassword(request, env);

        case 'panel/my-ip':
            return getMyIP(request, env);

        case 'panel/update-warp':
            return updateWarpConfigs(request, env);

        case 'panel/update-panel':
            return updatePanel(request, env);

        case 'panel/version':
            return getPanelVersion();

        case 'panel/delete-panel':
            return deletePanel(request, env);

        case 'panel/usage':
            return getUsage(request, env);

        case 'panel/logout':
            return logout();

        default:
            return fallback(request);
    }
}

async function renderPanel(request: Request, env: Env): Promise<Response> {
    const pwd = await createStorage(env.kv).readPassword();
    if (pwd) {
        const auth = await authenticate(request, env);
        if (!auth) {
            const url = new URL('./login', request.url);
            return Response.redirect(url, 302);
        }
    }

    const str = await decompressGzipBase64(PANEL_HTML_CONTENT);
    const html = str.replaceAll('__ICON__', ICON_CONTENT);

    return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
}

function getPanelVersion(): Response {
    return respond(true, HttpStatus.OK, undefined, {
        product: 'RayZen Panel',
        version: VERSION,
        companionApi: 1,
        capabilities: {
            authentication: true,
            health: true,
            diagnostics: true,
            settings: true,
            usage: 'conditional',
            profiles: true,
            scanner: true,
            scannerApply: true
        }
    }, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
    });
}

async function updatePanel(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    try {
        const auth = await authenticate(request, env);
        if (!auth) {
            return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
        }

        const { deployType } = getGlobals();
        const script = await buildScript(true);
        if (deployType === 'pages') {
            await deployPages(script);
        } else {
            await deployWorkers(script);
        }

        // `from` and `to` are the same string here, because a self-update deploys
        // this build's own source: the running version is the version being
        // installed until the new isolate starts. Recorded anyway, because the
        // fact that an update was triggered and when is the useful part.
        await withRecorder(env, platform => {
            platform.events.emit('panel.updated', { from: VERSION, to: VERSION });
        });

        return respond(true, HttpStatus.OK);
    } catch (error) {
        return respond(
            false,
            HttpStatus.INTERNAL_SERVER_ERROR,
            `Error occurred while upgrading panel: ${safeError(error)}`
        );
    }
}

async function deletePanel(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    try {
        const auth = await authenticate(request, env);
        if (!auth) {
            return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
        }

        const { deployType } = getGlobals();
        if (deployType === 'pages') {
            await deletePagesProject();
        } else {
            await deleteWorker();
        }

        return respond(true, HttpStatus.OK);
    } catch (error) {
        return respond(
            false,
            HttpStatus.INTERNAL_SERVER_ERROR,
            `Error occurred while deleting panel: ${safeError(error)}`
        );
    }
}

async function getPanelSettings(request: Request, env: Env): Promise<Response> {
    const isPassSet = Boolean(await createStorage(env.kv).readPassword());

    try {
        const auth = await authenticate(request, env);
        if (!auth) {
            return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.', { isPassSet });
        }

        const { settings: kvSettings, telegramBot } = await getDataset(env);
        const mainSettings = getMainSettings();
        const data = {
            proxySettings: { ...kvSettings, ...mainSettings },
            telegramSettings: telegramBot,
            subscriptions,
            clients,
            isPassSet
        };

        return respond(true, HttpStatus.OK, undefined, data, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
    } catch (error) {
        console.log(error);
        return respond(
            false,
            HttpStatus.INTERNAL_SERVER_ERROR,
            `Error occurred while fetching settings: ${safeError(error)}`
        );
    }
}

async function updatePanelSettings(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'PUT') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    try {
        const auth = await authenticate(request, env);
        if (!auth) {
            return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
        }

        const newSettings: PanelSettings = await request.json();
        const errors = validateSettings(newSettings);
        if (errors) {
            // Published before returning so a deployment being probed with junk
            // settings shows up as a rejection count rather than as silence. The
            // response body is unchanged: the panel UI at
            // src/assets/panel/script.js:565 iterates `body` expecting
            // `{ field, message[] }`, so the legacy shape is the contract.
            await withRecorder(env, platform => {
                platform.events.emit('settings.rejected', { issues: [] });
            });

            return respond(false, HttpStatus.BAD_REQUEST, 'Validation Error', errors);
        }

        const [{ changed }] = await Promise.all([
            updateDatasetDetailed(env, newSettings),
            updateMainSettings(env, newSettings)
        ]);

        const { securePath } = getGlobals();
        let warning = '';

        /**
         * The Telegram webhook carries the panel path, so moving the path orphans it.
         *
         * Two things are deliberate here. The token is checked for content, not just
         * for the record's existence: `getDataset` writes `{ telegramBotToken: '' }`
         * on first read, so every deployment has a bot record and almost none has a
         * bot. Calling `setWebhook` with an empty token asks Telegram for
         * `/bot/setWebhook`, which answers 404, which surfaced as a 500 on the save.
         * Rotating the panel path on a deployment with no bot is the single most
         * ordinary thing an operator does, and it failed.
         *
         * And a failure here no longer fails the save. By this point the settings are
         * written and the path has moved; answering 500 would tell the operator their
         * save failed while their panel had already moved out from under them. The
         * webhook is reported as needing attention instead, which is what it needs.
         */
        if (newSettings.securePath !== securePath) {
            const bot: TelegramBot | null = await createStorage(env.kv).readTelegramBot();
            if (bot?.telegramBotToken) {
                try {
                    await setTelegramBot(newSettings.securePath, bot.telegramBotToken);
                } catch (error) {
                    warning =
                        'Settings saved, but the Telegram webhook could not be moved to the new ' +
                        `panel path: ${safeError(error)} Re-save the bot token to retry.`;
                }
            }
        }

        // After the write, so a failed save records nothing. `changed` is key names
        // only; see `changedKeys` in src/settings/kv.ts for why no value is carried.
        await withRecorder(env, platform => {
            platform.events.emit('settings.updated', { changed, version: VERSION });
        });

        return respond(true, HttpStatus.OK, warning);
    } catch (error) {
        console.log(error);
        return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, safeError(error));
    }
}

async function resetPanelSettings(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed!');
    }

    try {
        const auth = await authenticate(request, env);
        if (!auth) {
            return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
        }

        const [kvSettings, mainSettings] = await Promise.all([
            updateDataset(env),
            updateMainSettings(env, null)
        ]);

        await withRecorder(env, platform => {
            platform.events.emit('settings.reset', { version: VERSION });
        });

        return respond(true, HttpStatus.OK, '', { ...kvSettings, ...mainSettings });
    } catch (error) {
        console.log(error);
        return respond(
            false,
            HttpStatus.INTERNAL_SERVER_ERROR,
            `Error occurred while resetting settings: ${safeError(error)}`
        );
    }
}

async function getMyIP(request: Request, env: Env): Promise<Response> {
    // Route-level auth: the panel page is behind a session, and this route must be
    // too. Without it, anyone who finds the secure path could use the worker as an
    // unauthenticated geo-IP relay (rate-limit abuse) and probe that the path is
    // live. The panel UI only calls this while signed in, so the check changes
    // nothing for a real operator.
    const auth = await authenticate(request, env);
    if (!auth) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
    }

    const ip = (await request.text()).trim();

    // Still validated even though it is no longer interpolated into a URL: the value
    // reaches `lookupAddresses`, which may pass it to an operator-configured endpoint.
    if (ip && !/^[\w:.%[\]-]{1,64}$/.test(ip)) {
        return respond(false, HttpStatus.BAD_REQUEST, 'Invalid IP address.');
    }

    try {
        // An empty body asks about the deployment itself, which Cloudflare can answer
        // directly. A specific address goes through the operator's own endpoint if they
        // configured one, and is otherwise reported as unknown rather than sent to a
        // third party. See src/api/geo.ts.
        const geoLocation = ip
            ? (await lookupAddresses(env, [ip]))[0]
            : await edgeLocation();

        if (!geoLocation) {
            return respond(true, HttpStatus.OK, '', { ip, source: 'unknown' });
        }

        return respond(true, HttpStatus.OK, '', geoLocation);
    } catch (error) {
        console.error('Error resolving IP information:', error);
        return respond(
            false,
            HttpStatus.INTERNAL_SERVER_ERROR,
            `Error resolving IP information: ${safeError(error)}`
        )
    }
}

async function updateWarpConfigs(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');

    try {
        const auth = await authenticate(request, env);
        if (!auth) {
            return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
        }

        const accounts = await fetchWarpAccounts(env);

        await withRecorder(env, platform => {
            platform.events.emit('warp.refreshed', { accounts: accounts.length });
        });

        return respond(true, HttpStatus.OK, 'Warp configs updated successfully!');
    } catch (error) {
        console.log(error);
        return respond(
            false,
            HttpStatus.INTERNAL_SERVER_ERROR,
            `An error occurred while updating Warp configs: ${safeError(error)}`
        );
    }
}
