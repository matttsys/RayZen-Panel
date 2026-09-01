import { safeError } from '@common';
import { getGlobals } from '@settings';
import { cloudflareError, type CloudflareDomain, type CloudflarePagesDeployment, type CloudflareResponse } from '#types/cloudflare';

export async function deployPages(script: string) {
    const { accID, apiToken, workerName } = getGlobals();
    const uploadForm = new FormData();
    uploadForm.append('manifest', '{}');
    uploadForm.append(
        '_worker.js',
        new Blob([script], { type: 'application/javascript' }),
        '_worker.js'
    );

    try {
        const deployRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accID}/pages/projects/${workerName}/deployments`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiToken}` },
            body: uploadForm
        });

        const deployData = await deployRes.json() as CloudflareResponse<CloudflarePagesDeployment>;
        if (!deployData.success) throw new Error(cloudflareError(deployData));
    } catch (error) {
        throw new Error(`Failed to create Pages deployment: ${safeError(error)}`);
    }
}

export async function getPagesDomains(): Promise<string[]> {
    const { accID, apiToken, workerName } = getGlobals();

    try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accID}/pages/projects/${workerName}/domains`, {
            headers: { 'Authorization': `Bearer ${apiToken}` }
        });

        const data = await res.json() as CloudflareResponse<CloudflareDomain[]>;
        if (!data.success) throw new Error(cloudflareError(data));
        return data.result.map(record => record.hostname);
    } catch (error) {
        throw new Error(`Failed to get Pages project domains: ${safeError(error)}`);
    }
}

export async function setPagesDomain(domain: string) {
    const { accID, apiToken, workerName } = getGlobals();

    try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accID}/pages/projects/${workerName}/domains`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: domain
            })
        });

        const data = await res.json() as CloudflareResponse<unknown>;
        if (!data.success) throw new Error(cloudflareError(data));
    } catch (error) {
        throw new Error(`Failed to set Pages project domain: ${safeError(error)}`);
    }
}

export async function deletePagesProject() {
    const { accID, apiToken, workerName } = getGlobals();

    try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accID}/pages/projects/${workerName}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${apiToken}` }
        });

        const data = await res.json() as CloudflareResponse<unknown>;
        if (!data.success) throw new Error(cloudflareError(data));
    } catch (error) {
        throw new Error(`Failed to delete pages project: ${safeError(error)}`);
    }
}