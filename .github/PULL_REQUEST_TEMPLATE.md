## Summary

<!-- What changes and why. Link the issue this addresses: Fixes #123 -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Build, tooling or CI
- [ ] Refactor with no behavior change

## Verification

Gates run locally (see CONTRIBUTING.md):

- [ ] `npm run check`
- [ ] `npm run check:doc-links`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run size`
- [ ] `npm run deploy:check`

Describe anything you tested by hand (panel screens touched, subscription variants
and clients checked, deployment path exercised):

## Compatibility

- [ ] No inherited KV key was renamed (`KV_KEYS` in `src/storage/storage.ts`:
      `proxySettings`, `warpAccounts`, `telegramBot`, `pwd`, `secretKey`).
- [ ] Identity resolution still prefers an embedded `EMBEDED_SETTINGS` block over KV,
      so an existing packaged deployment keeps its panel path and credentials.
- [ ] The bundle prelude shape is unchanged, or the change is described below.
- [ ] No secret-bearing file (`dist/worker.deploy.js`, tokens, `.env`) is included.
- [ ] No third-party font, script or origin was added; if `connect-src` changed, the
      CSP tests were updated.

## Notes for reviewers

<!-- Anything reviewers should look at first, or known gaps. -->
