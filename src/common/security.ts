/**
 * HTTP security headers, applied centrally at the router.
 *
 * The CSP decision, in writing
 *
 * The choice was nonce versus hash for the panel's inline `<script>` and `<style>`.
 * **Hash, computed at build time, is the decision.** Reasons, in order of weight:
 *
 *  1. A nonce must be unique per response, so it cannot live inside the gzipped HTML blob
 *     that `scripts/build.js` embeds. It would have to be substituted per request. That is
 *     affordable (the handlers already run one `replaceAll` for `__ICON__`), but it puts a
 *     security-critical uniqueness requirement on a code path whose only current job is
 *     cosmetic, and a nonce that repeats is worse than no nonce at all.
 *  2. A hash keeps every page response byte-identical, which keeps the artifact
 *     reproducible. That is load-bearing here because the Worker is also its own
 *     self-update payload (`src/settings/main.ts` `buildScript`).
 *  3. The inline script is produced by the build, not by a request, so its bytes are known
 *     at build time by construction. The hash costs one digest in `scripts/build.js` and
 *     no runtime machinery.
 *
 * Strict hashes
 *
 * Every inline event-handler attribute was removed, so the build can hash the exact
 * minified inline script and style bytes for each page and inject those hashes into the
 * bundle. Neither `script-src` nor `style-src` needs `unsafe-inline`.
 */

/**
 * Pages that get a CSP, and the `connect-src` each one needs.
 *
 * `login`, `proxy-ip`, `error` and `panel` reach nothing off-origin; any new origin
 * must be recorded with a reason in `tests/golden/icon-subset.test.ts` `ORIGIN_BUDGET`.
 *
 * (The version check is same-origin — `./panel/version` — so no release-feed origin
 * is allowlisted.)
 *
 * The `api` entry covers the JSON routes, which are fetched by an already-loaded page and
 * never navigated to; a CSP on them is defence against a content-sniffing client that
 * renders one as a document.
 */
const CONNECT_SRC = {
    panel: "'self'",
    login: "'self'",
    setup: "'self'",
    'proxy-ip': "'self'",
    /**
     * The measurement frame, and the only `connect-src` in the product that is not an
     * allowlist.
     *
     * Measuring edge latency from the operator's own network means connecting to
     * hundreds of bare Cloudflare IP addresses. CSP has no CIDR syntax, and enumerating
     * a thousand addresses produces a ~32 KB header that proxies drop, so `https:` is
     * the only workable value.
     *
     * That is safe *here* and would not be safe on the panel, which is the whole reason
     * this document exists separately. The frame is served into a `sandbox`
     * without `allow-same-origin`, so it runs in an opaque origin and cannot read the
     * panel's DOM, cookies or storage. It holds no settings, no subscription links and
     * no credentials: there is nothing in it to send anywhere. Granting the panel this
     * policy instead would let the page that *does* hold the VLESS UUID and Trojan
     * password post them to any host.
     *
     * The consequence of getting this wrong is not a broken feature but a convincing
     * one: a CSP-blocked fetch rejects immediately, so every address would measure
     * about 0 ms and rank arbitrarily. `src/assets/probe/script.js` runs two control
     * probes before every scan and refuses to report results if they are not clearly
     * separated.
     */
    probe: "https:",
    error: "'none'",
    api: "'none'"
} as const;

export type SecurePage = keyof typeof CONNECT_SRC;

/**
 * `img-src` carries `data:` for the base64 favicon and logo, and `blob:` for the QR code
 * that `script.js` `generateQRCode` builds with `URL.createObjectURL`.
 *
 * `font-src 'none'`: no page loads a font at all. The icon subsets were removed in favour
 * of inline SVG, and the body typeface is a local-font preference, so a directive that
 * allowed anything here would only widen what a future injection could reach.
 */
