# :material-rocket-launch-outline:{ .md .middle } Installation

RayZen deploys to your own Cloudflare account. There is no RayZen server involved at
any point, and nothing you enter reaches anyone but Cloudflare.

## What you need

- A free [Cloudflare account](https://dash.cloudflare.com/sign-up/), with the email
  verified.
- A `workers.dev` subdomain set on that account, under
  **Workers & Pages → your account → Subdomain**. This is a one-time step; without it a
  Worker deploys fine and has no address.

That is all. No API token, no VPS, no command line.

## Deploy with one click

Open the [RayZen repository](https://github.com/matttsys/RayZen-Panel) and press the
**Deploy to Cloudflare** button in the README.

Cloudflare then:

1. Asks you to sign in and authorise the GitHub connection.
2. Forks RayZen into your GitHub account, so you own the code your Worker runs.
3. Asks you to name the Worker. The name becomes your hostname
   (`<name>.<your-subdomain>.workers.dev`), so pick something unremarkable.
4. Creates the KV namespace, builds the project, and deploys it.

It takes a minute or two.

## Finish setup

Open your Worker's URL. RayZen shows a one-time setup page:

1. Enter the email address you want to sign in with.
2. Choose a password. It needs at least 8 characters, one capital letter and one digit.
3. Press **Create my panel**.

RayZen then hands you your panel URL.

!!! warning "Save that URL now"
    It contains a random secret path that is shown **exactly once** and cannot be
    recovered from the Cloudflare dashboard. Put it in your password manager before
    closing the tab.

    If you do lose it, you can read `securePath` from the `rz:identity` key in your KV
    namespace, in the Cloudflare dashboard.

## What just happened

Your Worker generated its own panel path, VLESS UUID and Trojan password on its first
request and stored them in your KV namespace. None of it was baked into the code, and
none of it exists anywhere outside your Cloudflare account.

## The first-run window

Between the deploy finishing and you completing that setup page, whoever reaches it
first becomes the administrator. In practice that window is the few seconds it takes
you to click through, and nobody else knows your Worker's address yet.

If you want it closed regardless, add one of these under
**Settings → Variables and Secrets** *before* opening your Worker's URL:

| Variable | Effect |
|---|---|
| `RAYZEN_ADMIN_EMAIL` | Setup accepts only this address, so a claim by anyone else creates an account they cannot use. |

## Optional: unlock the Cloudflare features

Usage statistics, in-panel custom domain setup and the self-repair redeploy need
Cloudflare API access. Add two secrets under **Settings → Variables and Secrets**:

| Variable | Value |
|---|---|
| `RAYZEN_CF_ACCOUNT_ID` | Your account id, shown on the Workers overview page. |
| `RAYZEN_CF_API_TOKEN` | A token with Workers Scripts · Edit and Workers KV Storage · Edit. |

Without them the panel runs normally and reports those specific features as
unavailable. Both are read from the environment and never written to KV, so they stay
out of settings exports and backups.

## Updating

Your fork is a normal repository. Pull from upstream, push to your fork, and Cloudflare
rebuilds and redeploys automatically. Your settings live in KV and survive the redeploy.

## Installing without a GitHub account

The button needs a GitHub account to fork into. If you do not have one, the installer
uploads the Worker straight to Cloudflare's API instead:

```bash
npm ci
npm run build
npm run install:cloudflare
```

It asks for a Cloudflare API token with exactly three permissions — **Workers Scripts:
Edit**, **Workers KV Storage: Edit** and **Account Settings: Read** — created at
[dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens).

The installer then generates a Worker name such as `rayzen-swift-harbor`, shows it to you,
creates the KV namespace, uploads the Worker and prints the address to open. Setup from
there is the same one-time page.

!!! info
    The token is used for that one command. It is never written to disk and never embedded
    in the Worker. Add `--dry-run` to see the plan without creating anything.

## Deploying from a terminal instead

If you would rather not fork, clone and deploy with wrangler:

```bash
git clone https://github.com/matttsys/RayZen-Panel.git
cd RayZen-Panel
npm ci
npx wrangler kv namespace create rayzen --binding kv --update-config
npx wrangler deploy --name $(npm run -s name)
```

Then open the Worker's URL and complete the same setup page. The full walkthrough,
including every environment variable and the custom-domain path, is in the
repository's `docs/DEPLOYMENT.md`.

## Next steps

- Add a [custom domain](configuration/admin-settings.md). `workers.dev` is blocked on
  some networks, so this is worth doing early.
- Check [Settings](configuration/index.md) and generate your first subscriptions.
- Run the endpoint scanner from the Intelligence tab to find clean IPs.
