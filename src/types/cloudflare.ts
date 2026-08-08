/**
 * Shared types for the Cloudflare REST API responses this Worker consumes.
 *
 * Every Cloudflare API call in `src/api/` previously did
 * `const data: any = await res.json()` and then reached into `data.result[...]`.
 * That is 20+ untyped boundaries where a shape change from Cloudflare, or a typo
 * in a property name, produces `undefined` at runtime rather than an error at
 * compile time.
 *
 * These types cover only the fields RayZen actually reads. They are deliberately
 * not a complete model of the Cloudflare API: an incomplete accurate type is more
 * useful than a complete guessed one.
 *
 * Reference: https://developers.cloudflare.com/api/
 */

/** The envelope every Cloudflare v4 API response uses. */
export interface CloudflareResponse<T = unknown> {
    success: boolean;
    errors?: { code?: number; message?: string }[];
    messages?: { code?: number; message?: string }[];
    result: T;
}

/** A DNS zone, from GET /zones. Only the fields used to match a custom domain. */
export interface CloudflareZone {
    id: string;
    name: string;
}

/** A Workers or Pages custom domain entry. */
export interface CloudflareDomain {
    hostname: string;
}

/** A Pages deployment, from POST /pages/projects/:name/deployments. */
export interface CloudflarePagesDeployment {
    id?: string;
    url?: string;
}

/**
 * One day of GraphQL analytics for a Worker script.
 *
 * Shape comes from the `workersInvocationsAdaptive` dataset, grouped by date.
 */
export interface WorkerUsageDatum {
    dimensions?: { date?: string };
    sum?: { requests?: number };
}

/**
 * The nested GraphQL analytics envelope.
 *
 * `total` and `worker` are GraphQL field aliases chosen by the query in
 * `src/api/usage.ts`, not Cloudflare field names, so they are typed here to match
 * that query specifically.
 */
export interface WorkerAnalyticsResponse {
    data?: {
        viewer?: {
            accounts?: {
                total?: WorkerUsageDatum[];
                worker?: WorkerUsageDatum[];
            }[];
        };
    };
    errors?: { message?: string }[];
}

/** A Telegram Bot API response envelope. */
export interface TelegramResponse<T = unknown> {
    ok: boolean;
    description?: string;
    result?: T;
}

/** A DoH JSON answer record, from a `application/dns-json` query. */
export interface DohAnswer {
    name?: string;
    /** RR type: 1 = A, 28 = AAAA. */
    type: number;
    TTL?: number;
    data: string;
}

/** A DoH JSON response. */
export interface DohResponse {
    Status?: number;
    Answer?: DohAnswer[];
}

/**
 * Extracts the first error message from a Cloudflare response, falling back to a
 * serialised form when the shape is unexpected.
 *
 * Centralised because every API wrapper needs it and each previously inlined a
 * slightly different optional-chain expression.
 */
export function cloudflareError(response: CloudflareResponse<unknown>): string {
    const first = response.errors?.[0]?.message;
    if (first) return first;
    if (response.errors?.length) return JSON.stringify(response.errors);
    return 'Unknown Cloudflare API error';
}
