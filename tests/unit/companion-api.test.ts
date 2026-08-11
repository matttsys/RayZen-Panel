import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateIdentityCache } from '@identity';
import { createEnv, createKvStub, validSettingsForm } from '../helpers/worker';
import { TEST_EMAIL, TEST_MAIN_DOMAIN, TEST_SECURE_PATH } from '../setup/globals';

vi.mock('cloudflare:sockets', () => ({
    connect: () => {
        throw new Error('no socket in this suite');
    }
}));

async function router() {
    return (await import('../../src/worker')).default;
}

function deployment() {
    return createKvStub({
        pwd: 'panel-password',
        secretKey: 'd'.repeat(64),
        warpAccounts: [{ privateKey: 'k', publicKey: 'p', warpIPv6: '::1/128', reserved: 'AAAA' }],
        telegramBot: { telegramBotToken: '', telegramUserId: '' },
        proxySettings: { ...validSettingsForm(), cleanIPs: [], panelVersion: VERSION }
    });
}

function url(path: string): string {
    return `https://${TEST_MAIN_DOMAIN}/${TEST_SECURE_PATH}/${path}`;
}

async function json(response: Response) {
    return response.json() as Promise<{
        success: boolean;
        status: number;
        message: string | null;
        body: Record<string, any>;
    }>;
}

beforeEach(() => invalidateIdentityCache());

describe('Companion API contract', () => {
    it('supports discovery, sign-in, status reads, scanner apply, and settings verification', async () => {
        const worker = await router();
        const kv = deployment();
        const env = createEnv(kv.namespace);

        const discoveryResponse = await worker.fetch(new Request(url('panel/version')), env);
        const discovery = await json(discoveryResponse);
        expect(discoveryResponse.status).toBe(200);
        expect(discovery.body).toMatchObject({
            product: 'RayZen Panel',
            version: '1.1.0',
            companionApi: 1,
            capabilities: { authentication: true, scanner: true, scannerApply: true }
        });

        const loginResponse = await worker.fetch(new Request(url('login/authenticate'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: TEST_EMAIL, password: 'panel-password' })
        }), env);
        const login = await json(loginResponse);
        expect(loginResponse.status).toBe(200);
        expect(login.body).toEqual({
            user: { email: TEST_EMAIL },
            panelVersion: '1.1.0',
            expiresIn: 86400
        });

        const cookie = /jwtToken=[^;]*/.exec(loginResponse.headers.get('Set-Cookie') ?? '')?.[0];
        expect(cookie).toBeTruthy();
        const authenticated = (path: string, init: RequestInit = {}) =>
            worker.fetch(new Request(url(path), {
                ...init,
                headers: { Cookie: cookie ?? '', ...init.headers }
            }), env);

        const settings = await json(await authenticated('panel/settings'));
        expect(settings.body.proxySettings.cleanIPs).toEqual([]);

        const usage = await json(await authenticated('panel/usage'));
        expect(usage).toMatchObject({
            success: true,
            body: { available: false, total: null, worker: null }
        });

        const health = await json(await authenticated('panel/platform/health'));
        expect(health.success).toBe(true);
        expect(health.body).toHaveProperty('score');

        const diagnostics = await json(await authenticated('panel/platform/advanced/diagnostics'));
        expect(diagnostics.success).toBe(true);
        expect(diagnostics.body).toHaveProperty('diagnostics');

        const history = await json(await authenticated('panel/platform/scanner/history?kind=clean-ip&limit=1'));
        expect(history).toMatchObject({ success: true, body: { kind: 'clean-ip', runs: [] } });

        const applyResponse = await authenticated('panel/platform/scanner/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: '1.1.1.1' })
        });
        expect(await json(applyResponse)).toMatchObject({
            success: true,
            body: { cleanIPs: ['1.1.1.1'], changed: true }
        });

        const updated = await json(await authenticated('panel/settings'));
        expect(updated.body.proxySettings.cleanIPs).toEqual(['1.1.1.1']);
    });

    it('returns 401 for protected Companion resources without a session', async () => {
        const worker = await router();
        const response = await worker.fetch(
            new Request(url('panel/platform/advanced/diagnostics')),
            createEnv(deployment().namespace)
        );

        expect(response.status).toBe(401);
    });
});
