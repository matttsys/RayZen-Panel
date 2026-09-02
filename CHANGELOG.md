# Changelog

All notable changes to RayZen Panel are documented here. The project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- A metrics document first written by the traffic counter (hourly buckets only) made every route that read daily counters throw, which surfaced as "The request could not be completed." on the Analytics tab and as a failed sync after every Companion write. The document is now normalised on read.
- The panel's platform fetch wrapper reports the HTTP status and the server message instead of a generic failure.
- Analytics shows an honest "No traffic recorded yet" state; "Last 24h Requests" says "Not available" instead of em-dashes; "My IP" reads the visitor's address from the request's own Cloudflare properties, so the panel no longer contacts geojs.io or icanhazip.com and its `connect-src` is `'self'`.
- Icons are drawn from one inline SVG sprite (`<symbol>`/`<use>`, `currentColor`, em-sized), which removes the squashed and invisible icon boxes on the Subscriptions and Settings tabs.
- The hero's stray diagonal rays are replaced by a single static cat mark that never overlaps the health ring.

### Changed

- Every tab is split into cards with a heading and a one-line description; stat strips are grids of tiles; buttons share one height and focus ring; no horizontal overflow at 380px.

## [1.1.0] - 2026-08-11

### Added

- Published Companion API discovery metadata through `panel/version`, including the product identity, API level and feature capabilities.
- Added authenticated profile metadata to successful login responses.
- Added `panel/platform/scanner/apply`, a bounded endpoint that validates and updates only the selected clean IP.
- Added integration coverage for the complete Companion sequence: discovery, authentication, settings, usage, health, diagnostics, scanner history and scanner apply.
- Added advanced diagnostics, health center, deployment preflight, configuration history, migration status, backup planning, optimization profiles and effectiveness analytics.
- Added shared subscription links with independent expiry, revocation and coarse usage history.
- Added device-side browser scanning and Worker-side configured-endpoint intelligence.
- Added Wizard artifact pinning and setup-build-marker verification.

### Changed

- Completed the seven Panel themes across light and dark surfaces, including Persian and RTL layouts.
- Cloudflare usage now returns an explicit unavailable state when optional analytics credentials are absent or rejected.
- Unified browser-script minification under esbuild and added executable TDZ regression coverage for all build modes.
- First-run setup accepts only administrator email and password; the retired credential handoff is removed.
- Administrator password storage uses PBKDF2-SHA-256 with migration from historical formats.
- Updated the release workflow so the source build and Wizard artifact are byte-identical and SHA-256 pinned.

### Fixed

- Repaired the truncated Wizard Worker artifact by rebuilding it from source.
- Rejected null, array and primitive settings payloads as client validation errors.
- Corrected undefined theme tokens and component-level colors that bypassed theme selection.
- Corrected WARP subscription test fixtures to exercise the required two-account chain.
- Corrected error-page status assertions to preserve HTTP 500 semantics.
- Corrected Worker-name type declarations and an overloaded KV test adapter that prevented strict TypeScript checking.

### Security

- Companion writes no longer require sending the full settings document, preventing concurrent unrelated settings from being overwritten.
- Protected Companion resources remain session-gated and use the Panel's hardened cookie policy.
- Scanner apply rejects oversized bodies, ports, URLs, invalid hosts, unsupported modes and lists above the configured limit.

## [1.0.0] - 2026-08-05

### Added

- Released the RayZen-branded Cloudflare Worker, browser Panel and first-run setup flow.
- Added VLESS, Trojan, WARP and WARP Pro subscription generation across supported Xray, sing-box, Clash, WireGuard and Amnezia clients.
- Added strict CSP, per-deployment session signing, KV-backed settings and self-contained UI assets.
- Added the direct Cloudflare installer, generated Worker names and pinned-identity packaging flow.

### Changed

- Removed the third-party default proxy IP; new deployments route directly until the operator configures an endpoint.
- Made Ocean the default Panel theme and added automatic language selection.

### Fixed

- Restored universal Xray compatibility for generated configurations.
- Corrected mobile navigation, form sizing, stale select values and subscription route fallthrough.
- Removed obsolete beta branding, external icon fonts and broken placeholder links.

[1.1.0]: https://github.com/matttsys/RayZen-Panel/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/matttsys/RayZen-Panel/releases/tag/v1.0.0
