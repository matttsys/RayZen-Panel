import { HttpStatus, respond, safeError } from '@common';
import { clients, getGlobals, subscriptions } from '@settings';
import { getCfWorkerUsage } from './usage';
import { assistantSnapshot, type AssistantSnapshot } from './platform';
import { authenticate } from '@auth';
import { TelegramBot } from '#types/settings';
import { createStorage } from '@storage';
import type { TelegramResponse } from '#types/cloudflare';
import { handleSettingsCommand } from './telegram-commands';

export async function setupTelegramWebhook(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'PUT') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    try {
        const auth = await authenticate(request, env);
        if (!auth) {
            return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
        }

        const { telegramBotToken, telegramUserId } = await request.json() as Partial<TelegramBot>;
        const botToken = telegramBotToken?.trim();
        const userID = telegramUserId?.trim();

        if (!botToken || !userID) {
            return respond(false, HttpStatus.BAD_REQUEST, 'Missing bot info.');
        }

        const { securePath } = getGlobals();
        await setTelegramBot(securePath, botToken);

        const bot: TelegramBot = {
            telegramBotToken: botToken,
            telegramUserId: userID
        };

        await createStorage(env.kv).writeTelegramBot(bot);
        return respond(true, HttpStatus.OK, 'Telegram bot setup completed successfully!', bot);
    } catch (error) {
        return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Error occurred while setting Telegram Bot: ${safeError(error)}`);
    }
}

export async function setTelegramBot(path: string, token: string) {
    const { origin } = getGlobals();
    const webhookUrl = new URL(`/${path}/telegram/webhook`, origin);
    const api = new URL(`https://api.telegram.org/bot${token}/setWebhook`);
    api.searchParams.set('url', webhookUrl.href);

    try {
        const res = await fetch(api);
        const data = await res.json() as TelegramResponse;
        if (!data.ok) {
            throw new Error(data.description || 'Failed to set webhook.');
        }

        const commRes = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                commands: [
                    { command: 'start', description: 'Open the RayZen assistant' },
                    { command: 'status', description: 'Health score, endpoint and next actions' },
                    { command: 'endpoint', description: 'Best endpoint, score and confidence' },
                    { command: 'diagnostics', description: 'Problems, impact and the fix' },
                    { command: 'subscription', description: 'Subscription links for your clients' },
                    { command: 'config', description: 'Get configs' },
                    { command: 'clients', description: 'Get supported clients' },
                    { command: 'usage', description: 'Monitor Cloudflare usage' },
                    { command: 'listips', description: 'List proxy IPs' },
                    { command: 'addip', description: 'Add a proxy IP: /addip 1.2.3.4' },
                    { command: 'removeip', description: 'Remove a proxy IP by value or number' },
                    { command: 'listdomains', description: 'List clean IPs and domains' },
                    { command: 'adddomain', description: 'Add a clean IP or domain' },
                    { command: 'removedomain', description: 'Remove a clean IP or domain' },
                ]
            })
        });

        const commData = await commRes.json() as TelegramResponse;
        if (!commData.ok) {
            throw new Error(commData.description || 'Failed to set bot commands.');
        }
    } catch (error) {
        throw new Error(safeError(error));
    }
}

export async function removeTelegramBot(request: Request, env: Env) {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    try {
        const auth = await authenticate(request, env);
        if (!auth) {
            return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
        }

        const storage = createStorage(env.kv);
        const { telegramBotToken } = (await storage.readTelegramBot()) ?? { telegramBotToken: '' };
        const res = await fetch(`https://api.telegram.org/bot${telegramBotToken}/deleteWebhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                drop_pending_updates: true
            })
        });

        const data = await res.json() as { ok: boolean; description?: string };
        if (!res.ok || !data.ok) {
            throw new Error(data.description || `Failed with status ${res.status}`);
        }

        const bot: TelegramBot = { telegramBotToken: '', telegramUserId: '' };
        await storage.writeTelegramBot(bot);

        return respond(true, HttpStatus.OK, 'Telegram bot webhook deleted successfully!', bot);
    } catch (error) {
        return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Error occurred while removing Telegram bot: ${safeError(error)}`);
    }
}

