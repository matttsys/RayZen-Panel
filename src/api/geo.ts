/**
 * Geo-location for addresses the operator has configured.
 *
 * Why this module exists rather than a direct `fetch`
 *
 * The proxy-IP page and the My IP page both want "where is this address, and whose
 * network is it". Both used to ask `ip-api.com` directly, which had three problems worth
 * naming:
 *
 *   1. **It is an undeclared third party.** The panel's own CSP allowlists every origin
 *      the *browser* touches, and the docs list them, but these calls are made by the
 *      Worker and so appeared in neither. An operator auditing where their deployment
 *      talks had no way to find them.
 *   2. **It sends the operator's endpoints to a stranger.** The batch call posts up to
 *      100 configured proxy addresses at a time. That is a list of the exact hosts this
 *      deployment routes traffic through, handed to a service with no relationship to
 *      the operator, from the Worker's own IP.
 *   3. **The batch endpoint was plain HTTP.** `http://ip-api.com/batch`, because the
 *      free tier does not serve HTTPS. So that list also travelled in clear text.
 *
 * What replaced it
 *
 * Cloudflare already tells a Worker where a connection came from. For an address the
 * deployment itself connects to, `cdn-cgi/trace` on a Cloudflare-fronted host reports
 * the colo and country of the edge that answered. That covers the case this feature is
 * actually for, which is "is my proxy IP somewhere sensible", without introducing a
 * third party at all.
 *
 * For addresses Cloudflare cannot describe, the honest answer is that the panel does not
 * know. A missing city is better than a leaked endpoint list, and the page says so.
 *
 * The escape hatch
 *
 * `RAYZEN_GEO_ENDPOINT` lets an operator point this at a service they trust or run.
 * Absent, no third party is contacted. That is the default because a privacy tool whose
 * defaults call an unrelated API is not one.
 */
import { getGlobals } from '@settings';

export interface GeoResult {
    ip: string;
    city?: string;
    country?: string;
    countryCode?: string;
    isp?: string;
    /** How this was determined, so the UI never implies more precision than it has. */
    source: 'cloudflare-edge' | 'operator-endpoint' | 'unknown';
}

/** Parsed `cdn-cgi/trace` body: `key=value` per line. */
function parseTrace(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of text.split('\n')) {
        const index = line.indexOf('=');
        if (index > 0) out[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
    return out;
}

/**
 * Cloudflare's own view of where the deployment sits.
 *
 * One request, to Cloudflare, revealing nothing the operator's Worker has not already
 * told Cloudflare by existing. Used for the My IP panel, which is asking about the
 * deployment rather than about a third-party address.
 */
export async function edgeLocation(): Promise<GeoResult | null> {
    const { hostname } = getGlobals();

    try {
        const response = await fetch(`https://${hostname}/cdn-cgi/trace`, {
            headers: { 'User-Agent': 'RayZen' }
        });
        if (!response.ok) return null;

        const trace = parseTrace(await response.text());
        if (!trace.ip) return null;

        return {
            ip: trace.ip,
            // `colo` is the three-letter airport code of the answering datacentre, which
            // is a more honest statement of location than a city guessed from an IP.
            city: trace.colo,
            countryCode: trace.loc,
            country: trace.loc,
            source: 'cloudflare-edge'
        };
    } catch {
        return null;
    }
}

/**
 * Looks addresses up through an operator-configured endpoint, or reports them as unknown.
 *
 * The response shape accepted is deliberately the widely-used one (`query`, `city`,
 * `country`, `countryCode`, `isp`, `status`), so an operator who wants this can point it
 * at any compatible service, including a self-hosted one, without a code change.
 */
export async function lookupAddresses(env: Env, addresses: readonly string[]): Promise<GeoResult[]> {
    const unknown = (): GeoResult[] => addresses.map(ip => ({ ip, source: 'unknown' as const }));

    const endpoint = (env.RAYZEN_GEO_ENDPOINT ?? '').trim();
    if (!endpoint || !addresses.length) return unknown();

    // https only. The previous implementation used a plain-HTTP batch endpoint, which put
    // the operator's endpoint list on the wire in clear text.
    let url: URL;
    try {
        url = new URL(endpoint);
        if (url.protocol !== 'https:') return unknown();
    } catch {
        return unknown();
    }

    // Bounded: 100 per request and 200 in total, so a long proxy list cannot turn one
    // page load into a dozen outbound calls.
    const capped = addresses.slice(0, 200);
    const chunks: string[][] = [];
    for (let index = 0; index < capped.length; index += 100) {
        chunks.push(capped.slice(index, index + 100));
    }

    const results: GeoResult[] = [];
    try {
        for (const chunk of chunks) {
            const response = await fetch(url.href, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(chunk)
            });
            if (!response.ok) return unknown();

            const payload: unknown = await response.json();
            if (!Array.isArray(payload)) return unknown();

            for (const entry of payload) {
                if (!entry || typeof entry !== 'object') continue;
                const row = entry as Record<string, unknown>;
                const ip = typeof row.query === 'string' ? row.query : '';
                if (!ip) continue;
                results.push({
                    ip,
                    city: typeof row.city === 'string' ? row.city : undefined,
                    country: typeof row.country === 'string' ? row.country : undefined,
                    countryCode: typeof row.countryCode === 'string' ? row.countryCode : undefined,
                    isp: typeof row.isp === 'string' ? row.isp : undefined,
                    source: 'operator-endpoint'
                });
            }
        }
    } catch {
        return unknown();
    }

    // Anything the endpoint did not answer for is reported as unknown rather than omitted,
    // so the table still lists every configured address.
    const answered = new Set(results.map(result => result.ip));
    for (const ip of capped) {
        if (!answered.has(ip)) results.push({ ip, source: 'unknown' });
    }
    return results;
}
