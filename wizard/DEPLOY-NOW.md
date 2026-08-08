# RayZen Vercel Wizard — fixed release

Deploy this directory as the Vercel project root for `rayzen.bond`.

## Important

Do not replace only `app.js`. The deployment API and bundled Worker artifact must match this frontend.

This package removes the obsolete RayZen Setup Token phase and contains the TDZ-fixed Worker artifact.

## Verification after production deployment

1. Open `https://rayzen.bond/app.js`.
2. Confirm these strings are absent:
   - `Securing first-time setup`
   - `setupProtected`
   - `current === 'secret'`
3. Start a brand-new deployment.
4. The created Worker URL must NOT contain `#setup=`.
5. Delete any Workers previously created by the obsolete Wizard before retesting.
