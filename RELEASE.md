## PBKDF2 compatibility correction

Administrator password verifiers are now generated with 100,000 PBKDF2-SHA-256
iterations, the maximum accepted by Cloudflare Workers. The release detects older
verifiers above that ceiling and provides an explicit recovery response rather than
misreporting the condition as invalid credentials.

# RayZen v1.0.0

The first public release.

> This file is the body of the GitHub release published by the `release` workflow.
> Edit it when cutting a new release.

## About the version number

The panel carried internal version numbers up to 1.2.0 while it was being built in the
open. This is the release that is actually ready for someone who has never seen it, so it
is 1.0.0. Nothing was removed to get here.

Upgrading from any earlier build needs nothing beyond deploying: no settings key changed
shape, no stored document needs migrating, and your panel path, UUID and Trojan password
are untouched.

## The fix that mattered

Generated configurations imported cleanly into every client and loaded no websites, while
configurations from older panels worked on the same device. It was not TLS: SNI, ALPN,
fingerprint and the WebSocket `Host` header were all correct.

RayZen was emitting four things that only a very recent Xray core accepts, and an unknown
key inside `streamSettings` or `sockopt` fails the whole configuration rather than being
ignored — a `version.min: "26.2.6"` floor, a `mixed` local inbound (sing-box vocabulary;
Xray has no such inbound), `finalmask` fragmentation, `sockopt.happyEyeballs`, and the
Xray 25.7+ DNS-outbound rule syntax. The core never brought up a working inbound or
outbound, so the tunnel looked connected and carried nothing.

Configurations are now translated into the shape that has been stable since Xray 1.8, and
a new **Client compatibility** setting keeps the newer output available for people whose
devices all run current cores. The compatibility behavior is covered by the test suite and the generated configuration fixtures.

## What else is new

- **An installer that needs no GitHub account.** `npm run install:cloudflare` uploads the
  Worker straight to Cloudflare's API. Three narrow token permissions, no fork, no
  wrangler, and the token is never written to disk or embedded in the Worker.
- **A generated Worker name per deployment**, such as `rayzen-swift-harbor-a91f`. Earlier builds reused one fixed deployment name, which made the hostname guessable and
  created one signature across every account. Generated and custom names now reject the
  prohibited term before deployment.
- **A mobile panel where every feature is reachable.** Smart setup and Analytics had no
  entry point at all on a phone. The bottom bar now holds four destinations plus a More
  sheet, and it clears the iOS home indicator.
- **A command centre that answers what to do next.** Health, the active protocol, measured
  latency, the selected endpoint, traffic, and the highest-impact recommendation now share
  one deliberate overview instead of a sparse set of status cards.
- **Actionable diagnostics and Smart Setup.** Connection, DNS, endpoint, configuration and
  security evidence lead to direct fixes. Smart Setup runs live checks, explains the basis
  of its recommendation, stages the values, and leaves the final Apply decision with the
  operator.
- **A device-owned Clean IP workflow.** The browser generates and measures Cloudflare
  candidates, presents latency, success, reliability and test time, and lets the operator
  select, apply or save an endpoint. Applied IPs feed the same `cleanIPs` setting used by
  generated configurations.
- **Ocean is the default theme**, and the panel picks its language from the browser on
  first load while still remembering an explicit choice.

## Install

```bash
# with a GitHub account: use the Deploy to Cloudflare button in the README
# without one:
npm ci && npm run build && npm run install:cloudflare
```

Then open the address it prints, set your email and password, and save the panel link. It
contains a secret path shown exactly once.

## Verified

The hardened artifact passes 133 authenticated user-flow checks and 51 clean-deployment
checks. Every application view was exercised at desktop, 390×844 and 412×915 with no
horizontal overflow, console errors or page exceptions. Bundle size remains inside the
release budget.

The standard dependency-backed type/unit/build commands could not be reproduced in the
audit sandbox because its npm mirror did not contain the locked dependency graph. A live
Cloudflare account deployment and imports into every third-party client remain external verification items.
