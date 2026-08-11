# RayZen Companion integration contract

RayZen Panel is authoritative for Worker identity, authentication, settings validation, health, diagnostics and configuration application. RayZen Companion connects directly to the operator-owned Worker over HTTPS.

## Base URL

The operator supplies a Worker URL containing the private Panel path:

```text
https://<worker-host>/<securePath>/
```

Companion must preserve the origin and `securePath` for all API calls. Plain HTTP is unsupported outside local development.

## Response envelope

Panel JSON responses use this shape:

```json
{
  "success": true,
  "status": 200,
  "message": null,
  "body": {}
}
```

Clients must check both the HTTP status and `success`. Unknown response fields must be ignored.

## Discovery

`GET panel/version` is public and returns the running product version and API capabilities.

```json
{
  "product": "RayZen Panel",
  "version": "1.1.0",
  "companionApi": 1,
  "capabilities": {
    "authentication": true,
    "health": true,
    "diagnostics": true,
    "settings": true,
    "usage": "conditional",
    "profiles": true,
    "scanner": true,
    "scannerApply": true
  }
}
```

Companion must verify `product` and a supported `companionApi` before saving a Worker. Write actions remain disabled when `scannerApply` is absent.

## Authentication

`POST login/authenticate`

```json
{
  "username": "owner@example.com",
  "password": "operator password"
}
```

On success, the Worker sets `jwtToken` as an `HttpOnly`, `Secure`, `SameSite=Strict` cookie and returns:

```json
{
  "user": { "email": "owner@example.com" },
  "panelVersion": "1.1.0",
  "expiresIn": 86400
}
```

Companion stores the cookie in its encrypted per-Worker session store. It must not parse, expose or copy the token into another request field. A `401` response clears the local session state and returns the Worker to signed-out status.

`GET panel/logout` invalidates the cookie.

## Read endpoints

All endpoints below require the session cookie.

| Endpoint | Contract |
| --- | --- |
| `GET panel/settings` | Settings, Telegram state, subscriptions, clients and password status. |
| `GET panel/usage` | `{ available, total, worker }`; counts are nullable when unavailable. |
| `GET panel/platform/health` | Weighted health score, grade and findings. |
| `GET panel/platform/advanced/diagnostics` | Redacted deployment, diagnostics, feature and scanner detail. |
| `GET panel/platform/metrics` | Panel action metrics and statistics; not Cloudflare request usage. |
| `GET panel/platform/profiles` | Optimization profiles supported by the Worker. |
| `GET panel/platform/scanner/history?kind=clean-ip&limit=<n>` | Stored Worker-side scan runs and intelligence summary. |

Cloudflare request usage is conditional on account metadata and an API token being configured on the Worker. `available: false` means unknown, not zero.

## Applying a Companion scanner result

`POST panel/platform/scanner/apply`

```json
{
  "address": "1.1.1.1",
  "mode": "replace"
}
```

`mode` is optional and may be `replace` or `append`. The endpoint:

- accepts one IP address or hostname without a port;
- caps the final list at 40 entries;
- loads the latest settings from the Worker;
- validates the complete resulting settings document;
- writes only the `cleanIPs` change;
- records the settings update in Panel history.

Success returns the authoritative list and whether it changed:

```json
{
  "cleanIPs": ["1.1.1.1"],
  "changed": true
}
```

Companion must not emulate this action by reading `panel/settings` and sending the full document to `panel/update-settings`; doing so can overwrite a concurrent operator change.

## Security and compatibility

- Use HTTPS certificate validation supplied by the Android platform. Do not add trust-all TLS handling.
- Store credentials and cookies in Android Keystore-backed encrypted storage.
- Treat endpoint bodies as bounded untrusted input and surface Panel messages without rendering HTML.
- Feature-detect optional capabilities. A breaking contract requires a new `companionApi` level or a new versioned route.
- Scanner measurements occur locally in Companion. Panel stores only a selected address when the operator confirms Apply.
