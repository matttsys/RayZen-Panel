# Contributing

Thanks for considering it. Bug reports are the most useful thing you can send,
especially ones that name the subscription variant and the client you were using.

## Setting up

Node.js 20.10 or later.

```bash
npm ci          # ci, not install: keeps the lockfile honest
npm run check   # TypeScript, strict
npm test        # unit and golden tests
npm run build   # writes dist/worker.js
npm run size    # bundle budget, enforced
npm run preview # serves the built Worker locally on an in-memory KV
```

`npm run preview` is the one to reach for while working on the panel: it runs the real
built artifact against a fake KV, so you can click through everything without
deploying. Other scripts you may want: `npm run deploy:check`
(`wrangler deploy --dry-run`), `npm run test:deploy-flow` (drives the build artifact through
the one-click deployment flow, from an empty KV to a working panel),
`npm run test:flow` (the same for a packaged artifact), `npm run check:doc-links`, and
`npm run package` (bakes a fixed identity for the advanced deploy path).

## Things that look wrong and are not

Before you "fix" one of these, please read why it is that way. Each has a comment at
the source explaining it, and each was a real bug at some point.

- **The five inherited KV key names** (`proxySettings`, `warpAccounts`, `telegramBot`,
  `pwd`, `secretKey`) are defined once in `KV_KEYS` in `src/storage/storage.ts` and
  cannot change. Renaming one orphans a live deployment's data silently. A test pins
  them. RayZen's own keys are prefixed `rz:` for exactly this reason.
- **`padCode()`** prepends hundreds of unreachable declarations to every uploaded
  script. Without it, two deployments of the same build upload byte-identical code,
  which is a fingerprint. It is signature resistance, not dead weight.
- **`EMBEDED_SETTINGS` still wins over KV** in `src/settings/identity.ts`. It looks
  like legacy precedence and it is deliberate: an existing packaged deployment
  upgrading to a new build must keep the exact panel path and credentials it has
  already handed out.
- **The bundle prelude shape** is a contract. The panel's self-update reads
  `SOURCE_CONTENT` out of it.
- **`no_bundle: true`** in `wrangler.jsonc`. Letting wrangler re-bundle adds 56 KB of
  esbuild wrappers and means the deployed script is not the artifact the size budget
  measured.

## Code style

- TypeScript, strict. `npm run check` must pass.
- No `any` in new code. A missing type annotation is what let a request without a
  `password` field reach `kv.put(key, undefined)` and surface as a 500 instead of a
  400.
- Use the path aliases in `tsconfig.json` (`@common`, `@settings`, `@identity`,
  `@storage`, `@handlers/*`, `@cores/*`, `@api/*`, `@platform/*`, `@features/*`,
  `#types/*`, and the rest). New code goes under an existing alias unless there is a
  real reason not to.
- The frontend has **no inline event handlers** and no third-party assets. Every page
  ships a strict CSP whose script and style hashes are computed at build time. Adding
  an external origin means a security review and a test update, and the origin budget
  in `tests/golden/icon-subset.test.ts` is a ratchet: it can shrink, not grow.
- Security headers are applied once, in `src/worker.ts`. A new route inherits them.
  Do not bypass the wrapper.
- Comments explain **why**, not what. If a line needs a comment saying what it does,
  rename something instead.

## Tests

- `tests/unit/` is where most tests live. New behaviour needs tests; a bug fix needs a
  test that would have caught it.
- `tests/golden/` pins subscription output across 14 targets and 12 profiles, plus the
  brand assets and the icon subsets. If you touch `src/cores/`, run the suite before
  you do anything else: the fixtures will tell you exactly what you changed.
- Updating a golden fixture is fine when the change is intended. Updating one without
  reading the diff is not.
- `npm run test:deploy-flow` drives the build artifact through the whole one-click
  flow: empty KV, bootstrap, setup page, claim, sign in, generate a subscription, and a
  cold start that must not regenerate the identity. It is the net under the path most
  users take.
- `npm run test:flow` does the same for a packaged, pinned-identity artifact.

## Pull requests

1. Open an issue first, or link to one. It saves us both from a PR that was never going
   to be merged.
2. One logical change per PR.
3. Run the gate before pushing:

   ```bash
   npm run check && npm run check:doc-links && npm test && \
   npm run build && npm run size && npm run deploy:check
   ```

4. CI runs the same gate. A red check blocks the merge.
5. Do not bump the version in a feature PR. Releases are cut from `main`.

## Reporting a bug

Use the [issue templates](.github/ISSUE_TEMPLATE). A good bug report has the panel
version, the client and its version, the subscription variant, what you expected and
what happened. If a config does not connect, the client's log is worth more than a
description of the log.

Security issues go through [`SECURITY.md`](SECURITY.md), not the issue tracker.

## Documentation

If you change user-facing behaviour, update the README or the relevant guide under
`docs/` in the same PR. `npm run check:doc-links` catches broken relative links, and
CI runs it, so a moved file fails the build rather than a reader's click.
