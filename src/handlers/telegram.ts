import { handleTelegramWebhook, removeTelegramBot, setupTelegramWebhook } from '@api/telegram';
import { getGlobals } from '@settings';
import { fallback } from './utils';
import { setSettings } from '@settings-loader';

export async function handleTelegram(request: Request, env: Env): Promise<Response> {
    await setSettings(env);
    const { pathname } = getGlobals();
    const path = pathname.split('/')[3];

    switch (path) {
        case 'setup':
            return setupTelegramWebhook(request, env);
        
        case 'remove':
            return removeTelegramBot(request, env);

        case 'webhook':
            return handleTelegramWebhook(request, env);

        default:
            return fallback(request);
    }
}