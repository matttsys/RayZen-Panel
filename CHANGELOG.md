# Changelog

## Release-blocker hotfix — 2026-08-08

- Removed the static `settings -> kv -> settings` import cycle by introducing a one-way settings loader. This is an independent module-order correctness fix; the browser setup TDZ was in the inline setup form handler, not this Worker-side cycle.
- Root-caused the setup-page TDZ to a historical minifier lexical-name collision: the outer response-text binding and the nested HTML-document binding were both shortened to `t`, making the nested initializer resolve its own uninitialized `t`. The old `var`/"do not mangle setup" workaround is gone; response decoding and HTML error parsing now live in separate functions with independent flat lexical scopes.
- Replaced the mixed Terser/HTML/esbuild pipeline with a single esbuild-owned JavaScript minification path and pinned esbuild 0.28.1. Browser scripts now carry stable `sourceURL` labels; forensic builds emit source maps, and build manifests fingerprint the exact setup source/bundle.
- Removed the Wizard-to-Worker first-run credential handoff and its deployment state/API path; first-run setup now accepts only administrator email and password.
- Changed ordinary Wizard home navigation to discard stale resumable deployment state; only explicit OAuth continuation can resume an in-progress deployment.
- Added a Wizard build marker, cache-busted shell assets, and no-store cache headers so production smoke tests can distinguish the current Wizard from an older deployment.
- Added a static module-cycle regression check and expanded deployment/browser regressions around the new onboarding flow.


## Wizard deployment integrity correction

- The public Wizard now deploys the exact `wizard/artifacts/worker.js` bundled with its release instead of fetching a mutable branch artifact at runtime.
- The bundled Worker is SHA-256 pinned in `wizard/artifacts/manifest.json`; a mismatch stops deployment.
- The published first-run page carries a release marker that the Wizard verifies before reporting success, preventing stale/incorrect Worker builds from being presented as a successful deployment.
- First-run UI remains email + password only. The ownership guard is automatic and never appears as a user field.
- Added `npm run release:sync-wizard` so future releases keep `dist/worker.js` and the Wizard artifact byte-for-byte synchronized.

## Production polish and UX completion

- Completed all seven workspace themes across light/dark surfaces instead of accent-only swaps; added expressive theme tokens and corrected light-theme muted-text contrast to AA.
- Reworked Overview, Diagnostics, Smart Setup, Configuration, Clean IP, Subscriptions, Analytics and Settings around measured state and direct actions without replacing their backend services.
- Removed fake wizard strips, normalized scanner confidence/history values, added sortable supported-client data, and completed interaction/focus/reduced-motion states.
- Completed English/Persian rendering for static and dynamic product copy, including localized dates/times and RTL mobile navigation.
- Verified both source and shipped panel across 1,344 rendered theme/mode/language/viewport states with no overflow, clipped controls, unlabeled visible controls, empty icons or page exceptions.
- Kept exact shared-link quota enforcement out of v1.0.0 because the existing KV counters are approximate; implementing exact quotas would require a backend consistency change rather than a UI-only promise.

## PBKDF2 runtime compatibility correction

- Set the administrator password verifier cost to Cloudflare Workers' supported maximum of 100,000 iterations.
- Added explicit detection for stored verifiers above the runtime ceiling.
- Preserved automatic plaintext migration and added rehash-on-login for lower-cost valid PBKDF2 verifiers.
- Documented recovery for the exceptional case of an already stored 120,000-iteration verifier.


All notable changes to RayZen Panel are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-08-05

The first public release. A stabilisation pass, not a feature release: the work was
finding out why a generated configuration could import cleanly and still load no website,
and making the panel usable on a phone.

### Fixed

- **Generated configurations now run on the clients people actually have.** RayZen emitted
  four things only a very recent Xray core accepts, and an unknown key inside
  `streamSettings` or `sockopt` fails the whole configuration rather than being ignored: a
  `version.min: "26.2.6"` floor, a `mixed` local inbound (which is sing-box vocabulary —
  Xray has no such inbound), `finalmask` fragmentation, `sockopt.happyEyeballs`, and the
  25.7+ DNS-outbound rule syntax. The client imported the subscription, showed a profile,
  appeared to connect, and nothing loaded, because the core never brought up a working
  inbound or outbound.

  `src/cores/xray/compat.ts` translates each finished config into the shape that has been
  stable since Xray 1.8: `socks` inbound, fragmentation on a `freedom` dialer reached
  through `sockopt.dialerProxy`, `settings.noises` for UDP noise, and no version floor. A
  new **Client compatibility** setting selects `universal` (default) or `latest`, and every
  golden fixture is regenerated so the exact bytes of every subscription are pinned.

  This was not a TLS problem. SNI, ALPN, fingerprint, the WebSocket `Host` header and
  `allowInsecure` were all correct and are unchanged.

