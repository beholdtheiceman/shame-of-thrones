# Runbook: Closed Beta Go-Live (Raleigh)

Checklist to take the Raleigh closed beta live in production.

## a. Fix local tooling first

`@esbuild/win32-x64` is missing on this machine, so `tsx`-based scripts
(`db:seed`, `seed:city`, `seed:reset`, `invites:generate`) fail to run
locally. Fix before running any of the seeding steps below:

- Simplest: delete `node_modules` and run `npm install` again to let npm
  resolve and install the correct optional platform binary.
- Or targeted: install the matching `@esbuild/win32-x64` version directly
  under `node_modules/tsx/node_modules/esbuild` (match the esbuild version
  tsx depends on).

Verify by running any `tsx`-backed script with `--dry-run` first (e.g.
`seed:city` supports `--dry-run`) before touching real data.

## b. Confirm the realm center is Raleigh — and deployed

This PR changes `packages/core/src/data.ts` (`REALM_NAME`, `REALM_CENTER`)
to Raleigh downtown. Confirm it's merged to `main` and the resulting Vercel
prod deploy is live before proceeding — the map center and seeded fiefs need
to agree.

## c. Seed production

`.env.local` now points at the `dev` Neon branch (not prod — see
`docs/WORKFLOW.md`), so seeding prod requires passing `DATABASE_URL`
explicitly and deliberately:

```
DATABASE_URL=<prod-connection-string> npm run seed:reset --workspace apps/web -- --yes
```

This wipes demo thrones/ratings but **preserves real users**.

```
DATABASE_URL=<prod-connection-string> npm run seed:city --workspace apps/web -- --city raleigh
```

This seeds real Raleigh throne data (Refuge + OSM sources) into the
`raleigh` bbox from `apps/web/src/db/cityBbox.ts`.

## d. Verify invites

500 invite codes were already generated into `apps/web/invites-raleigh.txt`
and inserted into prod under cohort `raleigh-beta`. Before flipping the gate,
verify the count actually landed in prod (query the invites table filtered
to that cohort, or re-run the invite listing tool against
`DATABASE_URL=<prod-connection-string>`) — don't assume the earlier insert
succeeded.

## e. Flip the beta gate

In Vercel prod env vars, set:

```
BETA_INVITE_REQUIRED=true
```

Then redeploy prod (env var changes require a redeploy to take effect).
This gates signup to invitees only.

## f. Smoke test

Once deployed:

1. Sign in using one unused invite code from `invites-raleigh.txt`.
2. Rate a throne (confirm a real Raleigh throne appears on the map, not a
   leftover NYC one).
3. Check Standings to confirm the new rating shows up.

## Notes

- Seeding must always target prod's `DATABASE_URL` explicitly now that
  `.env.local` defaults to `dev` — never rely on the default env file for a
  prod seeding command.
- Run `seed:reset` before `seed:city` — reversing the order will not wipe the
  data you just seeded.
