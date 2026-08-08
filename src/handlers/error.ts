import { decompressGzipBase64, safeError } from '@common';
import { securityHeaders } from '@security';

export async function renderError(error: unknown): Promise<Response> {
    const str = await decompressGzipBase64(ERROR_HTML_CONTENT);
    const html = str
        .replace('__ERROR_MESSAGE__', safeError(error))
        .replaceAll('__ICON__', ICON_CONTENT);

    /**
     * This page renders from the router's `catch`, which also catches failures thrown by
     * `init()` itself, so it is the one response that cannot go through the router's
     * per-route wrapper: the request-scoped globals may not exist yet. The header set is
     * applied here instead.
     *
     * `hostname` is passed empty for the same reason, which suppresses HSTS. An error page
     * is not where a host should be committed to a year of HSTS, and every other response
     * on an operator domain carries it anyway.
     */
    return new Response(html, {
        status: 500,
        headers: {
            ...securityHeaders('error', ''),
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store'
        }
    });
}
