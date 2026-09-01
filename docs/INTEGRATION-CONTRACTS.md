# RayZen Companion integration contract

`companionApi: 2`. This document describes what the code in `src/handlers/panel.ts` and
`src/api/platform.ts` actually does. Where the two disagree, the code is right and this
file is a bug.

There is no v1 compatibility path. The Panel has never been released, so v2 replaced v1
in place rather than being added beside it.

## Base URL

Everything is under the deployment's secure path:

```
https://<host>/<securePath>/...
```

`securePath` is 3–128 characters of `[A-Za-z0-9_-]`. The Companion parses it out of the
panel URL the operator pastes, which must end in `/<securePath>/panel`.

## Response envelope

Every JSON route answers with the same shape:

```json
{ "success": true, "status": 200, "body": { } }
```

On failure `success` is `false`, `status` carries the HTTP status, and `message` carries a
sentence fit to show a person. Some failures also carry a `body` with machine-readable
detail — a rejected apply, for instance, returns the rejected entries there even though
the call failed.

## Discovery

`GET /<securePath>/panel/version` — unauthenticated.

```json
{
  "product": "RayZen Panel",
  "version": "1.1.0",
  "companionApi": 2,
  "capabilities": {
    "authentication": true,
    "health": true,
    "diagnostics": true,
    "settings": true,
    "usage": "conditional",
    "profiles": true,
    "scanner": true,
    "scannerApply": true,
    "scannerApplyBatch": true,
    "scannerCustomRange": true,
    "subscriptionUrls": true,
    "presets": true,
    "cleanIps": true,
    "cleanIpManagement": true,
    "modes": true,
    "trafficMetrics": true
  }
}
```

The Companion refuses to save a Worker unless `product` is `RayZen Panel`,
`companionApi` is 2, and every capability it needs is `true`. The set it requires is in
`RequiredCapabilities` in `app/src/main/java/app/rayzen/companion/network/RayZenApi.kt`.

`usage` is `"conditional"` because Cloudflare's account usage API needs a token the
deployment may not hold. `GET /<securePath>/panel/usage` returns
`{ "available": false }` in that case rather than failing.

`GET /<securePath>/panel/settings` distinguishes a claimed deployment from an unclaimed
one: `isPassSet` is true once an administrator password exists.

## Authentication

`POST /<securePath>/login/authenticate` with `{ "username", "password" }`. On success the
response sets a `jwtToken` cookie and the body carries `user.email`. The Companion checks
that the returned email matches the account it signed in as, and sends the cookie on every
later call.

`GET /<securePath>/panel/logout` invalidates the session.

Redirects are never followed. TLS is always verified.

## Read endpoints

All authenticated.

| Route | Returns |
| --- | --- |
| `panel/platform/health` | Diagnostic report with `score` and a `checks` array |
| `panel/platform/metrics` | Daily counter series and derived statistics |
| `panel/metrics` | Hourly traffic: bytes, requests, hourly buckets, peak period |
| `panel/platform/scanner/history?kind=clean-ip&limit=1` | Recent scan runs and the best endpoint of each |
| `panel/platform/scanner/candidates?kind=…&count=…[&range=…]` | Addresses to probe |
| `panel/platform/clean-ips` | The stored clean-IP list and its ceiling |
| `panel/platform/modes` | The mode selections and the options each accepts |
| `panel/platform/subscriptions/urls` | Every published subscription address |
| `panel/platform/links` | Subscription profiles and their counters |
| `panel/platform/presets` | Available presets |
| `panel/usage` | Cloudflare request counts, when the token allows it |

### `panel/metrics`

```json
{
  "bytesDownloaded": 148213,
  "bytesUploaded": 9042,
  "requests": 412,
  "requestsToday": 88,
  "requestsThisHour": 12,
  "hours": [{ "hour": "2026-06-02T14", "requests": 12, "bytesDown": 40122, "bytesUp": 900 }],
  "byHourOfDay": [0, 0, 3, "…24 entries…"],
  "peakPeriod": { "fromHour": 19, "toHour": 21, "requests": 190, "share": 0.46 },
  "pending": 4
}
```

Buckets are UTC hours, retained for seven days. `bytesDownloaded` is bytes sent to
clients; `bytesUploaded` is bytes received from them. WebSocket payloads are not counted —
the runtime relays them outside the request path — and neither are request bodies sent
without a `Content-Length`. `pending` is the count still held in isolate memory.

Counters are accumulated in memory and flushed to KV at most once per five minutes or per
fifty requests, whichever comes first, because the free plan allows roughly a thousand KV
writes a day. `DELETE panel/metrics` clears the series.

## Applying scanner results

`POST panel/platform/scanner/apply`

```json
{ "addresses": ["104.16.0.1", "172.64.0.5"], "mode": "replace" }
```

`addresses` may be any length; the bounds are a 64 KB body and a 1,000-entry stored list.
`mode` is `replace` or `append`. `{ "address": "…" }` is accepted as a one-entry shorthand.

