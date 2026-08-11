# RayZen Wizard v2

A separate, GitHub-account-free deployment experience for RayZen. Users never need GitHub. Each Wizard release carries the exact RayZen Worker artifact it is allowed to deploy, so a branch cache, stale raw GitHub response, or half-finished release cannot silently send users a different panel build. The wizard is designed to be deployed as its own Vercel project and does not share runtime state with the RayZen panel.

## Deployment paths

### 1. Continue with Cloudflare — recommended

The wizard uses Cloudflare self-managed OAuth with an Authorization Code flow, a server-side client secret, `state`, and PKCE (`S256`). Access tokens never enter browser JavaScript. The short-lived token is held only in an AES-256-GCM encrypted, `HttpOnly`, `SameSite=Lax` session cookie and is revoked after a successful deployment.

Configure the Cloudflare OAuth client for the least privileges required by this deployment:

- Workers Scripts Write
- Workers KV Storage Write

Use the scope IDs Cloudflare assigns/exposes for those permissions in `CLOUDFLARE_OAUTH_SCOPES`. Do not guess or hard-code scope IDs.

Register this redirect URI exactly:

`https://rayzen.bond/api/oauth/callback`

For public use, publish/verify the Cloudflare OAuth client according to Cloudflare's current OAuth client requirements.

### 2. Cloudflare API Token — advanced

The token is submitted over HTTPS to the serverless function, verified with Cloudflare, encrypted into the same short-lived `HttpOnly` session, and cleared locally after deployment. RayZen never writes it to KV, files, logs, local storage, or the deployed Worker.

Recommended token permissions:

- Account / Workers Scripts / Edit
- Account / Workers KV Storage / Edit

Limit the token to the accounts intended for RayZen deployment.

## Vercel setup

1. Create a Vercel project with this `wizard/` directory as the project root.
2. Add the environment variables from `.env.example`.
3. Point `rayzen.bond` to the Vercel project (or change `WIZARD_PUBLIC_URL` if you later move the Wizard to a subdomain).
4. Add the exact production callback URL to the Cloudflare OAuth client.
5. Deploy.

No build step or third-party runtime dependency is required.


## Vercel plan note

The code is compatible with Vercel Functions without a build step. Vercel's **Hobby** plan is currently restricted by Vercel's terms to personal, non-commercial use. If RayZen's public launch is commercial, deploy the same `wizard/` project on an eligible paid Vercel plan (or move the backend in a later architecture revision). Do not describe a commercial production launch as Hobby-compatible merely because it fits the technical quotas.

## How deployment works

Each `/api/deploy/step` request performs one idempotent deployment phase. Short-lived authorization state and resumable deployment state are AES-256-GCM encrypted inside `HttpOnly` cookies, which keeps Vercel invocations short and avoids a deployment database. 
1. Validate account access.
2. Validate deployment metadata and ensure an account `workers.dev` subdomain exists. If the account has none, the wizard creates a randomized one through the official Cloudflare API.
3. Generate a collision-resistant Worker name.
4. Create the KV namespace.
5. Read `wizard/artifacts/worker.js`, verify its SHA-256 against `wizard/artifacts/manifest.json`, and upload that exact build with its KV binding.
6. Enable the Worker on `workers.dev`.
7. Fetch the published first-run page and verify its release marker, so the Wizard refuses to report success if Cloudflare is serving a different/stale build.
8. Finalize the summary and revoke the OAuth token when OAuth was used.

Release rule: `dist/worker.js` and `wizard/artifacts/worker.js` must be byte-for-byte identical. Run `npm run release:sync-wizard` after building a panel release; it copies the artifact and updates the manifest checksum.
## Security properties

- OAuth `state` validation and 10-minute authorization session.
- PKCE S256 in addition to server-side client authentication.
- Same-origin checks and a signed CSRF token on mutations.
- AES-256-GCM encrypted `HttpOnly` cookie payloads created and decoded server-side.
- `HttpOnly`, `SameSite=Lax`, secure production cookies.
- Cloudflare OAuth/API credentials never enter browser JavaScript.
- Cloudflare OAuth/API credentials are never persisted in RayZen KV or the deployed Worker.
- The deployed first-run form contains only the administrator email and password fields; there is no extra hidden first-run credential handoff.
- The Wizard verifies the published setup-page release marker before reporting deployment success.
- OAuth token revocation after successful deployment.
- Explicit CSP, frame denial, no-referrer, and restrictive Permissions Policy.
- The bundled Worker is SHA-256 verified against the release manifest before upload.
- The deployed first-run page carries a release marker that is checked after publication.

## Local UI QA

The static UI has localhost-only preview states:

- `/?preview=home`
- `/?preview=token`
- `/?preview=account`
- `/?preview=progress`
- `/?preview=success`
- `/?preview=error`

Append `&mode=light` or `&mode=dark` for deterministic theme captures.

## Production OAuth smoke-test requirement

Before public launch, test the real Cloudflare OAuth client end-to-end with one-account and multi-account users. The wizard currently discovers authorized accounts through `GET /accounts`; Cloudflare documents account selection in the consent UI but does not currently document an explicit selected-account claim in the OAuth callback. Confirm account discovery with the exact production scopes before declaring the OAuth path production-ready. If a separate documented account-discovery permission is required, add only that minimum permission.