- **Smart setup and Analytics were unreachable on a phone.** The bottom bar listed five of
  seven views and offered no menu. It now holds four destinations plus **More**, a sheet
  that carries the rest along with the appearance controls — which used to float in the
  content column between the hero and the first card — and sign out. The bar respects the
  iOS home indicator.

- **Three selects in the Common section rendered at their own content width** and their
  chevron sat on the last letter of the value. The section's `.form-control` had moved from
  flex to grid while keeping `justify-content: space-between`, which stops a single `auto`
  track from stretching.

- **A settings document written by an older build blanked any select added since**, because
  the panel assigned `undefined` into `select.value` and then saved the blank back.

- Two `#fff` literals and one `var(--rz-on-accent, #fff)` fallback had reappeared outside
  the token block, which is exactly the drift the design-token suite exists to prevent.

### Added

- **An installer that needs no GitHub account.** `npm run install:cloudflare` uploads the
  Worker straight to Cloudflare's API: it verifies the token, checks the account has a
  `workers.dev` subdomain, creates one KV namespace bound as `kv`, uploads the Worker with
  `nodejs_compat`, enables the address with previews off, and prints what to do next. The
  token is never written to disk and never embedded in the Worker.

- **A generated Worker name per deployment**, such as `rayzen-swift-harbor`. Every
  deployment used to be `rayzen-edge`: a guessable hostname, and one string identifying
  the whole fleet across every account running it. `npm run -s name` prints one for a
  manual deploy; the installer checks it against the account's existing scripts first.

### Changed

- **Ocean is the default theme.** Forest remains the palette declared on bare `:root`.
- **The panel picks its language from the browser** on first load and remembers an explicit
  choice, including the choice to read English on a Persian system. The language control
  now offers Automatic alongside the two languages.

## [1.1.0] - 2026-08-02

### Added

- **Shared subscription links, one per person.** The panel had exactly one subscription
  link per client, and it was yours; handing it to somebody meant the only way to cut them
  off later was to change your panel path and re-import on every device you own.

  A shared link carries a name, an optional expiry, and its own on/off switch, so revoking
  one person leaves your links and everyone else's working. Each shows when it was last
  fetched and from which country, which is enough to notice a link that has been passed
  onward. Revoking keeps the row and its history; deleting removes both.

  What it deliberately does not do is count bytes. Cloudflare KV loses concurrent
  increments by design, so a traffic quota built on it would fail open silently, and a
  number that is wrong in the operator's favour is worse than no number. The fetch counter
  is persisted at most hourly per link and is labelled as what it is: a lower bound.

  A revoked, expired, unknown or malformed link produces the same response as any other
  unmatched path, byte for byte. A distinguishable answer would tell whoever holds a
  revoked link that it was once real.

- **A clean-IP scanner that runs on your device.** Your browser measures connection
  latency to Cloudflare's published address space directly, so the result describes your
  own ISP and routing rather than the Worker's. Quick samples 200 addresses across ~190
  distinct /24 blocks; Deep samples 1000. Results are ranked with latency, success rate,
  jitter and a verdict, and rolled up per address block.

  The Worker-side scanner is unchanged and still present. It answers a different question,
  whether a configured endpoint is alive, and neither replaces the other.

  The measurement runs in a sandboxed iframe with its own Content-Security-Policy, because
  connecting to arbitrary addresses needs a policy that must never apply to the page
  holding your credentials. The frame has an opaque origin and contains nothing.

  Before every scan it probes two control addresses, one that must answer and one that
  cannot. If it cannot tell them apart the scan is refused rather than reported, because a
  blocked measurement returns plausible-looking zeros and a ranking of noise is worse than
  no ranking.

- **Block learning.** Address blocks that repeatedly measure well on your network are
  probed first on later scans. Evidence decays on a seven-day half-life, and confidence
  requires observations spread across days rather than repeated clicks: three scans in one
  afternoon stay low-confidence and the panel says so.

### Changed

- **No page loads a font.** The panel embedded a 37-glyph Material Symbols subset and the
  proxy-IP page a two-glyph one, both as base64. They are inline SVG now, extracted from
  those exact subsets, which is 3 KB smaller compressed and removes a failure mode: the
  glyph name *was* the element's text, so an icon missing from the subset rendered as the
  literal word `content_copy` on a live page. `font-src` is now `'none'`.

