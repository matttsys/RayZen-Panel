# Architecture

How RayZen Panel is put together, and why the parts that look odd are the way they
are. This describes what is in `src/` today, not a plan.

## The shape of it

One Cloudflare Worker. No VPS, no container, no database, no build output to serve.
The panel UI, the login page, the setup page, the icon font and the favicon are all
compiled into the same file as the routing and protocol logic, so a deployment is
literally one script plus one KV namespace.

```
                        ┌──────────────────────────────┐
   VPN client ────────▶ │   Cloudflare Worker (edge)   │
   (v2rayNG, sing-box,  │                              │
    Clash, WireGuard…)  │  VLESS / Trojan / WARP relay │──────▶ Internet
                        │  DoH resolver                │
                        │  Subscription generator      │
                        │  Panel UI (embedded)         │
                        └──────────────┬───────────────┘
                                       │ Cloudflare KV
                                       ▼
                          identity, settings, password,
                          WARP keys, metrics, history
```

That single-file property is load-bearing rather than tidy: the Worker carries its own
gzipped source in `SOURCE_CONTENT`, so the panel can redeploy itself without fetching
anything from the internet.

## Source layout

| Path | Responsibility |
| --- | --- |
| `src/worker.ts` | Worker entry point, top-level router, and the single place security headers are applied. |
| `src/settings/identity.ts` | Where a deployment's identity comes from: embedded block, environment, or KV. |
| `src/settings/settings.ts` | Request-scoped globals, the KV settings defaults, and the client/subscription catalogue. |
| `src/settings/kv.ts` | The settings merge table: reads KV, applies a submitted form, writes back. |
| `src/settings/main.ts` | Persisting identity changes, custom domains, and assembling a self-redeploy script. |
| `src/settings/validators.ts` | Every settings validator, one function per field group. |
| `src/handlers/` | Route handlers: panel, login, setup, subscriptions, Telegram, DoH, proxy IP, QR, WebSocket, fallback. |
| `src/protocols/` | VLESS and Trojan over WebSocket, using `cloudflare:sockets`. |
| `src/cores/` | Config generation for Xray, sing-box, Clash/Mihomo, WireGuard, WARP, DNS and routing. |
| `src/storage/` | The only module that knows the inherited KV key names. |
| `src/features/` | Panel feature services: scanner, diagnostics, health, history, analytics, backup, presets, recommendations, migration, validation, optimisation, deployment. |
| `src/platform/` | Request context, capability detection, event recording, metrics repositories. |
| `src/api/` | Cloudflare API, Telegram API, WARP accounts, DNS, Pages, Workers, usage. |
| `src/auth/` | Session issuing and verification, and password reset. |
| `src/common/` | Shared helpers, the HTTP status enum, and the CSP/header construction. |
| `src/assets/` | The embedded pages: panel, login, setup, error, proxy IP, plus the icon subsets and favicon. |
| `scripts/build.js` | The build: bundle, minify, compress, embed. |
| `scripts/package-worker.js` | Optional: bakes a fixed identity into `dist/worker.deploy.js`. |
| `scripts/preview.js` | Runs the built Worker locally against an in-memory KV. |

## Deployment identity

This is the part worth reading closely, because it is what makes the same committed
repository deployable by anyone.

A deployment needs a hostname, a panel path, a VLESS UUID, a Trojan password and a
sign-in email before it can serve anything. Cloudflare's Deploy button knows none of
them: it clones the repo, runs the build, and runs `wrangler deploy`. The hostname
depends on the Worker name the user picks and their account subdomain, and nobody can
invent their password for them.

So `src/settings/identity.ts` resolves the identity per request, from three sources in
this order:

1. **`EMBEDED_SETTINGS`**, when the running script carries it. That means a packaged
   artifact or a self-redeploy. Its values win, so an existing deployment upgrading to
   this build keeps the exact panel path and credentials it has already handed out.
2. **Worker environment variables**, for anything the operator chose to pin. Each one
   overrides a single field, so you can fix the panel path and leave the rest generated.
3. **The KV document `rz:identity`**, generated on the first request when absent.

The hostname is never persisted. It is read from the request, because that is the only
place it is reliably true: a Worker reachable on both `x.workers.dev` and
`panel.example.com` should generate configs for whichever one the client asked for.