interface TgUser {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
}

interface TgMessage {
    message_id: number;
    from: TgUser;
    chat: { id: number; type: string };
    text?: string;
}

interface TgCallbackQuery {
    id: string;
    from: TgUser;
    message?: { message_id: number; chat: { id: number } };
    data?: string;
}

interface TgUpdate {
    update_id: number;
    message?: TgMessage;
    callback_query?: TgCallbackQuery;
}

function mainKeyboard() {
    return {
        inline_keyboard: [
            [{ text: 'Status', callback_data: 'status' }, { text: 'Endpoint', callback_data: 'endpoint' }],
            [{ text: 'Diagnostics', callback_data: 'diagnostics' }, { text: 'Subscription', callback_data: 'sub' }],
            [{ text: 'Supported clients', callback_data: 'clients' }, { text: 'Usage', callback_data: 'usage' }],
        ]
    };
}

function subKeyboard() {
    const subs = Object.entries(subscriptions).map(([type, category]) => [{
        text: `🔗 ${category.label}`,
        callback_data: `sub_${type}`
    }]);

    return {
        inline_keyboard: [
            ...subs,
            [{ text: '◀️ Back', callback_data: 'main' }]
        ]
    };
}

function usageKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🔄 Refresh', callback_data: 'usage_refresh' }],
            [{ text: '◀️ Back', callback_data: 'main' }]
        ]
    };
}

function clientsKeyboard() {
    const suppClients = clients.map(client => [{
        text: `🟢 ${client.name}`,
        callback_data: `client_${client.name}`
    }]);

    return {
        inline_keyboard: [
            ...suppClients,
            [{ text: '◀️ Back', callback_data: 'main' }]
        ]
    };
}

async function tgFetch(token: string, method: string, body: unknown): Promise<TelegramResponse> {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return res.json() as Promise<TelegramResponse>;
}

function buildUsageText(totalUsage: number, panelUsage: number): string {
    const panelReqPct = Math.ceil(Number(panelUsage) / 100000 * 100);
    const totalReqPct = Math.ceil(Number(totalUsage) / 100000 * 100);
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    let text = [
        '📊 <b>Cloudflare Workers Usage</b>',
        `━━━━━━━━━━━━━━━━`,
        `📅 Today: ${today}`,
        '',
        `🔵 <b>${_project_} requests</b>`,
        `${panelUsage} / 100,000 (${panelReqPct}%)`,
        '',
        '🔵 <b>Total requests</b>',
        `${totalUsage} / 100,000 (${totalReqPct}%)`,
        '',
        ''
    ].join('\n');

    if (totalReqPct > 80) {
        text += '🔴 <b>WARNING:</b> Approaching limit!\n';
    } else {
        text += '✅ All within limits';
    }

    return text;
}

function buildSubUrl(type: string, app: string): URL {
    const { securePath, origin } = getGlobals();

    const url = new URL(`/${securePath}/sub/${type}`, origin);
    url.searchParams.set('app', app);

    return url;
}

function buildClientUrl(type: string, app: string, label: string): string {
    const url = buildSubUrl(type, app);

    if (app === 'sing-box' && type !== 'raw') {
        const singUrl = new URL('sing-box://import-remote-profile');
        singUrl.searchParams.set('url', url.href);
        singUrl.hash = `💮 ${_project_} ${label}`;

        return singUrl.href;
    }

    url.hash = `💮 ${_project_} ${label}`;
    return url.href;
}

function buildQrUrl(type: string, app: string, label: string): string {
    const { securePath, origin } = getGlobals();
    const url = buildClientUrl(type, app, label);

    const qrUrl = new URL(`/${securePath}/qrcode`, origin);
    qrUrl.searchParams.set('data', url);
    qrUrl.searchParams.set('nocache', Date.now().toString());

    return qrUrl.href;
}

