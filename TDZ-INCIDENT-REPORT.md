# RayZen setup TDZ production incident — root-cause report

Date: 2026-08-08

## Executive finding

The browser error `ReferenceError: Cannot access 't' before initialization` is a **client-side lexical TDZ introduced by identifier mangling in the first-run setup form handler**. It is not caused by localization, event timing, the Cloudflare Worker module graph, or the separately discovered `settings -> kv -> settings` import cycle.

`t` is not a RayZen source identifier. It is a minifier-generated name that was historically reused for two distinct lexical bindings in nested scopes:

- outer response-body binding: `setupResponseText`
- nested HTML-document binding: `setupDocument`

The pre-workaround source dependency was equivalent to:

```js
const setupResponseText = await setupResponse.text();
...
if (!isJson) {
  const setupDocument = new DOMParser().parseFromString(setupResponseText, 'text/html');
}
```

The bad historical rename made the nested branch semantically equivalent to:

```js
const t = await setupResponse.text();
...
if (!isJson) {
  const t = new DOMParser().parseFromString(t, 'text/html');
}
```

Inside the initializer of the nested `const t`, JavaScript lexical resolution selects the new inner binding, not the outer one. That inner binding exists but is still uninitialized, so evaluating the right-hand `t` throws exactly:

`ReferenceError: Cannot access 't' before initialization`

This is reproduced by `npm run incident:repro-legacy-tdz`.

## Responsible source

Historical setup path:

- `src/assets/setup/script.js`
- first-run `setupForm` submit handler
- response-body declaration corresponding to the uploaded workaround source around line 65
- nested `DOMParser().parseFromString(...)` declaration corresponding to line 76

The original uploaded ZIP already contains an admission of the earlier incident in `scripts/build.js`: the setup page was intentionally excluded from Terser mangling because a previous Terser rename reused a `const` name in the submit `try` block. The uploaded `src/assets/setup/script.js` was then converted to function-scoped `var` as a second protection. Those were symptom suppressions, not an architectural correction.

## Why it only occurred on this setup path

The dangerous nested declaration was reached only when the setup claim returned a **non-JSON response**. The normal JSON success path never evaluated the nested HTML parsing block. This explains why the application could appear healthy until setup received an HTML/error response.

The stack identifies an `HTMLFormElement`, so the exception is unequivocally in the inline browser setup script. A Worker-side TypeScript import cycle cannot produce that DOM event-handler frame.

## What was ruled out

- **Circular browser modules:** the setup page is an inline classic script, not an ES module graph.
- **Worker circular imports:** the previously present `settings -> kv -> settings` cycle has been removed, and the current graph contains 96 TypeScript modules with zero static import cycles. It is a separate correctness fix, not this browser error.
- **Localization:** the setup handler does not call the panel translation function. The failing lexical dependency is response parsing.
- **Theme initialization:** setup does not depend on the panel theme state.
- **Event timing / closure capture:** the submit event fires correctly; the failure occurs during evaluation of a lexical initializer inside the handler.
- **Top-level lazy initialization:** the trigger is the non-JSON response branch after the request has completed.
- **Duplicate source declarations:** the source names are distinct; the collision appeared after identifier mangling.

## Why prior fixes failed

Two previous mitigations hid the problem without correcting the structure:

1. `scripts/build.js` special-cased setup and skipped Terser mangling.
2. `src/assets/setup/script.js` changed submit-path lexical declarations to `var` because `var` cannot enter a lexical TDZ.

Both depended on preventing the minifier from encountering the dangerous lexical structure. A future build-pipeline change could re-enable the same class of failure. The earlier hotfix attribution to the Worker `settings/KV` cycle was also incorrect for this specific browser stack.

## Permanent source refactor

`src/assets/setup/script.js` now has explicit responsibilities:

- `parseSetupJson(responseText)` — JSON decoding
- `readServerError(responseText, status)` — HTML error extraction
- `claimSetup(email, password)` — fetch and response classification
- `renderSetupComplete(result)` — successful UI transition
- `handleSetupSubmit(event)` — validation, button state, orchestration only

The submit handler no longer owns nested response-parser lexical scopes. In the minified release artifact it reduces to an orchestration function in which `t` is only the password parameter/local and response decoding occurs in separate functions. There is no nested declaration that can shadow the response body while using it in its own initializer.

## Build-pipeline correction

`scripts/build.js` now:

- gives browser JavaScript exactly one transform/minification owner;
- never passes an already-minified inline script through a second JS transform;
- supports `development`, `production`, `minified`, and `sourcemap` modes;
- emits `//# sourceURL=rayzen-<page>.js`, so a future browser stack names the asset instead of only `(index)`;
- emits source maps and source copies in the forensic build;
- fingerprints setup source and generated page script;
- derives `data-rayzen-setup-build` from the setup source SHA-256 instead of a handwritten date string;
- writes `dist/build-manifest.json` with the exact Worker/setup fingerprints.

The Wizard no longer hardcodes a setup marker. It reads the marker from the SHA-pinned artifact manifest and verifies the deployed Worker serves that exact marker. This makes stale/different deployment artifacts detectable.

