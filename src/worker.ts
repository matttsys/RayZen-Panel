import { handleDoH } from '@handlers/doh';
import { renderError } from '@handlers/error';
import { handleLogin } from '@handlers/login';
import { handlePanel } from '@handlers/panel';
import { handleProxyIPs } from '@handlers/proxy-ip';
import { handleScan } from '@handlers/scan';
import { generateQRCode } from '@handlers/qrcode';
import { handleSetup } from '@handlers/setup';
import { handleSubscriptions } from '@handlers/subscription';
import { handleTelegram } from '@handlers/telegram';
import { fallback } from '@handlers/utils';
import { handleWebsocket } from '@handlers/websocket';
import { init, getGlobals } from '@settings';
import { withSecurityHeaders, SecurePage } from '@security';
import { flushTraffic, measureRequest } from '@features/analytics/traffic';

export default {
	async fetch(request: Request, env: Env) {
		const response = await route(request, env);

		/**
		 * Traffic counters are batched in isolate memory and written at most once per
		 * flush threshold, never once per request: the free plan's ~1,000 KV writes a
		 * day is a hard budget, not a target. `measureRequest` also wraps the response
		 * body in a counting transform, so the byte totals reflect what was actually
		 * sent rather than a `Content-Length` most streamed responses do not carry.
		 * A failed flush is swallowed inside the module; serving traffic outranks
		 * counting it.
		 */
		const measured = measureRequest(request, response);
		await flushTraffic(env.kv);
		return measured;
	}
}

async function route(request: Request, env: Env): Promise<Response> {
		try {
			await init(request, env);
			if (request.headers.get('Upgrade') === 'websocket') return await handleWebsocket(request);
			const { securePath, pathname, hostname } = getGlobals();
			const path = pathname.split('/').splice(0, 3).join('/');

			/**
			 * The security header set is applied here, once, rather than in each
			 * handler, so a route added later cannot ship without it. `page` selects
			 * the CSP's `connect-src`; see `src/common/security.ts`.
			 */
			const secure = async (page: SecurePage, response: Promise<Response>) =>
				withSecurityHeaders(await response, page, hostname);

			/**
			 * First-run setup, for a deployment that generated its own identity and has
			 * not been claimed yet. `handleSetup` returns null once a password exists,
			 * so a claimed deployment reaches the switch below exactly as it would have
			 * if setup had never existed. See src/handlers/setup.ts.
			 */
			const setup = await handleSetup(request, env);
			if (setup) return withSecurityHeaders(setup, 'setup', hostname);

			/**
			 * Every case below is `await`ed rather than returned as a promise.
			 *
			 * `return somePromise` inside a `try` settles *after* the try block has been
			 * left, so the `catch` never sees a handler rejection: the promise this
			 * function returns rejects instead, and the runtime answers with its own
			 * generic error rather than the page `renderError` exists to produce.
			 * Verified by a rejecting handler in
			 * `tests/unit/security.test.ts`.
			 */
			switch (path) {
				case `/${securePath}/panel`:
					return await secure('panel', handlePanel(request, env));

				case `/${securePath}/login`:
					return await secure('login', handleLogin(request, env));

				case `/${securePath}/sub`:
					return await secure('api', handleSubscriptions(request, env));

				/**
				 * Profile subscription links: `/<path>/p/<token>/sub/<kind>`.
				 *
				 * A separate top-level case because `path` is the first three segments, so
				 * a profile link cannot match `/<path>/sub`. The handler resolves the token
				 * and then treats the request exactly as an ordinary subscription, which is
				 * what keeps the config builders unaware that profiles exist.
				 */
				case `/${securePath}/p`:
					return await secure('api', handleSubscriptions(request, env));

				case `/${securePath}/telegram`:
					return await secure('api', handleTelegram(request, env));

				// The DoH response is a `dns-message` body a client parses, proxied
				// verbatim from the upstream resolver. It is deliberately not given the
				// header set: rewriting a proxied resolver response is how a middlebox
				// behaves.
				case `/${securePath}/dns-query`:
					return await handleDoH(request);

				case `/${securePath}/proxy-ip`:
					return await secure('proxy-ip', handleProxyIPs(request, env));

				/**
				 * The device-side scanner. `scan/frame` is the sandboxed measurement
				 * document and needs the permissive `connect-src` that makes the
				 * measurement possible at all; the two JSON routes under the same
				 * prefix hold no markup, so the same page policy is harmless for them.
				 * See src/common/security.ts and src/handlers/scan.ts.
				 */
				case `/${securePath}/scan`:
					return await secure('probe', handleScan(request, env));

				case `/${securePath}/qrcode`:
					return await secure('api', generateQRCode(request));

				/**
				 * The unmatched-path fallback proxies an unrelated upstream so that a
				 * scanner walking paths sees an ordinary site. It gets neither the header
				 * set nor the error page, both for the same reason: a RayZen-branded
				 * response on a path that is supposed to look uninteresting is precisely
				 * the fingerprint the fallback exists to avoid. A failed upstream fetch
				 * becomes a bare 502.
				 */
				default:
					try {
						return await fallback(request);
					} catch {
						return new Response(null, { status: 502 });
					}
			}
		} catch (error) {
			return renderError(error);
		}
}
