# RayZen Panel v1.1.0

RayZen Panel v1.1.0 establishes the Worker as the official backend for RayZen Companion and completes the Panel, Wizard and release-integrity work required for a coordinated ecosystem release.

## Release highlights

- Companion API discovery identifies RayZen Panel, API level `1` and supported capabilities.
- Authentication returns the signed-in user profile without exposing session tokens to JavaScript.
- Health, diagnostics, settings, usage, profiles and scanner history use the existing authenticated Panel session.
- Scanner selection is applied through a narrow validated endpoint that changes only `cleanIPs`.
- Seven Panel themes are complete across light, dark, mobile and RTL layouts.
- The Wizard deploys the exact SHA-256-pinned Worker produced by the source build.

## Verified artifacts

| Artifact | Result |
| --- | --- |
| `dist/worker.js` | Production build, 581,744 bytes |
| `wizard/artifacts/worker.js` | Byte-identical to `dist/worker.js` |
| SHA-256 | `9a945dcf7dd9b8d52f3b7723ff12c38ac0223a0bd31742c61cee137d088571f5` |
| Build toolchain | esbuild 0.28.1 |
| Wrangler dry run | Passed with KV binding `kv` |

The artifact grew from the 559,433 bytes recorded earlier because it was rebuilt from
current `src/` after the panel UI work, not because of a code-size regression; the Wizard
copy had been shipping a bundle that predated the inline SVG icon sprite, the split
overview cards and the Analytics fix.

## Verification

- Strict TypeScript check: passed.
- Vitest: 1,184 tests passed.
- Companion API integration: passed.
- Packaged Worker flow: 133 checks passed.
- Clean deployment flow: 51 checks passed.
- Password migration flow: 14 checks passed.
- Wizard: 21 tests passed.
- Build matrix: development, minified and source-map setup flows passed.
- Static module graph: 96 TypeScript modules, no import cycles.
- Documentation links: 62 Markdown files, 77 relative links, none broken before this release-note update.
- Bundle gate: passed; compressed size remains above the warning threshold but below the enforced release limit.

## Deployment status

The Worker passed `wrangler deploy --dry-run`. No production account was changed as part of release preparation.

## Upgrade notes

- Existing sessions and PBKDF2 password verifiers remain compatible.
- Older plaintext and lower-cost password records migrate after a successful login.
- Companion should require `product: "RayZen Panel"` and `companionApi >= 1` before enabling write actions.
- Cloudflare usage is optional. Clients must display `available: false` rather than interpreting missing credentials as zero requests.

## Release command

```bash
npm ci
npm run verify:release
npm run verify:tdz-build-matrix
npm run test:deploy-flow
XDG_CONFIG_HOME=/tmp/rayzen-wrangler npm run deploy:check
```