function buildDocUrl(type: string, app: string): string | null {
    if (type === 'raw') return null;

    const url = buildSubUrl(type, app);
    const docUrl = new URL(url);

    const configApp = app.replace('xray-knocker', 'mahsang');
    const baseType = `${type}-${configApp}`;
    const isWg = ['wireguard', 'amnezia'].includes(app);

    const configType = isWg ? `${baseType}-conf` : baseType;
    const ext = isWg ? 'zip' : 'json';

    docUrl.pathname = `${url.pathname}/${_project_SM_}-${configType}.${ext}`;
    docUrl.searchParams.set('nocache', Date.now().toString());

    return docUrl.href;
}

/* ------------------------------------------------------------------ *
 * RayZen assistant
 *
 * The bot used to be a download link with a menu. These four commands make it
 * the second surface of the panel: same numbers, same wording, no secrets.
 *
 * Every one of them runs *after* the webhook has matched the sender against the
 * stored `telegramUserId`, so the owner-only rule is unchanged and enforced in
 * exactly one place.
 * ------------------------------------------------------------------ */

function statusEmoji(status: string): string {
    if (status === 'critical') return '⛔';
    if (status === 'attention') return '⚠️';
    if (status === 'unknown') return '❓';
    return '✅';
}

function assistantKeyboard() {
    return {
        inline_keyboard: [
            [{ text: 'Endpoint', callback_data: 'endpoint' }, { text: 'Diagnostics', callback_data: 'diagnostics' }],
            [{ text: 'Refresh', callback_data: 'status' }, { text: '◀️ Back', callback_data: 'main' }]
        ]
    };
}

/** `/status`: one screen. Score, endpoint, and what to do next. */
function buildStatusText(snapshot: AssistantSnapshot): string {
    const { center, endpoint } = snapshot;
    const score = center.score === null ? '—' : `${center.score}/100`;
    const lines = [
        `${statusEmoji(center.status)} <b>${center.headline}</b>`,
        `Health score: <b>${score}</b>`,
        ''
    ];

    lines.push(
        endpoint.address
            ? `• Endpoint: <code>${endpoint.address}</code>${endpoint.score === null ? '' : ` · ${Math.round(endpoint.score)}`}${endpoint.trend ? ` · ${endpoint.trend}` : ''}`
            : '• Endpoint: no scan recorded yet'
    );
    lines.push(`• Deployment: ${snapshot.preflightReady ? 'ready' : 'incomplete'}`);

    if (center.nextActions.length > 0) {
        lines.push('', '<b>Next actions</b>');
        center.nextActions.forEach(action => lines.push(`→ ${action}`));
    } else {
        lines.push('', 'Nothing needs your attention.');
    }

    lines.push('', `<i>RayZen v${snapshot.version}</i>`);
    return lines.join('\n');
}

/** `/endpoint`: the recommendation and the evidence behind it. */
function buildEndpointText(snapshot: AssistantSnapshot): string {
    const { endpoint } = snapshot;
    if (!endpoint.address) {
        return ['ℹ️ <b>No endpoint measured yet</b>', '', 'Run a Clean IP scan from the panel and this will fill in.'].join('\n');
    }

    return [
        '<b>Best endpoint</b>',
        `<code>${endpoint.address}</code>`,
        '',
        `Score: <b>${endpoint.score === null ? '—' : Math.round(endpoint.score)}</b>`,
        `Confidence: <b>${endpoint.confidence === null ? '—' : `${endpoint.confidence}%`}</b>`,
        `Trend: <b>${endpoint.trend ?? 'unknown'}</b>`,
        '',
        `Why: ${endpoint.reason ?? 'Ranked highest across the retained bounded scans.'}`
    ].join('\n');
}

/** `/diagnostics`: problem, impact, solution. Nothing that passed. */
function buildDiagnosticsText(snapshot: AssistantSnapshot): string {
    if (snapshot.findings.length === 0) {
        return ['✅ <b>No problems found</b>', '', 'Every weighted check passed on this run.'].join('\n');
    }

    const lines = [`⚠️ <b>${snapshot.findings.length} item(s) need review</b>`];

    snapshot.findings.forEach(finding => {
        lines.push(
            '',
            `${finding.status === 'fail' ? '⛔' : '⚠️'} <b>${finding.title}</b>`,
            `Impact: ${finding.detail}`,
            `Fix: ${finding.remediation ?? 'Open Diagnostics in the panel for the guided fix.'}`
        );
    });

    return lines.join('\n');
}