- **The seven themes now actually re-theme the whole panel.** There were two independent
  token layers, and the theme picker only drove one of them, so choosing Ocean or Lavender
  changed a few elements and left the rest forest green. Dark mode had the same bug in
  reverse: it redefined the status fill colours but not the status text colours.

  Accent and status colours are now solved for contrast rather than chosen by eye
  (`scripts/gen-tokens.py`). Every theme accent previously failed WCAG AA in dark mode;
  forest text measured 2.65:1 on the dark surface, and the three status colours measured
  2.58, 3.61 and 3.05:1. All 14 theme-and-mode combinations now pass, verified by reading
  computed colours in a browser.

- Hardcoded colours in the panel stylesheet: 137 to zero. A test fails the build on a new
  one.

- Every dialog and modal now closes on Escape, moves focus inside itself, keeps Tab from
  escaping to the page behind, and restores focus on close. The dismiss controls were
  `<span>` elements, so they were not tab stops and could not be focused, which left every
  modal unusable by keyboard.

- **Optimize My Connection.** One button that reports only what has been measured on
  this deployment: device scans, diagnostics findings, and settings you can see. Every
  step shows the measurement behind it, and on a deployment with nothing measured it says
  so instead of producing generic advice. Nothing is applied; changes are staged in the
  configuration form for you to review and save.

- **Telegram commands for the lists you actually edit.** `/listips`, `/addip`,
  `/removeip`, and the same three for clean IPs and domains. Values are validated with the
  panel form's own rule, so a message cannot store something the form would reject; lists
  are capped; entries are numbered so removal by index works from a phone. Nothing here
  can delete a subscription, rotate the panel path, change the password or touch the
  Cloudflare credentials, because a messaging app is the wrong place for an action that
  cannot be undone from one.

### Fixed

- The noise-packet regenerate button in the configuration form found its icon by a CSS
  class that the icon change removed, so it would have silently stopped responding to
  clicks. Found by driving the form in a browser rather than by reading the diff.

- **The status badge on a diagnostics card was invisible for the three longest checks.**
  It sat at the right edge of the same row as the check title, and a flex item will not
  shrink below its content, so "Authentication failures", "Remote DNS transport" and
  "Endpoint stability trend" pushed the badge past the card edge where the card's own
  `overflow: hidden` clipped it. The badge now sits beside the small-caps label above the
  title, which measured 62px against the 216px the title needs.

- **WARP registration retried on every request, forever, when it failed.** A failed
  registration stored nothing, so the next request tried again: two calls to
  `api.cloudflareclient.com` with a two-second gap, on every subscription fetch, every
  Telegram message and every panel route. On a network where registration cannot succeed
  that is an unbounded retry loop against a Cloudflare service. The shared fallback
  accounts are now persisted on failure, which breaks the loop; WARP then uses them until
  you press refresh, which is a visible and recoverable state rather than a hidden one.

- The panel's self-repair redeploy would have produced a Worker with a broken scanner. The
  measurement frame was not in the list of assets `buildScript` embeds, so its route would
  have served `undefined` after a redeploy. A test now derives that list from the build's
  own globals, so a page added later cannot be forgotten.

### Removed

- **`ip-api.com`.** Two server-side call sites, in neither the CSP allowlist nor the docs
  because the Worker made them rather than the browser. One POSTed your whole configured
  proxy-IP list, up to 100 addresses per request, over plain HTTP.

  Location now comes from Cloudflare's own `cdn-cgi/trace`, and addresses that cannot be
  described that way are reported as unknown. `RAYZEN_GEO_ENDPOINT` lets you point at an
  https service you trust; absent it, no third party is contacted. See `SECURITY.md` for
  the full list of what a deployment talks to.

## [1.0.0] - 2026-08-01