function contentSecurityPolicy(page: SecurePage): string {
    const hashes = PAGE_CSP_HASHES[page] ?? { script: "'none'", style: "'none'" };
    return [
        'default-src \'none\'',
        `script-src ${hashes.script}`,
        `style-src ${hashes.style}`,
        'img-src \'self\' data: blob:',
        'font-src \'none\'',
        `connect-src ${CONNECT_SRC[page]}`,
        // Only the panel embeds anything, and only its own measurement frame. Every
        // other page keeps `'none'`, so a future page cannot quietly gain the ability
        // to frame something.
        `frame-src ${page === 'panel' ? "'self'" : "'none'"}`,
        'form-action \'self\'',
        'base-uri \'none\'',
        'object-src \'none\'',
        // The measurement frame is the one page meant to be embedded, and only by the
        // panel on the same origin. Everything else stays unframeable: the panel itself
        // must not be, because a framed admin panel is a clickjacking target.
        `frame-ancestors ${page === 'probe' ? "'self'" : "'none'"}`
    ].join('; ');
}

/**
 * Headers that are correct on every response.
 *
 * `X-Frame-Options` duplicates `frame-ancestors` for clients predating CSP level 2.
 * `Referrer-Policy: no-referrer` is the one that matters most in this product: without it,
 * any navigation off the panel puts the deployment's secret admin path into a `Referer`
 * header (blueprint section 3.10). The panel links to GitHub and to the docs site, so that
 * is a live leak rather than a theoretical one.
 */
const BASE_HEADERS: Readonly<Record<string, string>> = {
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    // Overridden to SAMEORIGIN for the measurement frame below. `DENY` here and
    // `frame-ancestors 'self'` there would contradict each other, and the older header
    // wins in browsers that honour both.
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    // Deny the capability groups a settings panel has no use for. Deliberately short: an
    // exhaustive list ages badly as the feature names churn.
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
};

/**
 * Hosts Cloudflare already serves with HSTS. Sending the header for them adds nothing,
 * and `includeSubDomains` on a shared apex the operator does not control is a policy this
 * Worker has no business setting (blueprint section 3.10).
 */
const CLOUDFLARE_SUFFIXES = ['.workers.dev', '.pages.dev'];

/** The security header set for a page, given the request's hostname. */
export function securityHeaders(page: SecurePage, hostname: string): Record<string, string> {
    const headers: Record<string, string> = {
        ...BASE_HEADERS,
        'Content-Security-Policy': contentSecurityPolicy(page)
    };

    const isCloudflareHost = CLOUDFLARE_SUFFIXES.some(suffix => hostname.endsWith(suffix));
    if (hostname && !isCloudflareHost) {
        headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
    }

    // The panel embeds the measurement frame, so this one page has to permit it. Kept
    // to SAMEORIGIN rather than dropped: the frame is only ever loaded by the panel.
    if (page === 'probe') headers['X-Frame-Options'] = 'SAMEORIGIN';

    return headers;
}

/**
 * Apply the header set to a response.
 *
 * Applied at the router rather than in each handler, because a header set that a handler
 * can forget is a header set that a new route will not have (blueprint section 3.10:
 * "applied centrally in the response helper so no handler can forget them"). The wrapper
 * form is used instead of threading the headers through `respond` because
 * `Response.redirect`, the WebSocket upgrade, and the fallback proxy do not go through
 * `respond` at all.
 *
 * Two responses are returned untouched:
 *
 *  - A 101 WebSocket upgrade, because rebuilding it would drop the `webSocket` property
 *    and headers are not delivered to the client on an upgrade anyway.
 *  - A response the handler already gave a CSP, so a future handler can specialise.
 *
 * One header is withheld rather than applied: `Cross-Origin-Resource-Policy` is skipped on
 * a response that sets `Access-Control-Allow-Origin`. `sub/share-settings` is deliberately
 * cross-origin readable, because importing settings from another deployment fetches it
 * (`src/assets/panel/script.js` `fetchSettings`), and a response that opts into CORS while
 * declaring `same-origin` resource policy is self-contradictory.
 *
 * `Cache-Control: no-store` is added only when the handler set none. The panel HTML
 * renders the VLESS UUID, the Trojan password and the subscription URLs, so a disk-cached
 * copy outlives the session; the JSON routes already set their own, stricter value.
 */
export function withSecurityHeaders(
    response: Response,
    page: SecurePage,
    hostname: string
): Response {
    if (response.status === 101 || response.headers.has('Content-Security-Policy')) {
        return response;
    }

    const isCorsEnabled = response.headers.has('Access-Control-Allow-Origin');
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(securityHeaders(page, hostname))) {
        if (isCorsEnabled && name === 'Cross-Origin-Resource-Policy') continue;
        headers.set(name, value);
    }
    if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}
