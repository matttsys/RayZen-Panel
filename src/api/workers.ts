import { safeError } from '@common';
import { getGlobals } from '@settings';
import { cloudflareError, type CloudflareDomain, type CloudflareResponse } from '#types/cloudflare';

export async function deployWorkers(script: string) {
    const { accID, apiToken, workerName } = getGlobals();
    const metadata = {
        main_module: 'worker.js',
        keep_bindings: ['kv_namespace'],
        compatibility_date: new Date().toISOString().split('T')[0],
        compatibility_flags: ['nodejs_compat']
    };
    const uploadForm = new FormData();
    uploadForm.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    uploadForm.append('worker.js', new Blob([script], { type: 'application/javascript+module' }), 'worker.js');

    try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accID}/workers/scripts/${workerName}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${apiToken}` },
            body: uploadForm
        });

        const data = await res.json() as CloudflareResponse<unknown>;
        if (!data.success) throw new Error(cloudflareError(data));
    } catch (error) {
        throw new Error(`Failed to deploy worker: ${safeError(error)}`);
    }
}

export async function getWorkerDomains(): Promise<string[]> {
    const { accID, apiToken, workerName } = getGlobals();

    try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accID}/workers/domains?service=${workerName}`, {
            headers: { 'Authorization': `Bearer ${apiToken}` }
        });

        const data = await res.json() as CloudflareResponse<CloudflareDomain[]>;
        if (!data.success) throw new Error(cloudflareError(data));
        return data.result.map(record => record.hostname);
    } catch (error) {
        throw new Error(`Failed to get worker domains: ${safeError(error)}`);
    }
}

export async function setWorkerDomain(domain: string) {
    const { accID, apiToken, workerName } = getGlobals();

    try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accID}/workers/domains`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                hostname: domain,
                service: workerName
            })
        });

        const data = await res.json() as CloudflareResponse<unknown>;
        if (!data.success) throw new Error(cloudflareError(data));
    } catch (error) {
        throw new Error(`Failed to set worker domain: ${safeError(error)}`);
    }
}

export async function deleteWorker() {
    const { accID, apiToken, workerName } = getGlobals();

    try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accID}/workers/scripts/${workerName}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${apiToken}` }
        });

        const data = await res.json() as CloudflareResponse<unknown>;
        if (!data.success) throw new Error(cloudflareError(data));
    } catch (error) {
        throw new Error(`Failed to delete worker: ${safeError(error)}`);
    }
}