import { safeError } from '@common';
import { getGlobals } from '@settings';
import { cloudflareError, type CloudflareResponse, type CloudflareZone } from '#types/cloudflare';

export async function listZones() {
    const { apiToken } = getGlobals();

    try {
        const res = await fetch('https://api.cloudflare.com/client/v4/zones', {
            headers: {
                'Authorization': `Bearer ${apiToken}`
            }
        });

        const data = await res.json() as CloudflareResponse<CloudflareZone[]>;
        if (!data.success) throw new Error(cloudflareError(data));
        return data.result;
    } catch (error) {
        throw new Error(`Failed to list account DNS zones: ${safeError(error)}`);
    }
}

export async function createCNAME(zoneID: string, domain: string) {
    const { apiToken, workerName } = getGlobals();

    try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneID}/dns_records`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: domain,
                ttl: 1,
                type: 'CNAME',
                comment: `${_project_} Panel`,
                content: workerName,
                proxied: true
            })
        });

        const data = await res.json() as CloudflareResponse<unknown>;
        if (!data.success) throw new Error(cloudflareError(data));
    } catch (error) {
        throw new Error(`Failed to create DNS record: ${safeError(error)}`);
    }
}

