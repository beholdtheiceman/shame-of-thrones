# Phase 5 — Ship Phase 4 (mobile) to production

**Date:** 2026-07-14
**Branch:** `feat/phase5-ship-mobile` (off `feat/phase4-foundation`)
**Status:** Design approved; implementation plan next.

## Goal

Get the already-built React Native + Expo mobile app **live in production**. Phase 4
built all three mobile sub-projects (native auth, map + rating loop, retention + push)
and pushed them to `origin/feat/phase4-foundation`, but nothing is merged or deployed.
This phase is a **launch**, not a feature build: de-risk the ship, make the owner-only
steps turnkey, and execute the production cutover safely.

## Verified starting state (checked 2026-07-14 via the owner's browser + git)

| # | Ship blocker | Status |
|---|--------------|--------|
| 1 | Vercel Root Directory → `apps/web` | **Done** ("include files outside root" also enabled) |
| 2 | `GOOGLE_NATIVE_CLIENT_IDS` on Vercel | **Missing** from project env vars |
| 3 | `NATIVE_JWT_SECRET` on Vercel | **Missing** from project env vars |
| 4 | Mapbox tokens | **Missing** — `app.json` still holds `REPLACE_WITH_MAPBOX_SECRET_DOWNLOAD_TOKEN`; no runtime public token |
| 5 | Expo/EAS `projectId` + build config | **Missing** — no `eas.json`, no bundle identifiers, no `projectId` in `app.json` |
| 6 | Prod Neon migration `0006_push-tokens` | **Unverified** — must confirm, then apply |
| 7 | **Production-branch conflict** | **The real blocker** (below) |

**Blocker #7 in detail.** Root Directory = `apps/web` is now incompatible with the
production branch (`feat/phase0-backend`), whose code lives at the repo root. A fresh
phase-0 commit can no longer build (Vercel runs `next build` at the root, finds no
`app/` dir, exits 1 — this is the observed 13s build error). Production is currently
surviving on a **rollback redeploy of an older build** (`3tZ76Cjpg`). Nothing about
mobile ships until the monorepo branch *becomes* production.

**Reality of the split of work.** ~70% of this phase is owner-only ops that cannot be
automated from here (creating Google OAuth clients, obtaining Mapbox/Expo tokens,
applying the prod migration, real-device QA). Claude's contribution is the ~30% that is
code/config plus a precise runbook and QA checklist that make the owner steps turnkey
and the ship non-blind.

## Decision: production-branch strategy

**Consolidate onto `main`.** Every phase so far has stacked onto `feat/phase0-backend`;
`main` has languished as the old prototype. Merging the monorepo is the natural moment to
make `main` the real production branch again. The risky cutover is sequenced **last**,
after the monorepo is proven to build and deploy as a preview.

Rejected alternatives: merging into `feat/phase0-backend` (keeps a `feat/` branch as
permanent prod — the existing smell persists); repointing Vercel to
`feat/phase4-foundation` (fastest but leaves a feature branch as prod).

## Workstreams

### WS1 — Code & config guardrails (Claude; fully testable; zero prod risk)

1. **Prove the web monorepo builds.** Clean-checkout build of `apps/web` in a throwaway
   git worktree to surface any Vercel workspace / `@sot/core` resolution gotcha before
   any deploy is spent. Gate: `next build` succeeds; `tsc --noEmit` clean; existing
   vitest still green.
2. **Remove the stale `apps/web/package-lock.json`** duplicate of the root lockfile —
   eliminates Vercel's "multiple lockfiles" install ambiguity. Verify the root lockfile
   still resolves the `apps/web` workspace afterward.
3. **Env preflight guardrail.** A `GET /api/health` route that reports the *presence*
   (boolean, never the value) of each required server env var
   (`DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID/SECRET`, `NATIVE_JWT_SECRET`,
   `GOOGLE_NATIVE_CLIENT_IDS`), plus a fail-fast, clearly-messaged 5xx in the
   native-auth path when `NATIVE_JWT_SECRET` / `GOOGLE_NATIVE_CLIENT_IDS` are absent,
   so a misconfigured deploy fails loudly instead of silently breaking mobile sign-in.
4. **Mobile build-readiness config** (placeholders the owner fills in):
   - `apps/mobile/eas.json` with `development` / `preview` / `production` profiles.
   - `app.json`: add `ios.bundleIdentifier`, `android.package`, top-level `scheme`,
     `extra.eas.projectId` (placeholder), and google-signin plugin config
     (`iosUrlScheme` placeholder); keep the existing `@rnmapbox/maps` +
     `expo-notifications` plugins.
   - Result: `eas build` is runnable the moment real values land, with no code edits.

### WS2 — Owner runbook (Claude writes; owner executes)

A single sequenced doc (`docs/phase5-owner-runbook.md`) with exact values and
destinations:
- Google Cloud: create iOS + Android + Web OAuth clients; the **web** client's audience
  IDs go to `GOOGLE_NATIVE_CLIENT_IDS` (comma-separated) on Vercel; the platform client
  IDs go to `EXPO_PUBLIC_GOOGLE_*` in the mobile app.
- Generate `NATIVE_JWT_SECRET`; set on Vercel Production **and** any preview the app targets.
- Mapbox: **secret** download token → `app.json` build plugin; **public** token →
  `EXPO_PUBLIC_MAPBOX_TOKEN` runtime.
- Expo/EAS: `eas init` → `projectId`; APNs (iOS) + FCM (Android) credentials for push.
- Apply migration `0006_push-tokens` to prod Neon.

### WS3 — Production cutover (owner approves each step; Claude drives what it can)

Ordered, each gated on explicit owner go-ahead:
1. Verify + apply migration `0006` to prod Neon.
2. Merge `feat/phase4-foundation` (with WS1 changes) into `main`, resolving in favor of
   the monorepo layout.
3. Repoint Vercel **Production Branch** → `main`.
4. Deploy; confirm `/api/health` reports all env present and the site is Ready.

No push, deploy, migration, or prod setting change happens without explicit confirmation
in-conversation.

### WS4 — Device QA plan (Claude writes checklist; needs owner hardware)

Make an Expo **dev build** (native modules don't run in Expo Go), then verify on a real
device: Google sign-in → `/api/auth/native` → `/api/me`; Mapbox render + marker/polygon
geometry; the unverified fief-tap-vs-background-tap guard (`lastFeatureTapAt` in
`RealmMap`); the rating flow + offline queue; push token delivery.

## Out of scope (deferred)

- NetInfo auto-flush-on-reconnect (mobile currently flushes on AppState-active + 30s poll).
- Mobile plain-speech / a11y string toggle (mobile ships with themed default strings).
- The res-9 → res-7 hex/fief retune — its own future phase; it invalidates prod fief data.
- Trademark/legal — the only remaining open Phase 1 item, tracked separately.

## Success criteria

- Monorepo `apps/web` builds and deploys green from `main` as production.
- `/api/health` reports every required env var present in prod.
- Owner runbook is complete enough to execute the 5 remaining owner deps without guesswork.
- A dev build installs on a device and passes the WS4 QA checklist.

## Sequencing

WS1 (code guardrails, safe) → WS2 (runbook) → **owner executes deps** → WS3 (cutover,
gated) → WS4 (device QA). WS1 + WS2 are the immediate Claude deliverables and carry no
production risk.