The Cloudflare account id and API token are read from the environment and never
written to KV. A token in KV is a token in every settings export and every backup.

Resolution is cached for the life of the isolate, so the relay path costs no KV read
per connection, and the bootstrap writes exactly once rather than once per cold start.

### First-run setup

A deployment that generated its own identity has a random 24-character panel path
nobody can guess. `src/handlers/setup.ts` serves a page at `/` that reveals it, once,
and takes the administrator's email and password. The moment a password exists, that
route returns `null` and `/` behaves exactly as it does on any other deployment: the
fallback proxy answers, and nothing confirms that a setup page ever existed.

The window between deploying and claiming is real, and `SECURITY.md` says so.
`RAYZEN_ADMIN_EMAIL` can pin the administrator address before the first-run claim, so
a claim using another address cannot produce a usable administrator account.

## Build

`npm run build` runs `scripts/build.js`:

1. Finds every `src/assets/**/index.html`.
2. Substitutes `__VERSION__` from `package.json`.
3. Inlines that page's CSS and JavaScript, minifying the JavaScript with terser.
4. Substitutes the self-hosted icon font as a base64 data URI, failing loudly if the
   placeholder is left unresolved: a silently unresolved one ships a page whose icons
   all render as literal words.
5. Minifies the HTML, then hashes the resulting inline script and style bytes for the
   page's CSP.
6. Gzips each page and stores it as base64.
7. Bundles `src/worker.ts` with esbuild, keeping `cloudflare:sockets` and `node:crypto`
   external because the runtime provides them.
8. Minifies the bundle, gzips it into `SOURCE_CONTENT`, and writes `dist/worker.js`
   with everything assigned to `globalThis` in a prelude.

The build is byte-reproducible: every input is committed, the gzip level is fixed, and
CI asserts two consecutive builds are identical. That property is what makes the
self-update payload comparable between two deployments of the same commit.

## Request flow

`src/worker.ts` is the whole router.

1. `init(request, env)` resolves the identity and populates the request-scoped globals.
2. A WebSocket upgrade goes straight to `handleWebsocket`, before anything else.
3. First-run setup gets a look at the path, and answers only on an unclaimed
   bootstrap deployment.
4. Everything else is routed on the first three path segments, which always include
   the secret path.

| Route | Handler | Purpose |
| --- | --- | --- |
| `/{securePath}/panel` | `handlePanel` | Panel UI and its API. |
| `/{securePath}/login` | `handleLogin` | Login page and session issuing. |
| `/{securePath}/sub` | `handleSubscriptions` | Subscription and config generation. |
| `/{securePath}/telegram` | `handleTelegram` | Telegram bot webhook and actions. |
| `/{securePath}/dns-query` | `handleDoH` | DNS-over-HTTPS resolver. |
| `/{securePath}/proxy-ip` | `handleProxyIPs` | Proxy IP listing and testing. |
| `/{securePath}/qrcode` | `generateQRCode` | QR PNG for panel and bot links. |
| `/setup`, `/setup/claim` | `handleSetup` | First run only, then gone. |
| anything else | `fallback` | Proxies a configured upstream, or a bare 404. |

WebSocket relay paths are matched before the panel routes:

| Prefix | Handler |
| --- | --- |
| `/vl` | `VlOverWSHandler` |
| `/tr` | `TrOverWSHandler` |

Two responses deliberately do not get the security header set: the DoH response,
because rewriting a proxied resolver reply is what a middlebox does, and the
unmatched-path fallback, because a RayZen-branded header set on a path meant to look
uninteresting is exactly the fingerprint the fallback exists to avoid.

## Storage

Cloudflare KV, one namespace per deployment, bound to the variable name `kv`.

| Key | Purpose |
| --- | --- |
| `proxySettings` | Panel settings, migrated when `panelVersion` changes. |
| `warpAccounts` | WARP account material for WARP and WireGuard configs. |
| `telegramBot` | Bot token and authorised user id. |
| `pwd` | Salted administrator password verifier (legacy plaintext values migrate on successful login). |
| `secretKey` | Session signing secret, generated on first login. |
| `rz:identity` | This deployment's identity, on a bootstrap deployment. |
| `rz:metrics` | Rolling per-day counters. |
| `rz:history` | Bounded audit log, newest first. |
| `rz:scanner` | Scan run summaries and schedule state. |

