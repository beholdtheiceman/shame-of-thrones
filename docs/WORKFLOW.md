# Engineering Workflow

## Branch model

- Never commit directly to `main`.
- Work happens on a feature branch → open a PR → CI (see `.github/workflows/ci.yml`)
  must be green → merge.
- Merging to `main` triggers a Vercel deploy of `main` to **production**.
- Vercel also builds a **preview deploy automatically for every PR branch** —
  use it to sanity-check a change before merging, no extra steps needed.

## Databases (CRITICAL)

The Neon project `shame-of-thrones` has three branches:

| Neon branch | Role                          | Used by                              |
|-------------|-------------------------------|---------------------------------------|
| `main`      | **PRODUCTION** (db `neondb`)  | the live app (Vercel prod deploy)     |
| `dev`       | local development              | `apps/web/.env.local`                 |
| `test`      | automated tests                | `apps/web/.env.test` (vitest)         |

**`apps/web/.env.local` MUST point at the `dev` branch — never at `main`/prod.**
`.env.test` points at `test`.

> ⚠️ **Historically `.env.local` pointed at prod.** That meant local
> `db:migrate`, `db:seed`, `seed:reset`, and `seed:city` runs were hitting
> **PRODUCTION** data. Do not let that happen again — always check which
> branch `.env.local` resolves to before running any local DB command.

Any command that must intentionally target prod should pass `DATABASE_URL`
explicitly on the command line and be run deliberately, e.g.:

```
DATABASE_URL=<prod-connection-string> npm run db:migrate
```

## Migrations

- After a schema change: `npm run db:generate` (Drizzle generates the migration
  files).
- Apply locally: `npm run db:migrate` — this targets whatever `.env.local`
  points at, which should be the `dev` branch.
- Apply to prod **deliberately**, as its own step, before merging code that
  depends on the new schema:
  ```
  DATABASE_URL=<prod-connection-string> npm run db:migrate
  ```
- Apply to the `test` branch too — the test suite runs against real schema,
  not an in-memory stand-in:
  ```
  DATABASE_URL=<test-connection-string> npm run db:migrate
  ```
- Drizzle tracks which migrations have already run in the
  `drizzle.__drizzle_migrations` table (per branch/database).

## Deploy

- Merging to `main` deploys to production via Vercel.
- **There is no migrate-on-deploy step.** If a PR's code depends on a schema
  change, apply that migration to prod *before* merging — otherwise prod will
  serve code against a stale schema.

## Branch protection

Not yet enabled — set this up in GitHub's web UI (the `gh` CLI isn't
installed locally):

1. GitHub → repo → **Settings → Branches → Add branch ruleset** (or "Add
   rule" on the classic branch-protection screen) targeting `main`.
2. Require a pull request before merging (no direct pushes).
3. Require the CI status check (`CI / checks`, from `.github/workflows/ci.yml`)
   to pass before merging.