/** `/subscription`: what the links are, before the QR codes are sent. */
function buildSubscriptionText(): string {
    const available = Object.values(subscriptions).map(category => `• ${category.label}`).join('\n');
    return [
        '<b>Subscriptions</b>',
        '',
        'Pick a type below. RayZen replies with the link, a QR code and the client file.',
        '',
        available,
        '',
        '<i>Links are personal. Do not forward them.</i>'
    ].join('\n');
}

async function sendAssistant(
    token: string,
    chatId: number,
    env: Env,
    build: (snapshot: AssistantSnapshot) => string
): Promise<void> {
    let text: string;

    try {
        text = build(await assistantSnapshot(env));
    } catch {
        // A failed read must not look like a healthy system.
        text = '⚠️ RayZen could not read its own state on this request. Try again in a moment.';
    }

    await tgFetch(token, 'sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: assistantKeyboard()
    });
}

/**
 * Proactive alerts.
 *
 * Two rules keep this from becoming spam, which is the failure mode of every
 * status bot: only *changes* are announced, and the fingerprint of the last
 * announcement is stored so an unchanged condition is silent no matter how many
 * times the webhook fires.
 */
async function checkAssistantAlerts(token: string, chatId: number, env: Env): Promise<void> {
    if (!env.kv) return;

    let snapshot: AssistantSnapshot;
    try {
        snapshot = await assistantSnapshot(env);
    } catch {
        return;
    }

    const alerts: string[] = [];
    const { center, endpoint } = snapshot;

    if (endpoint.trend === 'degrading') {
        alerts.push(`⚠️ Endpoint quality is degrading${endpoint.address ? ` on <code>${endpoint.address}</code>` : ''}. Run /endpoint for the evidence.`);
    }

    const failing = snapshot.findings.filter(finding => finding.status === 'fail');
    if (failing.length > 0) {
        alerts.push(`⛔ ${failing.length} diagnostic check(s) are failing: ${failing.map(finding => finding.title).join(', ')}. Run /diagnostics.`);
    }

    if (!snapshot.preflightReady) {
        alerts.push('⚠️ Configuration is incomplete: the deployment preflight is not passing.');
    }

    if (alerts.length === 0) {
        await env.kv.put('rz-alert-state', '', { expirationTtl: 60 * 60 * 24 * 7 }).catch(() => undefined);
        return;
    }

    const fingerprint = `${center.status}|${alerts.join('~')}`;
    const previous = await env.kv.get('rz-alert-state').catch(() => null);
    if (previous === fingerprint) return;

    await tgFetch(token, 'sendMessage', {
        chat_id: chatId,
        text: ['<b>RayZen alert</b>', '', ...alerts].join('\n'),
        parse_mode: 'HTML',
        reply_markup: assistantKeyboard()
    });

    await env.kv.put('rz-alert-state', fingerprint, { expirationTtl: 60 * 60 * 24 * 7 }).catch(() => undefined);
}

