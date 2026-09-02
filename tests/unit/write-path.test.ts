import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateIdentityCache } from '@identity';
import { createEnv, createKvStub } from '../helpers/worker';
import { TEST_EMAIL, TEST_MAIN_DOMAIN, TEST_SECURE_PATH } from '../setup/globals';

vi.mock('cloudflare:sockets', () => ({
    connect: () => {
        throw new Error('no socket in this suite');
    }
}));

function url(path: string): string {
    return `https://${TEST_MAIN_DOMAIN}/${TEST_SECURE_PATH}/${path}`;
}

beforeEach(() => invalidateIdentityCache());

describe('authenticated write path', () => {
    it('writes succeed after the traffic counter has created the metrics document', async () => {
        const worker = (await import('../../src/worker')).default;
        // A live deployment's `rz:metrics` is first written by the traffic counter, which
        // stores hourly buckets only. Every route that then touches daily counters must
        // still work.
        const kv = createKvStub({
            pwd: 'panel-password',
            secretKey: 'd'.repeat(64),
            warpAccounts: [{ privateKey: 'k', publicKey: 'p', warpIPv6: '::1/128', reserved: 'AAAA' }],
            telegramBot: { telegramBotToken: '', telegramUserId: '' },
            'rz:metrics': { hours: [{ hour: '2026-06-01T00', requests: 3, bytesIn: 10, bytesOut: 20 }] }
        });
        const env = createEnv(kv.namespace);

        const login = await worker.fetch(new Request(url('login/authenticate'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: TEST_EMAIL, password: 'panel-password' })
        }), env);
        expect(login.status).toBe(200);
        const cookie = /jwtToken=[^;]*/.exec(login.headers.get('Set-Cookie') ?? '')?.[0] ?? '';

        const call = (path: string, init: RequestInit = {}) =>
            worker.fetch(new Request(url(path), { ...init, headers: { Cookie: cookie, ...init.headers } }), env);

        const apply = await call('panel/platform/scanner/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ addresses: ['1.1.1.1'], mode: 'replace' })
        });
        expect(apply.status).toBe(200);
        expect(await apply.json()).toMatchObject({
            success: true,
            status: 200,
            body: { accepted: 1, cleanIPs: ['1.1.1.1'] }
        });

        const put = await call('panel/platform/clean-ips', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cleanIPs: ['1.0.0.1'] })
        });
        expect(put.status).toBe(200);
        expect(await put.json()).toMatchObject({ success: true, body: { cleanIPs: ['1.0.0.1'] } });

        const metrics = await call('panel/platform/metrics');
        expect(metrics.status).toBe(200);
        expect(await metrics.json()).toMatchObject({ success: true });
    });
});
