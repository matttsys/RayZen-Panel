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

describe('Quick Add endpoint lifecycle', () => {
    it('requires authentication to mint', async () => {
        const worker = await router();
        const kv = deployment();
        const env = createEnv(kv.namespace);

        const res = await worker.fetch(new Request(url('panel/quick-add/mint'), {
            method: 'POST'
        }), env);

        expect(res.status).toBe(401);
    });

    it('mints, redeems once, and enforces single-use semantics', async () => {
        const worker = await router();
        const kv = deployment();
        const env = createEnv(kv.namespace);

        // Sign in first
        const loginResponse = await worker.fetch(new Request(url('login/authenticate'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: TEST_EMAIL, password: 'panel-password' })
        }), env);
        const cookie = /jwtToken=[^;]*/.exec(loginResponse.headers.get('Set-Cookie') ?? '')?.[0];
        expect(cookie).toBeTruthy();

        // Mint quick add code
        const mintResponse = await worker.fetch(new Request(url('panel/quick-add/mint'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookie! },
            body: JSON.stringify({ ttl: 600 })
        }), env);
        const mintData = await json(mintResponse);

        expect(mintResponse.status).toBe(200);
        expect(mintData.success).toBe(true);
        expect(mintData.body.code).toMatch(/^rayzen:\/\/v1\//);
        expect(mintData.body.token).toBeDefined();

        const token = mintData.body.token;

        // Redeem the token
        const redeemResponse = await worker.fetch(new Request(url('panel/quick-add/redeem'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        }), env);
        const redeemData = await json(redeemResponse);

        expect(redeemResponse.status).toBe(200);
        expect(redeemData.success).toBe(true);
        expect(redeemData.body.token).toBeDefined();
        expect(redeemData.body.email).toBe(TEST_EMAIL);

        // Second redemption must fail (single-use)
        const replayResponse = await worker.fetch(new Request(url('panel/quick-add/redeem'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        }), env);

        expect(replayResponse.status).toBe(401);
    });

    it('allows operator to revoke a pending token', async () => {
        const worker = await router();
        const kv = deployment();
        const env = createEnv(kv.namespace);

        const loginResponse = await worker.fetch(new Request(url('login/authenticate'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: TEST_EMAIL, password: 'panel-password' })
        }), env);
        const cookie = /jwtToken=[^;]*/.exec(loginResponse.headers.get('Set-Cookie') ?? '')?.[0];

        const mintResponse = await worker.fetch(new Request(url('panel/quick-add/mint'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookie! }
        }), env);
        const mintData = await json(mintResponse);
        const token = mintData.body.token;

        // Revoke
        const revokeResponse = await worker.fetch(new Request(url('panel/quick-add/revoke'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookie! },
            body: JSON.stringify({ token })
        }), env);
        expect(revokeResponse.status).toBe(200);

        // Redemption after revocation must fail
        const redeemResponse = await worker.fetch(new Request(url('panel/quick-add/redeem'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        }), env);
        expect(redeemResponse.status).toBe(401);
    });
});