async function handleCallback(cq: TgCallbackQuery, token: string, chatId: number, env: Env): Promise<void> {
    const data = cq.data || '';

    switch (data) {
        case 'status':
            await sendAssistant(token, chatId, env, buildStatusText);
            break;

        case 'endpoint':
            await sendAssistant(token, chatId, env, buildEndpointText);
            break;

        case 'diagnostics':
            await sendAssistant(token, chatId, env, buildDiagnosticsText);
            break;

        case 'sub':
            await tgFetch(token, 'sendMessage', {
                chat_id: chatId,
                text: buildSubscriptionText(),
                parse_mode: 'HTML',
                reply_markup: subKeyboard()
            });
            break;

        case 'clients':
            await tgFetch(token, 'sendMessage', {
                chat_id: chatId,
                text: '📱 <b>Supported clients</b>\n\nChoose a client:',
                parse_mode: 'HTML',
                reply_markup: clientsKeyboard()
            });
            break;

        case 'usage':
        case 'usage_refresh':
            const result = await getCfWorkerUsage();
            if (!result) {
                await tgFetch(token, 'sendMessage', {
                    chat_id: chatId,
                    text: '⚠️ Could not fetch usage data.',
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [[{ text: '◀️ Back', callback_data: 'main' }]] }
                });
                break;
            }

            if (!result.success) {
                await tgFetch(token, 'sendMessage', {
                    chat_id: chatId,
                    text: result.error,
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [[{ text: '◀️ Back', callback_data: 'main' }]] }
                });
                break;
            }

            if (!result.total || !result.worker) break;
            const text = buildUsageText(result.total, result.worker);
            if (data === 'usage_refresh' && cq.message?.message_id) {
                await tgFetch(token, 'editMessageText', {
                    chat_id: chatId,
                    message_id: cq.message.message_id,
                    text: text,
                    parse_mode: 'HTML',
                    reply_markup: usageKeyboard()
                });
            } else {
                await tgFetch(token, 'sendMessage', {
                    chat_id: chatId,
                    text: text,
                    parse_mode: 'HTML',
                    reply_markup: usageKeyboard()
                });
            }
            break;

        default:
            const typeKey = data.split('_')[1];
            if (data.startsWith('sub_')) {
                const subscription = subscriptions[typeKey];
                if (!subscription) break;

                for (const [index, appInfo] of subscription.categories.entries()) {
                    const clientUrl = buildClientUrl(typeKey, appInfo.core, subscription.label);
                    const qrUrl = buildQrUrl(typeKey, appInfo.core, subscription.label);
                    const docUrl = buildDocUrl(typeKey, appInfo.core);
                    const wgClient = ['wireguard', 'amnezia'].includes(appInfo.core);

                    const supportedList = appInfo.clients.map(a => `✅ ${a}`).join('\n');
                    const showUrl = wgClient ? '' : `<code>${clientUrl}</code>\n\n`;
                    const caption = `💮 <b>${_project_} ${subscription.label}</b>\n\n${showUrl}<b>Supported apps:</b>\n\n${supportedList}`;

                    const isLast = index === subscription.categories.length - 1;
                    const backBtn = {
                        reply_markup: {
                            inline_keyboard: [[{ text: '◀️ Back', callback_data: 'sub' }]]
                        }
                    };

                    if (wgClient) {
                        await tgFetch(token, 'sendDocument', {
                            chat_id: chatId,
                            document: docUrl,
                            caption: caption,
                            parse_mode: 'HTML',
                            ...(isLast && backBtn)
                        });
                    } else {
                        const hasDocument = typeKey !== 'raw';

                        await tgFetch(token, 'sendPhoto', {
                            chat_id: chatId,
                            photo: qrUrl,
                            caption: caption,
                            parse_mode: 'HTML',
                            ...(isLast && !hasDocument && backBtn)
                        });

                        if (hasDocument) {
                            await tgFetch(token, 'sendDocument', {
                                chat_id: chatId,
                                document: docUrl,
                                ...(isLast && backBtn)
                            });
                        }
                    }
                }
            }

            if (data.startsWith('client_')) {
                const client = clients.find(cli => cli.name === typeKey);
                if (!client) break;
                let text = [
                    `✅ <b>${client.name}</b>`,
                    `━━━━━━━━━━━━━━━━`,
                    `📍 <b>Minimum requirement:</b> ${client.minVer}`,
                    `🏚️ <b>Download source:</b> ${client.source}`,
                    '',
                    `📥 <a href=\"${atob(client.b64Url)}\"><b>Get latest version</b></a>`,
                    ''
                ].join('\n');

                await tgFetch(token, 'sendMessage', {
                    chat_id: chatId,
                    text: text,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[{ text: '◀️ Back', callback_data: 'clients' }]]
                    }
                });
            }
    }
}