## Source-map evidence

The new forensic map is:

`dist/forensics/setup.min.js.map`

It names the original source explicitly:

`src/assets/setup/script.js`

Examples from the generated map:

- minified `parseFromString` -> `src/assets/setup/script.js:29:45`
- minified setup `fetch` -> `src/assets/setup/script.js:36:27`
- minified `RayZen setup failed:` logging site -> `src/assets/setup/script.js:85:22`

The exact historical production bytes that produced `(index):1:40408` are **not contained in the uploaded ZIP**. The uploaded artifact's embedded setup script is 125 lines and already uses the old `var` workaround, while the reported stack is from a one-line minified page. Therefore claiming a byte-exact source-map mapping for historical column 40408 from this ZIP would be fabricated. A reconstruction places that column in the same non-JSON `DOMParser.parseFromString` region, but it is not treated as a byte-identical production map.

Artifact evidence:

- uploaded Worker SHA-256: `e287a8ad812e145b3bf90d4c41f423b238d17f32dae6a58325f1e8363b10f9ed`
- uploaded embedded setup script: 5,671 bytes / 125 lines
- corrected prebuilt Worker SHA-256: `69024b7e8f05ff5e9eaf5a6b100b3de7dabdd91c258a499bc040a216bbefa8bd`
- corrected embedded minified setup script SHA-256: `0b24ce55ff177eab1b76f5cc1b5b250748d2a6237d7c004f78a1c3e85c6ab519`
- corrected setup marker: `rayzen-setup-6df08e2d78a47eb1`

## Verification performed

### Historical mechanism

`node scripts/incident-repro-legacy-tdz.js`

Result:

`ReferenceError: Cannot access 't' before initialization` reproduced as expected from the historical nested-name collision.

### Corrected browser runtime

The corrected setup script was identifier-minified and executed in Chromium 144 in eight separate isolated browser contexts (new context per case):

- desktop / JSON success
- desktop / HTML error
- desktop / malformed JSON
- desktop / JSON application error
- mobile / JSON success
- mobile / HTML error
- mobile / malformed JSON
- mobile / JSON application error

Result: 8/8 passed; no TDZ or `ReferenceError`.

### Corrected shipped Worker

- setup browser regression: PASS
- setup-claim regressions: 10/10
- one-click deployment flow: 51/51
- PBKDF2 compatibility/migration: 14/14
- full packaged Worker flow: 133/133
- Wizard tests: 21/21
- TypeScript static module graph: 96 modules, 0 cycles
- lexical AST audit: 198 JS/TS files, no direct self-initializing `let`/`const` binding
- documentation links: 56 files / 77 relative links / 0 broken
- design-token audit: PASS

The setup page itself has no English/Persian or light/dark state machine; those axes belong to the authenticated panel. Existing panel i18n/theme regression coverage remains intact, while the setup incident matrix covers both desktop and mobile execution.

## Environment limitation

The sandbox cannot resolve `registry.npmjs.org`, so it could not install the package-locked esbuild 0.28.1 and execute `npm run verify:tdz-build-matrix` end-to-end here. The repository now includes that release gate so CI/release infrastructure with dependencies installed runs the exact esbuild development/minified/source-map matrix.

For local browser stress verification in this sandbox, the setup script was additionally minified with the Terser implementation available in the runtime—the same minifier family implicated by the historical source comment—and the corrected prebuilt artifact was exercised in Chromium. The production source pipeline itself is esbuild-only.

Live `rayzen.bond` deployment was not modified or smoke-tested because no Vercel/Cloudflare project credentials are connected in this environment. The Wizard artifact is SHA-pinned and internally synchronized, but production promotion still requires the real deployment account.

## Files materially changed for this incident

- `src/assets/setup/script.js`
- `src/assets/setup/index.html`
- `scripts/build.js`
- `scripts/setup-tdz-regression-test.js`
- `scripts/incident-repro-legacy-tdz.js`
- `scripts/lexical-tdz-audit.js`
- `scripts/setup-browser-flow-test.js`
- `scripts/sync-wizard-artifact.js`
- `wizard/lib/deployment.js`
- `wizard/artifacts/manifest.json`
- `wizard/artifacts/worker.js`
- `tests/golden/setup-page.test.ts`
- `wizard/tests/api-flow.test.mjs`
- `wizard/tests/static.test.mjs`
- `src/settings/load.ts` (diagnostic attribution corrected)
- `CHANGELOG.md`
- `package.json`

## Why this specific failure cannot recur through the same mechanism

The old failure required all three conditions simultaneously:

1. response text held in an outer lexical binding;
2. an inner lexical declaration in the non-JSON block initialized itself using that outer value;
3. the minifier reused the outer short name for that inner declaration.

Condition 2 no longer exists. HTML parsing is in `readServerError(responseText, status)`, a separate function whose parameter and local document-node value share one flat function scope. The submit handler does not parse response bodies at all. Even aggressive identifier reuse in another function cannot change lexical resolution across function boundaries.

In addition, the executable minified regression covers the exact HTML-error branch, and the artifact/source hashes prevent the Wizard from silently deploying a different setup build.