First public release. RayZen started as a fork of
[BPB Worker Panel](https://github.com/bia-pain-bache/BPB-Worker-Panel): its edge
architecture is preserved, while the panel, the deployment story, the scanner, the
platform layer and the security posture were rebuilt.

### Added

- **One-click deployment.** Deploy to Cloudflare button support. Cloudflare forks the
  repository into the user's account, provisions the KV namespace declared in
  `wrangler.jsonc`, builds and deploys. No credential is entered anywhere but
  Cloudflare's own sign-in, and no RayZen infrastructure exists in the path.
- **Runtime identity resolution** (`src/settings/identity.ts`). A deployment resolves
  its panel path, VLESS UUID, Trojan password and sign-in email from the embedded
  block when it has one, then from Worker environment variables, then from KV,
  generating a fresh set on the first request when there is nothing. The hostname
  comes from the request, so one deployment serves both its `workers.dev` address and
  a custom domain correctly.
- **First-run setup page.** A bootstrapped deployment serves a one-time page that
  reveals its generated panel URL and takes the administrator's credentials, then stops
  existing. `RAYZEN_ADMIN_EMAIL` can pin the administrator identity and close the claim window
  entirely.
- **Panel UI.** Light and dark, English and Persian with real RTL, fully self-hosted:
  no third-party fonts, icons or scripts.
- **Subscription generation.** VLESS and Trojan configs in `normal`, `raw`, `fragment`,
  `warp` and `warp-pro` for v2rayNG, v2rayN, MahsaNG, Streisand, sing-box, husi,
  NekoBox, Clash Meta, Clash Verge Rev, FlClash, Stash, Amnezia, WireGuard and
  WG Tunnel.
- **Endpoint scanner.** Cloudflare-aware clean-IP scanning with scoring, confidence,
  lifecycle tracking and actionable recommendations.
- **Health Center and diagnostics.** Preflight checks with fixes attached, plus runtime
  health, a bounded audit history and usage analytics.
- **Backup and restore.** Export with secrets stripped; restore previews as a diff
  before writing.
- **Golden-fixture test suite.** 900 tests, including subscription output pinned across
  14 targets and 12 profiles, so a change to a generated byte is a change to a
  committed file.

### Changed

- Rebranded the panel, login page, error page and subscription remarks.
- Removed the third-party default proxy IP. Fresh deployments route direct until the
  operator adds proxy IPs or runs the scanner.
- Version numbering restarts at 1.0.0; the migration framework's supported floor is
  1.0.0.
- Cloudflare account credentials are read from the environment and never written to
  KV, so they cannot leak through a settings export or a backup.
- The session token's subject falls back to the sign-in email when the deployment has
  no Cloudflare account id, which is the normal case for a one-click deployment.
- `npm run package` is now an advanced path for pinning a fixed identity, rather than a
  prerequisite for deploying at all.

### Removed

- **The browser-based installer.** It called `api.cloudflare.com` directly from a
  static page, which browsers block: Cloudflare's API sends no CORS headers, so it
  could never have worked from GitHub Pages. Replaced by the Deploy to Cloudflare
  button rather than by a credential proxy, because no RayZen server should ever
  receive a user's API token.
- upstream-branded assets, stale icons, dead links and the external icon font on the login
  page, which is inline SVG now.
- Internal planning, review and phase-tracking documents, which were working notes
  rather than public documentation.

### Fixed

- The panel's version check no longer polls a third-party upstream, and reads its own
  response envelope correctly. The Update button stays disabled until there is a signed
  release feed to verify against.
- Self-update redeploys this build's own embedded source. Previously it fetched the
  upstream project's latest release and uploaded it, replacing a RayZen deployment with
  a different project on a single request.
- Removed subscription card "help" links that pointed at `href="#"`.
- Three elements hidden with an inline `style` attribute, which the strict CSP blocks,
  use the `hidden` attribute instead.
- The first-run page previously exposed an unnecessary extra claim field, asking for a
  secret most operators never configure. `hidden` is a UA-stylesheet rule and lost to
  `.form-control{display:grid}`; the stylesheet now declares `[hidden]` as the panel's
  already did. Both this and CSP-refusable style attributes are now gated for every
  page.
- The welcome dialog was headed "RAYZEN BETA v0.1", which was the first thing a new
  operator read on a 1.0.0 release. That label and the eight beta-era identifiers around
  it are gone, and a test refuses the word in any panel asset.
- Four strings behind the panel's `t()` had no Persian entry, so they rendered in English
  inside Persian sentences. Three are translated; the fourth was the product name, which
  stays Latin deliberately.
- The proxy-IP page resolves and dedupes configured proxy IPs; an empty configuration
  no longer crashes the route.
- `resetPassword` accepts the account email typed with capitals, matching login.
- Subscription dispatch no longer falls through to an unrelated subscription kind for
  an unknown client.
- Persian coverage of the panel is complete for user-facing prose: the dictionary grew
  from 121 to 246 entries. What remains in Latin script is protocol, client and vendor
  names that Persian users read untranslated.

### Security

- Strict per-page CSP with build-time script and style hashes; `connect-src` limited to
  the origins each page actually uses, enforced by a ratchet test.
- Session cookie is `HttpOnly`, `Secure`, `SameSite=Strict`, signed with a key
  generated per deployment.
- Backups redact secrets on export and record what they withheld.
- Failed logins are counted, never described: no username, no IP, no timestamp finer
  than the UTC day.

### Known limitations

Detailed in [`SECURITY.md`](SECURITY.md):

- The panel password is stored in KV without hashing.
- There is no login rate limit beyond Cloudflare's own protections.
- The scanner measures from one Cloudflare edge location.
- The WARP fallback accounts are shared, if registration with Cloudflare fails.
- `workers.dev` hostnames are blocked on some networks; a custom domain is recommended.