export async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
    const tgBot: TelegramBot | null = await createStorage(env.kv).readTelegramBot();
    if (!tgBot) return new Response(null, { status: 200 });

    const { telegramBotToken: botToken, telegramUserId: userId } = tgBot;
    if (!botToken || !userId) return new Response(null, { status: 200 });

    const update: TgUpdate = await request.json();

    if (update.callback_query) {
        const cq = update.callback_query;
        if (cq.from.id.toString() !== userId) return new Response(null, { status: 200 });

        await tgFetch(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });

        const chatId = cq.message?.chat.id;
        if (!chatId) return new Response(null, { status: 200 });

        const data = cq.data || '';

        if (data === 'main') {
            await tgFetch(botToken, 'sendMessage', {
                chat_id: chatId,
                text: `🤖 <b>${_project_} Panel Bot</b>\n\nChoose an option:`,
                parse_mode: 'HTML',
                reply_markup: mainKeyboard()
            });
        } else {
            await handleCallback(cq, botToken, chatId, env);
        }

        checkCfUsageWarning(botToken, chatId);
        await checkAssistantAlerts(botToken, chatId, env);
        return new Response(null, { status: 200 });
    }

    if (update.message) {
        if (update.message.from.id.toString() !== userId) return new Response(null, { status: 200 });

        const chatId = update.message.chat.id;
        const text = update.message.text || '';

        switch (text) {
            case '/status':
                await sendAssistant(botToken, chatId, env, buildStatusText);
                break;

            case '/endpoint':
                await sendAssistant(botToken, chatId, env, buildEndpointText);
                break;

            case '/diagnostics':
                await sendAssistant(botToken, chatId, env, buildDiagnosticsText);
                break;

            case '/subscription':
                await tgFetch(botToken, 'sendMessage', {
                    chat_id: chatId,
                    text: buildSubscriptionText(),
                    parse_mode: 'HTML',
                    reply_markup: subKeyboard()
                });
                break;

            case '/usage':
                const result = await getCfWorkerUsage();
                if (!result.success || !result.worker || !result.total) break;
                await tgFetch(botToken, 'sendMessage', {
                    chat_id: chatId,
                    text: buildUsageText(result.total, result.worker),
                    parse_mode: 'HTML',
                    reply_markup: usageKeyboard()
                });
                break;

            case '/clients':
                await tgFetch(botToken, 'sendMessage', {
                    chat_id: chatId,
                    text: '📱 <b>Supported clients</b>\n\nChoose a client:',
                    parse_mode: 'HTML',
                    reply_markup: clientsKeyboard()
                });
                break;

            case '/config':
                await tgFetch(botToken, 'sendMessage', {
                    chat_id: chatId,
                    text: '🔗 <b>Get Config</b>\n\nChoose a configuration type:',
                    parse_mode: 'HTML',
                    reply_markup: subKeyboard()
                });
                break;

            default: {
                /**
                 * Settings commands, which take arguments and so cannot be matched by the
                 * switch above. Tried before the fallback keyboard, so an unrecognised
                 * message still gets the menu.
                 *
                 * These write settings, which is why they live in their own module with
                 * their own validation: see src/api/telegram-commands.ts.
                 */
                const settingsResult = await handleSettingsCommand(env, text);
                if (settingsResult) {
                    await tgFetch(botToken, 'sendMessage', {
                        chat_id: chatId,
                        text: settingsResult.text,
                        parse_mode: 'HTML'
                    });
                    break;
                }

                await tgFetch(botToken, 'sendMessage', {
                    chat_id: chatId,
                    text: `🤖 <b>${_project_} Panel Bot</b>\n\nChoose an option:`,
                    parse_mode: 'HTML',
                    reply_markup: mainKeyboard()
                });
                break;
            }
        }

        checkCfUsageWarning(botToken, chatId);
        await checkAssistantAlerts(botToken, chatId, env);
        return new Response(null, { status: 200 });
    }

    return new Response(null, { status: 200 });
}

async function checkCfUsageWarning(botToken: string, chatId: number): Promise<void> {
    const result = await getCfWorkerUsage();
    if (!result.success || !result.worker || !result.total) return;

    const nearLimit = result.total / 100000 * 100 > 80;
    if (nearLimit) {
        await tgFetch(botToken, 'sendMessage', {
            chat_id: chatId,
            text: buildUsageText(result.total, result.worker),
            parse_mode: 'HTML',
            reply_markup: usageKeyboard()
        });
    }
}