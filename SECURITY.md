# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue. Report it privately through GitHub's private
vulnerability reporting on this repository, or by direct message to
[@matttsys](https://t.me/matttsys) on Telegram.

Include:

- The affected version or commit.
- What the vulnerability lets an attacker do.
- Reproduction steps, or a minimal proof of concept.
- A suggested fix, if you have one.

You should hear back within a few days. Fixes ship through the normal release process;
please hold off on public disclosure until one is available.

## What RayZen is, security-wise

RayZen is a Cloudflare Worker that relays its operator's own traffic. It is
single-tenant by construction: one deployment, one administrator, one Cloudflare
account. There is no RayZen server, no shared infrastructure, and no path by which your
credentials reach anyone but Cloudflare.

That shapes the threat model. The adversaries worth defending against are a network
observer, someone who finds your Worker's public address, and a malicious or curious
client of your own subscription links. Not a hostile co-tenant, because there are none.

## Where secrets live

| Secret | Stored | Who can read it |
|---|---|---|
| Panel password | Cloudflare KV, key `pwd` | You, through your Cloudflare dashboard |
| Session signing key | Cloudflare KV, key `secretKey` | Same |
| VLESS UUID, Trojan password, application path | Cloudflare KV, key `rz:identity` | Same |
| Cloudflare account id and API token | Worker environment variables only | Same |
| Telegram bot token | Cloudflare KV, key `telegramBot` | Same |
| Shared subscription link tokens | Cloudflare KV, key `rz:profiles` | Same |

On a deployment made with `npm run package`, the identity and the Cloudflare
credentials are baked into the uploaded script instead of KV, which means anyone who
can read your Worker's code can read them. That is the same set of people, since
reading a Worker's code requires dashboard access.

The Cloudflare credentials are deliberately environment-only and never written to KV,
so they cannot leak through a settings export or a backup file.

Shared subscription tokens are in a KV key of their own rather than in the settings
document, for the same class of reason: the settings document is exportable from the panel,
and a token in an export is a working credential in a backup file with a lifetime nobody is
tracking. They are also absent from the audit log, which records that a link was created or
revoked and when, but never its token.

Anyone with read access to your Cloudflare account can read all of it. Guard your
Cloudflare login: it is the actual security boundary.

## Hardening that is in place

- **Sessions.** HS256 JWT in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie, signed
  with a key generated per deployment. `SameSite=Strict` plus same-origin-only
  state-changing routes means there is no CSRF surface.
- **Content-Security-Policy.** Every page ships `default-src 'none'` with build-time
  hashes for its inline script and style. No inline event handlers, no third-party
  fonts, icons or scripts, and `connect-src` restricted per page to the origins that
  page actually uses. A test enforces that origin list as a ratchet: it can shrink, not
  grow.
- **Header set applied at the router**, not per handler, so a route added later cannot
  ship without it. `Referrer-Policy: no-referrer` matters most here: without it, any
  navigation away from the panel would put your secret path in a `Referer` header.
- **The secret path.** Every route lives under a random 24-character path. Unmatched
  paths proxy an unremarkable upstream or return a bare 404, without RayZen's
  distinctive headers, so a scanner walking paths learns nothing.
- **Backups redact secrets.** An export carries no Trojan password, no VLESS UUID and
  no panel path, and records what it withheld. Restore writes only non-secret keys.
- **Failed logins are counted, never described.** The recorded event carries a boolean
  and nothing else: no username, no IP, no timestamp finer than the UTC day. A log of
  who tried and when would be a record of your habits, and under a guessing attack it
  would be an attacker-controlled write amplifier.
- **Observability is off by default.** The relay logs per-connection information, so
  enabling Workers Logs on a live deployment records where your users connected. Turn
  it on deliberately and temporarily.

## The first-run claim window

A deployment made with the Deploy to Cloudflare button generates its own credentials
and serves a one-time setup page. Between the deploy finishing and someone completing
that page, whoever reaches it first becomes the administrator.

In practice the window is the seconds between Cloudflare finishing and you clicking
through, and nobody else knows the address yet. If you need the administrator identity
pinned in advance, set `RAYZEN_ADMIN_EMAIL` before opening the URL. Setup then accepts
only that address, so a claim using another address cannot produce a usable account.

Once a password exists the setup route stops existing entirely: it returns nothing, and
`/` behaves exactly as it does on any other deployment. Re-entering setup requires
deleting the `pwd` key from KV, which requires dashboard access already.

## What your deployment contacts

A privacy tool's outbound surface is part of what you are trusting, so here is the whole
list. `tests/golden/outbound.test.ts` fails the build if a host is added without being
recorded here.

| Host | When | Why |
|---|---|---|
| `api.cloudflare.com` | Only if you set `RAYZEN_CF_API_TOKEN` | Usage statistics, custom-domain setup, self-repair redeploy. Your account, your token. |
| `api.telegram.org` | Only if you configure a bot | Delivering the messages the bot sends, with the token you supplied. |
| `api.cloudflareclient.com` | On first use of a WARP subscription | Registering the WARP accounts. Without it, WARP configs cannot be generated. |
| `cloudflare-dns.com` | DNS resolution, unless you change the resolver | The default DoH endpoint, overridable in settings. |

Nothing on that list runs on the connection path. A client relaying traffic through your
deployment triggers no outbound API call and no KV write; a subscription fetch is three
KV reads and nothing else.

**Removed in v1.1:** earlier versions asked `ip-api.com` to geo-locate addresses, in two
places. One of them POSTed your entire configured proxy-IP list, up to 100 addresses at a
time, over plain HTTP, to a service with no relationship to you. Neither call appeared in
any allowlist or in this document, because the Worker made them server-side rather than
from your browser.

Location now comes from Cloudflare's own `cdn-cgi/trace` for your deployment, and
addresses the panel cannot describe that way are reported as unknown. If you want fuller
geo data you can set `RAYZEN_GEO_ENDPOINT` to an https service you trust or run yourself;
absent that variable, no third party is contacted at all.

## Known limitations

Stated plainly, because a security document that only lists strengths is marketing.

- **Administrator passwords are stored as salted PBKDF2-SHA-256 verifiers.** The
  password rule is enforced on the Worker, not only in the browser. A successful login
  from an older deployment transparently replaces its legacy plaintext KV value with a
  100,000-iteration verifier. Valid lower-cost PBKDF2 values are upgraded the same way.
  Values above the Workers runtime ceiling fail closed with an explicit recovery state rather
  than being misreported as bad credentials.
- **There is no rate limit on login attempts.** Cloudflare's own protections sit in
  front, and the secret path means an attacker has to find the login page first, but a
  determined guesser who knows your path gets unlimited tries.
- **The endpoint scanner measures from one Cloudflare edge location**, the one serving
  the request. Its scores are honest about being one vantage point, but an endpoint
  that is clean from Frankfurt may not be clean from Tehran.
- **No signed release feed.** The panel's Update button is disabled because there is
  nothing to verify an update against. `panel/update-panel` redeploys the build the
  Worker is already running, which is a repair operation, not an upgrade. Deployments
  made with the button upgrade through git instead.
- **`workers.dev` hostnames are blocked on some networks.** Use a custom domain if
  clients cannot reach yours.
- **WARP registration is an external dependency.** RayZen registers deployment-owned
  accounts on first use. If `api.cloudflareclient.com` is unreachable, generation now
  fails closed with an actionable error; no public or shared private keys are used as a
  fallback. Retry from **Settings → WARP** when the service is reachable.
- **A shared subscription link is a bearer token, and revocation is not instant.** The
  token is 128 bits from `crypto.getRandomValues` and is compared in constant time, so it
  cannot be guessed or recovered a character at a time. But anyone holding the URL is
  authorised by holding it, so treat it like a password: send it over something private.

  Revoking takes effect on the next fetch, not immediately. A client that already holds
  the configurations keeps working until it refreshes its subscription, which is a property
  of how subscriptions work rather than of this feature. Rotating your UUID and Trojan
  password is what cuts off a client that will not refresh.
- **There are no per-link traffic quotas, and there will not be ones built on KV.**
  Cloudflare KV is eventually consistent and loses concurrent read-modify-write updates by
  design, so a quota counter under real load undercounts. A quota that undercounts fails
  *open*: it lets traffic through while telling the operator it did not. The fetch counter
  the panel shows is persisted at most hourly per link and is labelled a lower bound for
  exactly this reason.

## Supported versions

| Version | Supported |
|---|---|
| 1.1.x | Yes |
| 1.0.x | Security fixes only |
| Anything predating this project | No |
