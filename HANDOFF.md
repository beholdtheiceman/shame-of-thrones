# Handoff — 2026-07-14 (Phase 4 · Foundation)

## Where things stand
**Phase 3 complete** (except Web Push transport) and on prod via `feat/phase0-backend`.
**Phase 4 (ship on mobile) started.** Strategic decisions locked in a brainstorm:
**commit to native now**, **React Native + Expo** (to reuse the tested pure-TS
core), **full monorepo**. Native port decomposed into 3 sub-projects; moderation
stays web-only. Spec/plan: `docs/superpowers/{specs,plans}/2026-07-14-phase4-foundation*`.

**Sub-project 1 — Foundation is BUILT** on branch **`feat/phase4-foundation`**
(branched off `feat/phase0-backend`), **7 commits, NOT pushed, NOT merged, NOT on
prod.** Executed subagent-driven (implementer per task + direct review).

## What Foundation shipped (on the branch)
- **Monorepo:** web app moved wholesale to `apps/web/`; new `apps/mobile/` (Expo);
  `packages/core` = **`@sot/core`** (pure logic + DTOs, framework-agnostic — verified
  zero next/react/db imports). npm workspaces. Web imports rewired `@/lib/*` → `@sot/core`.
- **Native auth:** `sessionInfo()` now accepts an `Authorization: Bearer` app-JWT
  (HS256, claim `googleSubject`, secret `NATIVE_JWT_SECRET`) and **falls back to the
  existing cookie `auth()`** — fail-closed, web behavior byte-for-byte unchanged, no
  schema change. New `POST /api/auth/native` verifies a Google ID token
  (`google-auth-library`) and mints that app-JWT. Shared secret ties the two halves.
- **Expo app:** classic `App.tsx`, monorepo Metro config, Google sign-in →
  `/api/auth/native` → bearer in `expo-secure-store` → authenticated `/api/me` screen.
  Deliberately a pipeline-proving hello-world, not product UI.

## Verified
- Web suite **124/124** + `next build` clean.
- `@sot/core` suite **61** (DB-free); `apps/mobile` `tsc --noEmit` clean.
- A real bug in the plan's auth snippet was caught + fixed: fail-closed try/catch now
  wraps the whole bearer path (was crashing existing session tests). DTO mismatch
  caught: screen renders `me.rank?.name` (`RankInfo` has no `title`).

## ⚠️ 3 owner-only deps — block LIVE native sign-in + prod deploy (NOT the build/tests)
1. **Vercel Root Directory → `apps/web`** — set before ANY prod deploy of this branch,
   or the deploy breaks (web app is no longer at repo root). Biggest do-not-push-blind item.
2. **Google Cloud OAuth client IDs** (iOS/Android + web audience) →
   `GOOGLE_NATIVE_CLIENT_IDS` (web env) + `EXPO_PUBLIC_GOOGLE_*` (mobile env).
3. **`NATIVE_JWT_SECRET`** env on Vercel (prod) + any preview the mobile app targets.

Tests are unaffected by these (the Google verifier is mocked; `.env.test` has a test secret).

## Next steps
1. **Nothing is deployed** — do not eyeball prod for Phase 4 yet.
2. To take Foundation live: owner sets the 3 deps above, then a real-device sign-in
   smoke (Google → `/api/auth/native` → `/api/me`), then merge/deploy on Larry's OK.
3. **Sub-project 2 — Map + rating loop** (native map, **Mapbox migration**, **H3
   res-9 → res-7 hex re-tune**, ThroneSheet/FiefCard, ~20s sitting flow + offline queue).
4. **Sub-project 3 — Retention + native push** (Standings, Profile, notification inbox,
   Expo Notifications — finally the transport Web Push was deferred on).
5. Trademark/legal still the only open Phase 1 item.

## Notes
- `apps/web/package-lock.json` is a stale duplicate of the root lockfile (harmless Next
  "multiple lockfiles" build warning) — clean up whenever.
- The 2 doc commits (spec + plan) landed on `feat/phase0-backend` before branching, so
  they're shared base context; the 7 impl commits are on `feat/phase4-foundation`.
