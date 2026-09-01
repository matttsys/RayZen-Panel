# Deployment

Five ways to get RayZen running. Pick the wizard unless you have a reason not to.

| | You need | Takes |
|---|---|---|
| [RayZen deployment wizard](#a-rayzen-deployment-wizard-recommended) | a Cloudflare account | about two minutes |
| [Deploy to Cloudflare / GitHub](#b-deploy-to-cloudflare-github-legacy) | Cloudflare + GitHub | about two minutes |
| [The installer, no GitHub](#c-the-installer-no-github-account-needed) | a Cloudflare API token, Node 20.10+ | five minutes |
| [wrangler from a clone](#d-wrangler-from-a-clone) | Node 20.10+, a terminal | ten minutes |
| [A pinned-identity artifact](#e-a-pinned-identity-artifact) | the above, plus a reason | fifteen minutes |

The deployed application runs on Cloudflare. The web wizard is only a short-lived deployment control plane hosted separately on Vercel; it does not host your RayZen panel.

Every path produces the same Worker runtime. What differs is how the deployment is provisioned and where the initial deployment authorization comes from.

## Before you start

RayZen needs a `workers.dev` account subdomain. The deployment wizard creates a randomized one through Cloudflare's API if the account does not already have one. For manual deployment methods, set it once under **Workers & Pages → your account → Subdomain** before deploying.

The panel needs one KV namespace bound to the variable name **`kv`**, and the
compatibility flag **`nodejs_compat`**. Both are non-negotiable:

- `src/storage/storage.ts` is the only reader of the binding and it reads `env.kv`. A
  namespace bound under any other name leaves the panel unable to save anything, or
  even to work out its own URL.
- `src/protocols/trojan.ts` hashes the Trojan password with `node:crypto`, and
  `src/api/warp.ts` generates x25519 keypairs with it. Without the flag, Trojan
  authentication and WARP renewal fail at runtime, not at build time.

Never share a KV namespace between two deployments. They use the same keys, so the
second one overwrites the first one's settings.

---

## A. RayZen deployment wizard (recommended)

Open <https://rayzen.bond>.

1. Select **Continue with Cloudflare**.
2. Sign in on Cloudflare and review the requested permissions.
3. Select the Cloudflare account to use and authorize RayZen.
4. Return to the wizard. Deployment starts automatically.
5. When verification completes, open the Worker URL and finish RayZen's one-time setup.

The wizard creates the Worker, KV namespace, `kv` binding and workers.dev publication directly through Cloudflare's official APIs. It generates a randomized Worker name and does not require GitHub or a manually created API token.

OAuth access is short-lived. The access token stays out of browser JavaScript, is used only by the wizard's server-side deployment functions, and is revoked after a successful deployment. The wizard never stores the token in the RayZen Worker or KV namespace.

If OAuth is unavailable, expand **API token** in the wizard. The fallback requires the same three account permissions documented in the installer section below and reaches the same deployment result.

---

## B. Deploy to Cloudflare / GitHub (legacy)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/matttsys/RayZen-Panel)

1. **Click the button.** Cloudflare asks you to sign in to your own account.
2. **Authorise the GitHub connection.** Cloudflare forks RayZen into your GitHub
   account, so you own the code your Worker runs and can see every future change.
3. **Name your Worker.** This becomes your hostname:
   `<name>.<your-subdomain>.workers.dev`. Pick something unremarkable; the name is
   public.
4. **Confirm.** Cloudflare creates the KV namespace, builds, and deploys. It takes a
   minute or two.
5. **Open your Worker's URL.** RayZen shows a one-time setup page. Choose the email
   and password you want to sign in with.
6. **Save the panel URL it gives you.** It contains a random secret path that is shown
   exactly once and cannot be recovered from the dashboard. Put it in your password
   manager before closing the tab.

That legacy flow needs no API token or command line, but it does require a GitHub account. New users should use the RayZen deployment wizard instead.

### What just happened

Your Worker generated its own panel path, VLESS UUID and Trojan password on its first
request and stored them in your KV namespace. Nothing was baked into the script, so
nothing about your deployment exists anywhere outside your Cloudflare account.

### The claim window

Between the deploy finishing and you completing that setup page, anyone who knows your
Worker's address could complete it instead. In practice the window is the few seconds
between Cloudflare finishing and you clicking through, and the address is unguessable
until you share it. For deployments that need a pinned administrator identity, set
`RAYZEN_ADMIN_EMAIL` before opening the Worker URL. Setup then accepts only that
address, so a claim using another address cannot create a usable administrator account.

`RAYZEN_ADMIN_EMAIL` can be added after deploying as long as it is configured before
the first-run claim is completed.

### Updating later

Your fork is a normal repository. Pull from upstream, push to your fork, and Cloudflare
rebuilds and redeploys. Your settings live in KV and survive the redeploy.

---

## C. The installer, no GitHub account needed

The button is the shortest path and it needs a GitHub account to fork into. If you do not
have one, or would rather not have a public fork of a circumvention tool under your name,
this path uploads the Worker straight to Cloudflare's API.

```bash
npm ci
npm run build
npm run install:cloudflare
```

It asks for one thing: a Cloudflare API token. Create it at
<https://dash.cloudflare.com/profile/api-tokens> → **Create Token** → **Create Custom
Token**, with exactly these three permissions:

| Scope | Permission | Access |
|---|---|---|
| Account | Workers Scripts | Edit |
| Account | Workers KV Storage | Edit |
| Account | Account Settings | Read |

Nothing broader. In particular the installer never needs Zone permissions, and never
needs a Global API Key — if a guide tells you to paste your Global Key anywhere, close it.

What the installer then does, in order:

1. Verifies the token and finds your account.
2. Checks the account has a `workers.dev` subdomain, and stops with an explanation if not.
3. Generates a Worker name such as `rayzen-swift-harbor-a91f`, and checks it against the names
   already in the account so it cannot collide. The name is printed before anything is
   created.
4. Creates one KV namespace for this deployment and binds it as `kv`.
5. Uploads `dist/worker.js` with `nodejs_compat`.
6. Enables the `workers.dev` address, with previews off.

Then open the URL it prints, set your email and password, and save the panel link. That
link contains a secret path shown exactly once.

The token is used for the duration of the command and is never written to disk, never
embedded in the Worker, and never sent anywhere except `api.cloudflare.com`. The panel
does not need it to serve traffic; see
[unlock the panel's Cloudflare features](#optional-unlock-the-panels-cloudflare-features)
if you later want the in-panel update button.

Useful flags:

```bash
npm run install:cloudflare -- --dry-run     # verify the token and print the plan
npm run install:cloudflare -- --name my-own-name
npm run install:cloudflare -- --help
```

### Why the name is generated

Earlier builds reused one fixed Worker name. That made the hostname guessable from the
application alone and made one string a fleet signature across every account running it.
This release rejects the prohibited deployment term. A generated neutral name with a random suffix removes both problems. `npm run -s name` prints one without deploying.

---

## D. wrangler from a clone

For anyone who wants the deployment in version control, or who does not want to fork.

### 1. Install and check the toolchain

```bash
git clone https://github.com/matttsys/RayZen-Panel.git
cd RayZen-Panel
npm ci
npm run check      # types
npm test           # the full suite
npm run build      # writes dist/worker.js
npm run size       # bundle budget
```

### 2. Authenticate wrangler

```bash
npx wrangler login                # browser OAuth, or:
export CLOUDFLARE_API_TOKEN=...   # Workers Scripts + Workers KV Storage, edit
npx wrangler whoami
```

### 3. Create the KV namespace

```bash
npx wrangler kv namespace create rayzen
```

It prints the new namespace's id. Put it in `wrangler.jsonc`, replacing the
placeholder:

```jsonc
"kv_namespaces": [
    { "binding": "kv", "id": "the-id-that-was-printed" }
]
```

Leave `"binding": "kv"` exactly as it is. To have wrangler edit the file for you:

```bash
npx wrangler kv namespace create rayzen --binding kv --update-config
```

### 4. Deploy

```bash
npx wrangler deploy --dry-run --name "$(npm run -s name)"
npm run deploy                    # generates another safe unique name and uploads
```

Do not deploy the static fallback name as a fleet default. `npm run deploy` always
overrides it with a freshly generated safe name. Set `RAYZEN_WORKER_NAME` only when you
need to pin a custom safe name. If the `*.workers.dev` address 404s, enable it under
**Workers & Pages → your Worker → Settings → Domains & Routes**.

### 5. Set up

Open the Worker's URL. The same one-time setup page appears, and hands you your panel
URL. Save it.

### Optional: unlock the panel's Cloudflare features

Usage statistics, in-panel custom domain setup and the self-repair redeploy need
Cloudflare API access. Add the account id as a variable and the token as an encrypted secret under **Settings → Variables and Secrets**:

| Variable | Value |
|---|---|
| `RAYZEN_CF_ACCOUNT_ID` | Plain variable: your account id from the Workers overview page. |
| `RAYZEN_CF_API_TOKEN` | Encrypted secret: a token with Workers Scripts · Edit and Workers KV Storage · Edit. |

Without them the panel runs and reports those features as unavailable. They are read
from the environment and never written to KV, so they stay out of settings exports and
backups.

### Every recognised variable

All optional. Set none and the deployment generates what it needs.

| Variable | Effect |
|---|---|
| `RAYZEN_ADMIN_EMAIL` | Pins the sign-in address and closes the claim window. |
| `RAYZEN_CF_ACCOUNT_ID` | Cloudflare account id, for the API-backed features. |
| `RAYZEN_CF_API_TOKEN` | Cloudflare API token, same. |
| `RAYZEN_WORKER_NAME` | The Worker's script name. Only needed when the hostname's first label is not the Worker name, which happens on a custom domain. |
| `RAYZEN_SECURE_PATH` | Pins the panel path instead of generating one. |
| `RAYZEN_VL_UUID` | Pins the VLESS UUID. |
| `RAYZEN_TR_PASS` | Pins the Trojan password. |
| `RAYZEN_PROXY_IP_MODE` | `proxyip` (default) or `nat64`. |
| `RAYZEN_PROXY_IPS` | Comma-separated proxy IPs or domains. |
| `RAYZEN_PREFIXES` | Comma-separated NAT64 prefixes, each in `[IPv6]` form. |
| `RAYZEN_FALLBACK` | Domain to proxy for unmatched paths. |
| `RAYZEN_DOH_URL` | Upstream DoH endpoint. |
| `RAYZEN_GEO_ENDPOINT` | Optional https geo-lookup service for configured proxy addresses. Absent by default, and absent means no third party is contacted: locations are reported as unknown instead. See `SECURITY.md`. |

Each one overrides a single field, so you can pin the panel path and leave everything
else generated.

---

## E. A pinned-identity artifact

`npm run package` bakes a fixed identity into the script instead of resolving one at
runtime. You want this in three situations and no others:

- Reproducing an existing deployment's exact identity, for a migration or a rollback,
  without touching its KV.
- Deploying somewhere first-run setup cannot be reached.
- Pinning an identity in CI so an automated deploy has no interactive step.

```bash
npm run build
RAYZEN_MAIN_DOMAIN=my-panel.example.workers.dev \
RAYZEN_ACC_EMAIL=you@example.com \
npm run package
npx wrangler deploy dist/worker.deploy.js
```

`RAYZEN_MAIN_DOMAIN` is the hostname the Worker will answer on, without a scheme.
Every generated subscription link is built from it, so a wrong value produces configs
pointing at the wrong host. For a `workers.dev` deploy it is
`<worker-name>.<your-subdomain>.workers.dev`.

Everything else is optional and generated when absent. **Generated values are printed
once and cannot be recovered from the artifact afterwards. Store the panel path
immediately.** Supply `RAYZEN_CF_ACCOUNT_ID` in the package environment if you want account-aware
metadata. Bind `RAYZEN_CF_API_TOKEN` after deployment with `wrangler secret put`; it is
never written into the artifact. The full variable list is in the header of
`scripts/package-worker.js`.

The output contains your credentials. Never commit or publish it; `.gitignore` ignores
`dist/` for exactly this reason.

One consequence: settings that live in the baked block (panel path, UUID, Trojan
password, proxy IPs) can only be changed by redeploying, so changing them from the
panel needs an API token. A runtime-resolved deployment writes them to KV instead and
needs nothing.

---

## Custom domain

`workers.dev` is blocked on some networks, so a domain you control is worth five
minutes. It must already be a zone on your Cloudflare account.

**With wrangler**, add to `wrangler.jsonc`:

```jsonc
"routes": [
    { "pattern": "panel.example.com", "custom_domain": true }
]
```

```bash
npx wrangler deploy
```

Cloudflare creates the DNS record and the certificate. Nothing else is needed: the
panel reads its hostname from each request, so subscription links start naming the new
domain as soon as clients use it.

**From the panel** instead, if you supplied `RAYZEN_CF_ACCOUNT_ID` and
`RAYZEN_CF_API_TOKEN`: open **Settings → Custom domain**, enter the full hostname, and
save. The panel looks up the zone, attaches the domain, and reports the exact failure
if the zone is not on the account.

**Either way:** keep the `workers.dev` route enabled until the custom domain serves
the panel, so a DNS mistake does not lock you out. Then re-copy your subscription
links, since existing ones still name the old hostname.

---

## Release checks

Run before promoting any build:

```bash
npm ci
npm run check
npm run check:doc-links
npm test
npm run build
npm run size
npm run deploy:check
npm run test:deploy-flow
npm run package
npm run test:flow
```

CI runs all of these on every push and pull request, plus a byte-for-byte
reproducibility check across two consecutive builds.

Deploy to a staging hostname first and verify by hand: first-run setup, login,
settings preview and save, every subscription variant, QR generation, scanner limits,
export and a restore dry run, and logout. Then promote the same tested commit rather
than rebuilding.

## Rollback

Keep a settings export and know which commit you were on.

1. **Button or wrangler deployment:** redeploy the previous commit. Cloudflare's
   dashboard also keeps previous versions under **Deployments**, so a rollback there is
   two clicks.
2. **Pinned-identity artifact:** redeploy the previous `worker.deploy.js`, or repackage
   the previous release with the same identity values.
3. **Do not touch KV.** Settings survive a code rollback, and the panel migrates them
   forward on read. Restore data only if KV itself is damaged, and only after checking
   the export's version and previewing the diff in the panel's import view.

A rolled-back deployment keeps its panel path, UUID and Trojan password, so existing
subscriptions keep working.

## When something is wrong

| Symptom | Cause and fix |
|---|---|
| An error page mentioning the `kv` binding | No KV namespace is bound, or it is bound under the wrong name. Bind one as exactly `kv` under **Settings → Bindings**. |
| `workers.dev` address unreachable from your country | It is blocked on some networks. Add a custom domain. |
| The setup page does not appear | Either the deployment is already claimed (a password exists) or it carries a baked identity. Both are working states, not faults. |
| Lost the panel URL | Read `securePath` from the `rz:identity` key in your KV namespace, in the Cloudflare dashboard. |
| Lost the password | Delete the `pwd` key from your KV namespace. The next visit shows first-run setup again. The in-panel reset route needs an existing session, so it cannot recover a lost password. |
| Subscriptions return "Not Found" | Use the full shape: `/{securePath}/sub/{variant}?app={core}`. |