Every entry is validated as a published Cloudflare IPv4. Acceptance is partial:

```json
{
  "accepted": 2,
  "acceptedAddresses": ["104.16.0.1", "172.64.0.5"],
  "rejected": [{ "address": "8.8.8.8", "reason": "outside-published-cloudflare-ranges" }],
  "cleanIPs": ["104.16.0.1", "172.64.0.5"],
  "changed": true
}
```

Reasons are `duplicate`, `not-an-ipv4-address`, `outside-published-cloudflare-ranges` and
`not-a-string`. A call in which nothing was accepted returns 400 with the same `rejected`
array in `body`.

The write goes through the settings validators and touches only `cleanIPs`.

## Clean-IP management

`GET panel/platform/clean-ips` → `{ "cleanIPs": [...], "max": 1000 }`

- `PUT` with `{ "cleanIPs": [...] }` stores the list verbatim. Order is preserved, so add,
  delete and reorder are all one call and one KV write.
- `POST` with `{ "addresses": [...] }` appends.
- `DELETE` with `{ "addresses": [...] }` removes those entries.

Hostnames are accepted here, unlike `scanner/apply`: an operator's clean list legitimately
carries CDN hostnames, and only the scanner claims to have measured a Cloudflare address.

## Custom range scanning

`GET panel/platform/scanner/candidates?kind=clean-ip&count=50&range=104.16.0.0/16`

The range must be fully contained in Cloudflare's published IPv4 list and its prefix
between /8 and /31. An overlapping prefix is refused rather than clipped. Failures return
400 with `body.reason` set to `malformed`, `prefix-out-of-range` or
`outside-published-ranges`.

```json
{
  "kind": "clean-ip",
  "range": "104.16.0.0/16",
  "withinPrefix": "104.16.0.0/13",
  "hosts": 65534,
  "candidates": ["104.16.12.7", "…"],
  "blocks": ["104.16.12.0/24", "…"],
  "total": 50
}
```

The Companion's own scanner measures on the device and applies the same containment rule
locally, so a hostile or stale range cannot turn it into a general port scanner.

## Mode switching

`GET panel/platform/modes`

```json
{
  "modes": [
    { "field": "proxyIpMode", "value": "proxyip",
      "options": [{ "id": "proxyip", "label": "Proxy IP" }, { "id": "prefix", "label": "Address prefix" }] },
    { "field": "fragmentMode", "value": "low",
      "options": [{ "id": "custom", "label": "Custom" }, { "id": "low", "label": "Low" },
                  { "id": "medium", "label": "Medium" }, { "id": "high", "label": "High" }] }
  ]
}
```

`POST` with any subset of those fields. An unknown value is a 400 and writes nothing. The
two fields live in different KV documents — `proxyIpMode` in `rz:identity`, `fragmentMode`
in `proxySettings` — and the handler writes each to its own, which is why a value saved
here reads back correctly on the next request.

## Presets

`POST panel/platform/presets/preview` with `{ "id" }` returns a patch. The Companion merges
that patch into the settings it already read and submits the whole document to
`PUT panel/update-settings`, so every preset change is validated by the same validators as
a manual edit.

## Subscription addresses

`GET panel/platform/subscriptions/urls[?token=…]` returns one entry per format and core
with `type`, `core`, `label`, `clients`, `path`, `url`, and `importUrl` for sing-box
profiles. The Companion renders each as a row with its own copy and share actions.

## Sync path

One direction at a time, and one place to fail:

1. **Pull.** `WorkerRepository.sync` stores a snapshot from `health`,
   `platform/metrics`, `scanner/history`, `version`, `usage` and `panel/metrics`. The
   traffic object is kept in the snapshot payload, which is what the home-screen widget
   reads; it never makes a network call of its own.
2. **Pull, detail screen.** `WorkerRepository.panelState` signs in once and reads
   `clean-ips`, `modes`, `subscriptions/urls` and `panel/metrics` together. Each field is
   nullable, so a Panel that cannot serve one part still yields the rest and the screen
   says which part is missing.
3. **Push.** `applyEndpoints`, `saveCleanIps` and `setPanelMode` each write through one
   route, record a change entry locally, and return the Panel's own answer. Nothing is
   written optimistically: the UI shows what the Panel confirmed.

`WorkerEntity.lastSyncAt` is the last successful pull and is what the widget's "Synced …"
line reports.

## Security and compatibility

- HTTPS only, certificates always verified, redirects never followed.
- No route returns a password, UUID, session token or `securePath`, with one stated
  exception: `links` returns the subscription tokens the operator created, because handing
  them over is what the route is for.
- `scanner/apply`, `clean-ips` and `modes` are the only routes in the platform table that
  write settings. Everything else is a read or a preview.
- Bodies are size-checked before parsing. Lists are bounded.
- A breaking change requires a new `companionApi` level, not a quiet reshape of a route.
