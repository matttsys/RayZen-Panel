import { authenticate } from '@auth';
import { HttpStatus, respond } from '@common';
import { getGlobals } from '@settings';
import type { WorkerAnalyticsResponse, WorkerUsageDatum } from '#types/cloudflare';

interface CfUsageResult {
    success: boolean;
    total?: number;
    worker?: number;
    error?: string;
}

export async function getCfWorkerUsage(): Promise<CfUsageResult> {
    const { accID, apiToken, workerName } = getGlobals();

    if (!accID || !apiToken || !workerName) {
        return { success: false, error: 'Cloudflare analytics credentials are not configured.' };
    }

    try {
        const now = new Date();
        const datetimeEnd = now.toISOString();
        const datetimeStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

        const gqlQuery = {
            query: `
                query GetUsage($accountTag: String!, $scriptName: String!, $start: String!, $end: String!) {
                    viewer {
                        accounts(filter: { accountTag: $accountTag }) {
                            total: workersInvocationsAdaptive(
                                limit: 100
                                filter: { datetime_geq: $start, datetime_leq: $end }
                            ) {
                                sum { requests }
                            }
                            worker: workersInvocationsAdaptive(
                                limit: 100
                                filter: { scriptName: $scriptName, datetime_geq: $start, datetime_leq: $end }
                            ) {
                                sum { requests }
                            }
                        }
                    }
                }
            `,
            variables: {
                accountTag: accID,
                scriptName: workerName,
                start: datetimeStart,
                end: datetimeEnd
            }
        };

        const gqlRes = await fetch(`https://api.cloudflare.com/client/v4/graphql?nocache=${Date.now()}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(gqlQuery)
        });

        const gqlData = await gqlRes.json() as WorkerAnalyticsResponse;
        const account = gqlData?.data?.viewer?.accounts?.[0];

        const sumRequests = (data: WorkerUsageDatum[] | undefined): number =>
            (data ?? []).reduce((sum, entry) => sum + (entry?.sum?.requests ?? 0), 0);

        const totalRequests = sumRequests(account?.total);
        const workerRequests = sumRequests(account?.worker);

        return { success: true, total: totalRequests, worker: workerRequests };
    } catch (error) {
        return { success: false, error: 'Error fetching usage data. Check your credentials.' };
    }
}

export async function getUsage(request: Request, env: Env): Promise<Response> {
    const auth = await authenticate(request, env);
    if (!auth) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
    }

    const usage = await getCfWorkerUsage();
    if (!usage.success) {
        return respond(true, HttpStatus.OK, undefined, {
            available: false,
            total: null,
            worker: null
        });
    }

    return respond(true, HttpStatus.OK, undefined, {
        available: true,
        total: usage.total ?? 0,
        worker: usage.worker ?? 0
    });
}