The first five names are inherited verbatim from BPB Worker Panel and are a compatibility contract:
renaming one orphans an existing deployment's data silently. They are defined once, in
`KV_KEYS`, and pinned by a test. Everything RayZen added is prefixed `rz:`, so an
operator listing the namespace can tell at a glance which keys predate RayZen.

The free plan allows 100,000 KV reads a day but only 1,000 writes, and that ratio
dictates the shape of the platform repositories: one key per concern rather than one
per record, every list bounded at write time, and a flush-once-per-request model so
ten counter bumps cost one write.

## Authentication

`src/auth/jwt.ts` is a dependency-free HS256 implementation. The session token is
stored in a `jwtToken` cookie with `HttpOnly`, `Secure` and `SameSite=Strict`, and the
signing secret is generated per deployment and stored in KV.

The token's subject is the Cloudflare account id when the deployment has one, and the
sign-in email otherwise. Neither is a secret and neither carries authority on its own:
the signature does, verified against the per-deployment key.

## Config generation

`src/handlers/subscription.ts` loads settings and dispatches on the subscription
variant and the requested client. Variants: `normal`, `raw`, `fragment`, `warp`,
`warp-pro`, plus `share-settings` for panel-to-panel import.

Generators live under `src/cores/xray/`, `src/cores/sing-box/`, `src/cores/clash/`,
`src/cores/wireguard.ts` and `src/cores/common.ts`. Outputs include JSON configs, raw
URI subscriptions, WireGuard and Amnezia ZIP archives, profile titles, filenames and
QR payloads.

Every generator is pinned by golden fixtures under `tests/fixtures/golden/`: 14 targets
across 12 profiles, 88 applicable cells. A change to a generated byte is a change to a
committed file, which is the point.

## Deploying and updating

Three paths, one artifact:

- **Deploy to Cloudflare button.** Cloudflare clones the repo, provisions the KV
  namespace declared in `wrangler.jsonc`, builds, and deploys. The deployment
  bootstraps its identity on the first request. Updates come through git: Cloudflare
  rebuilds on push.
- **`wrangler deploy`.** The same config, the same artifact, the same runtime
  resolution.
- **`npm run package` plus wrangler.** Bakes a fixed identity into
  `dist/worker.deploy.js`. Needed for reproducing an existing deployment exactly, or
  for a deploy where first-run setup cannot be reached. Settings that live in that
  block then need a redeploy to change, which needs a Cloudflare API token.

The panel's own self-update redeploys **this build's own** source, read from
`SOURCE_CONTENT`, rather than fetching a release from anywhere. It is a repair
operation: it restores a Worker whose bindings or metadata drifted. The Update button
stays disabled because there is no signed release feed to pin to, so nothing
advertises an upgrade path that does not exist.

## What the panel pages talk to

Nothing, with one exception. Fonts, icons and scripts are embedded, the version check
is same-origin, and each page's CSP `connect-src` lists only what it actually uses.
The exception is the panel's "My IP" feature, which the user initiates and which
reaches two IP-echo services. A test enforces that list as a ratchet: it can shrink,
not grow.

| Service | Used for |
| --- | --- |
| Cloudflare Workers runtime | Executing everything. |
| Cloudflare KV | All persistence. |
| Cloudflare account API | Self-update, custom domains, usage stats. Optional. |
| Telegram Bot API | Webhook registration and bot replies. Optional. |
| `api.cloudflareclient.com` | WARP account registration, when WARP is used. |

## Things that look strange and are not

- **`padCode()`** prepends hundreds of unreachable declarations to an uploaded script.
  Without it, two deployments of the same build upload byte-identical scripts, which
  is a fingerprint. It is deliberate signature resistance, not dead weight, and
  `perf-baseline.json` says so where a size optimiser would look.
- **`no_bundle: true`** in `wrangler.jsonc`. Letting wrangler re-bundle inflated the
  upload by 56 KB of esbuild `__name` wrappers, and meant the deployed script was not
  the artifact the size budget measured.
- **The subscription URL shape** `/{securePath}/sub/{variant}?app={core}` is fixed.
  Client imports in the wild depend on it.
- **The `kv` binding name** is lowercase and cannot change: `Env` declares it that way
  and `src/storage/storage.ts` is the only reader. A namespace bound under any other
  name leaves the panel unable to save or even to work out its own URL.
