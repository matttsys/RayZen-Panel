<div align="center">

<img src="rayzen-logo.png" width="150" alt="RayZen">

# RayZen Panel ᓚᘏᗢ

Self-hosted networking control plane that runs entirely inside your own Cloudflare account.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-276c7c.svg?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.1.0-276c7c?style=flat-square)](CHANGELOG.md)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f38020?style=flat-square)](https://developers.cloudflare.com/workers/)
[![Node](https://img.shields.io/badge/Node-20.10%2B-3c873a?style=flat-square)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-1194-276c7c?style=flat-square)](tests)

[Deploy with the RayZen Wizard](https://rayzen.bond) · [فارسی](README_fa.md)

</div>

RayZen Panel packages the Worker runtime, the browser control panel, first-run setup and the
deployment Wizard in one repository. Settings, credentials, sessions, subscriptions and
operational history stay in the operator's Cloudflare account, which is the entire point: there
is no RayZen server in the path, so there is nothing of yours for us to lose.

[RayZen Companion](https://github.com/matttsys/RayZen-Companion) is the Android client. It
authenticates directly with your Worker, reads health and diagnostics, and applies selected
scanner results through one narrow validated endpoint. The Companion carries its own native
scanner, so there is no separate scanner service to deploy.

## Contents

- [Capabilities](#capabilities)
- [Screenshots](#screenshots)
- [Deployment](#deployment)
- [Configuration reference](#configuration-reference)
- [Companion API](#companion-api)
- [Supported clients](#supported-clients)
- [Security model](#security-model)
- [Troubleshooting](#troubleshooting)
- [Development and release verification](#development-and-release-verification)
- [Documentation](#documentation)
- [Credits and licence](#credits-and-licence)

## Capabilities

| Area | What it does |
| --- | --- |
| **Subscriptions** | VLESS, Trojan, WARP and WARP Pro generation for Xray, sing-box, Clash, WireGuard and Amnezia clients. |
| **Per-recipient profiles** | Named links with expiry, revocation, coarse usage history and an optional per-profile request limit that the Worker enforces. |
| **Health and diagnostics** | Health Center, deployment preflight, diagnostics, metrics and a bounded audit history. |
| **Endpoint intelligence** | Configured-endpoint scanning, scheduling, scoring, confidence and lifecycle tracking. |
| **Settings management** | Backup, validation, comparison and restore planning, with secrets redacted in the output. |
| **Interface** | Seven light/dark theme pairs — Midnight, Ocean, Aurora, Forest, Tropical, Lavender, Sunset — in English and Persian with full RTL. |
| **Extras** | Optional Telegram integration, a DNS-over-HTTPS endpoint and custom-domain management. |
| **Hardening** | Strict per-page CSP, hardened session cookies, no external UI assets, and no RayZen branding on unmatched paths. |

## Screenshots

<table>
<tr>
<td width="50%"><b>Dashboard, light</b><br><img src="docs/design-review/panel-dashboard-light.png" alt="RayZen Panel dashboard in light mode"></td>
<td width="50%"><b>Dashboard, dark</b><br><img src="docs/design-review/panel-dashboard-dark.png" alt="RayZen Panel dashboard in dark mode"></td>
</tr>
<tr>
<td><b>Persian and RTL</b><br><img src="docs/design-review/panel-dashboard-fa.png" alt="RayZen Panel in Persian"></td>
<td><b>Mobile</b><br><img src="docs/design-review/panel-dashboard-mobile-390.png" width="260" alt="RayZen Panel on a small phone"></td>
</tr>
</table>

<!-- Placeholders: drop captures at these paths to fill the row. The operator supplies the
     images; the build does not generate them. -->

<table>
<tr>
<td width="50%"><b>Subscription profiles</b><br><img src="docs/design-review/panel-subscriptions.png" alt="Subscription profiles — placeholder"></td>
<td width="50%"><b>Health Center</b><br><img src="docs/design-review/panel-health.png" alt="Health Center — placeholder"></td>
</tr>
</table>

## Deployment

### RayZen Wizard

Open [rayzen.bond](https://rayzen.bond), authorise Cloudflare, pick an account and finish
first-run setup. The Wizard creates a Worker and a KV namespace in that account and deploys the
exact SHA-256-pinned artifact bundled with its release.

The Wizard is a deployment control plane only. It does not host the Panel, the credentials or
the KV data, and it keeps no copy of your token.

<details>
<summary>From source with Wrangler</summary>

Requirements: Node.js 20.10 or newer and a Cloudflare account.

```bash
git clone https://github.com/matttsys/RayZen-Panel.git
cd RayZen-Panel
npm ci
npx wrangler kv namespace create rayzen --binding kv --update-config
npm run deploy
```

The deployment generates a safe Worker name. On the first request the Worker creates its
identity in KV and serves a one-time setup flow. Complete that flow before sharing the URL.

</details>

<details>
<summary>Direct installer</summary>

```bash
npm ci
npm run build
npm run install:cloudflare
```

The installer validates a Cloudflare API token, provisions KV, uploads the Worker and prints
the setup URL. The token is used for that session and not stored.

</details>

<details>
<summary>Pinned identity (reproducing a known deployment)</summary>

```bash
npm run build
RAYZEN_MAIN_DOMAIN=rayzen.example.workers.dev \
RAYZEN_ACC_EMAIL=owner@example.com \
npm run package
npx wrangler deploy dist/worker.deploy.js
```

The packaged artifact contains connection credentials and the administrator email. Do not
commit or publish it.

</details>

See [Deployment](docs/DEPLOYMENT.md) for environment variables, custom domains, rollback and
recovery.

## Configuration reference

| Binding or variable | Required | Purpose |
| --- | --- | --- |
| `kv` | yes | KV namespace holding settings, sessions, profiles and history. |
| `RAYZEN_MAIN_DOMAIN` | packaging only | Pins the deployment's own hostname into the artifact. |
| `RAYZEN_ACC_EMAIL` | packaging only | Administrator email baked into a pinned artifact. |
| `UUID`, `TR_PASS` | optional | Pre-seeded protocol credentials; otherwise generated at first run. |
| `PROXY_IP`, `FALLBACK` | optional | Upstream proxy and fallback host defaults. |
| `SUB_PATH` | optional | Overrides the generated secure path. Treat it as a secret. |

Everything else is operator-editable in the panel itself: identity, DNS, routing rules,
fragment settings, WARP, themes, language and the Telegram integration. The full list, with
defaults and validation rules, is in
[Configuration](docs/en/docs/configuration/index.md).

## Companion API

All paths are relative to `https://<worker>/<securePath>/`.

| Purpose | Method and path | Authentication |
| --- | --- | --- |
| Product discovery | `GET panel/version` | Public |
| Sign in | `POST login/authenticate` | Email and password |
| Settings and profile data | `GET panel/settings` | Session cookie |
| Cloudflare usage | `GET panel/usage` | Session cookie |
| Health | `GET panel/platform/health` | Session cookie |
| Diagnostics | `GET panel/platform/advanced/diagnostics` | Session cookie |
| Scanner history | `GET panel/platform/scanner/history` | Session cookie |
| Apply clean IPs | `POST panel/platform/scanner/apply` | Session cookie |
| Subscription profiles | `GET panel/platform/links` | Session cookie |
| Create a profile | `POST panel/platform/links/create` | Session cookie |
| Enable, disable, delete, re-limit, reset | `POST panel/platform/links/update` | Session cookie |
| Subscription addresses | `GET panel/platform/subscriptions/urls` | Session cookie |

`panel/version` identifies the product as `RayZen Panel`, declares Companion API version `2`
and lists the capabilities it supports; a client that needs a capability the deployment lacks is
expected to say so rather than guess. `scanner/apply` accepts validated addresses and changes
only `cleanIPs` — it cannot overwrite unrelated settings.

The complete contract, including the per-profile request-limit semantics, is in
[Integration contracts](docs/INTEGRATION-CONTRACTS.md).

## Supported clients

<details>
<summary>Full variant and client matrix</summary>

| Variant | Core | Clients |
| --- | --- | --- |
| Normal | Xray | v2rayN(G), MahsaNG, Streisand |
| Normal | sing-box | sing-box, husi |
| Normal | Clash | Clash Meta, Clash Verge, FlClash, Stash |
| Fragment | Xray | v2rayN(G), MahsaNG, Streisand |
| Fragment | sing-box | sing-box, husi |
| Raw | Xray | v2rayN(G), MahsaNG, Shadowrocket, Streisand, PassWall |
| Raw | sing-box | husi, NekoBox, Hiddify, Karing |
| WARP | Xray | v2rayN(G), Streisand |
| WARP | sing-box | sing-box, husi |
| WARP | Clash | Clash Meta, Clash Verge, FlClash, Stash |
| WARP | WireGuard | WireGuard |
| WARP Pro | Xray | v2rayN(G), Streisand |
| WARP Pro | Xray Knocker | MahsaNG, v2rayN-PRO |
| WARP Pro | Clash | Clash Meta, Clash Verge, FlClash, Stash |
| WARP Pro | Amnezia | Amnezia, WG Tunnel |

</details>

## Security model

- Administrator sessions use signed JWTs in `HttpOnly`, `Secure`, `SameSite=Strict` cookies.
- Passwords are stored as salted PBKDF2-SHA-256 verifiers at the Workers compatibility ceiling.
- Cloudflare account credentials are read from environment bindings and never written to KV or
  to a backup.
- Browser pages use build-time CSP hashes and load no third-party scripts, styles, fonts or
  icons.
- Backups redact the panel path, protocol credentials and other protected values.
- Unmatched paths carry no RayZen branding and no distinctive application headers.

Limitations and recovery procedures are in [Security](SECURITY.md). Read them before you decide
the threat model suits you.

## Troubleshooting

<details>
<summary>The setup page appears again after I finished setup</summary>

The Worker could not read its identity from KV. Check that the `kv` binding points at the
namespace you created and that the deployment was not re-created against a fresh namespace.

</details>

<details>
<summary>Subscription links return 404</summary>

The secure path changed, or the profile was deleted or has expired. `GET panel/platform/links`
shows each profile's derived status, including `exhausted` for one that has spent its request
limit; resetting the counter revives it without reissuing the URL.

</details>

<details>
<summary>A profile stopped working sooner than its expiry</summary>

It had a request limit and reached it. Raise the limit, or reset the counter. Limited profiles
also write their counter on every fetch rather than hourly, which is the deliberate cost of
enforcing a limit exactly.

</details>

<details>
<summary>The Companion says a capability is missing</summary>

The deployment predates that capability. Redeploy from a current release: the Companion checks
`panel/version` on purpose so it never applies a route shape the Worker does not implement.

</details>

<details>
<summary>Wrangler complains about KV during deploy</summary>

`npx wrangler kv namespace create rayzen --binding kv --update-config` writes the binding into
`wrangler.jsonc`. If you created the namespace by hand, add the id there yourself; the Worker
will not start without it.

</details>

## Development and release verification

```bash
npm ci
npm run verify:release
npm run verify:tdz-build-matrix
npm run test:deploy-flow
XDG_CONFIG_HOME=/tmp/rayzen-wrangler npm run deploy:check
```

`verify:release` runs strict TypeScript checking, documentation-link checks, the whole Vitest
suite, a production build, Wizard artifact synchronisation, Wizard tests and the bundle-size
gate.

Release artifacts:

- `dist/worker.js` — credential-free Worker used by the Wizard and by ordinary Wrangler deploys.
- `wizard/artifacts/worker.js` — byte-identical Wizard copy.
- `dist/build-manifest.json` and `wizard/artifacts/manifest.json` — version, toolchain, build
  marker, size and SHA-256 metadata.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Integration contracts](docs/INTEGRATION-CONTRACTS.md)
- [Repository boundary](REPOSITORY.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## Credits and licence

RayZen Panel is licensed under [GPL-3.0](LICENSE).

RayZen began as a fork of
[BPB Worker Panel](https://github.com/bia-pain-bache/BPB-Worker-Panel) by bia-pain-bache. That
foundation is the reason this project exists; RayZen keeps the attribution plainly and maintains
its own interface, deployment system, diagnostics, scanner integration and release process.
Third-party components are listed in [THIRD-PARTY.md](THIRD-PARTY.md).

RayZen is not affiliated with or endorsed by Cloudflare.
