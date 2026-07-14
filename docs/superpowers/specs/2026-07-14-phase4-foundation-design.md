# Phase 4 · Foundation (design)

**Date:** 2026-07-14
**Status:** approved design, **NOT yet implemented** (spec only)
**Roadmap:** Phase 4 (ship on mobile). This is **Sub-project 1 of 3** for the
native port.

## Context & decisions taken

Phase 4 is "ship on mobile." Three strategic decisions were made in brainstorming
before any design:

1. **Commit to native now** (not PWA-hardening, not deferral) — the PRD calls for
   native iOS + Android.
2. **React Native + Expo** — chosen over Flutter specifically to reuse the
   characterization-tested pure-TS logic core, keep one language/paradigm across
   web + native, and stay inside the existing TS/AI-agent workflow. A restroom-
   rating map app is not perf-bound in a way that would justify Flutter's rewrite
   cost.
3. **Full workspace restructure** (`apps/web` + `apps/mobile` + `packages/core`)
   over a minimal root-stays-put layout — cleaner long-term boundaries, accepted
   in exchange for a one-time Vercel Root-Directory change.

The native port is decomposed into three independently-shippable sub-projects,
each its own spec → plan → build cycle:

- **Sub-project 1 — Foundation (this spec):** monorepo, shared logic package,
  Expo scaffold, native auth against the existing NextAuth backend, one
  authenticated screen.
- **Sub-project 2 — Map + rating loop:** the native map (Mapbox migration + H3
  res-9 → res-7 hex re-tune land here), throne markers, ThroneSheet, FiefCard,
  the ~20s sitting/rating flow + offline queue.
- **Sub-project 3 — Retention surfaces + native push:** Standings, Profile
  (badges/streaks), the notification inbox, and native push via Expo
  Notifications (the transport Web Push was deferred on).

**Out of scope for native (all sub-projects):** the `/moderation` queue and
safety tooling stay web-only. Moderators keep using the web app. The backend,
API, DB, auth model, and all Phase 0–3 safety systems are reused unchanged.

## Goal of Foundation

Land the plumbing everything else depends on, and nothing more:

1. Monorepo restructure into `apps/*` + `packages/core`.
2. Extract the pure-TS logic (and its tests) into `@sot/core`.
3. Scaffold an Expo app that builds and runs.
4. Solve native auth against the existing NextAuth (JWT) backend.
5. One authenticated screen that calls `/api/me` and renders the profile —
   proving auth + shared DTOs + core logic work end-to-end.

## Repo layout

```
shame-of-thrones/
├─ apps/
│  ├─ web/            ← existing Next.js app, moved wholesale from root
│  └─ mobile/         ← new Expo (React Native, expo-router) app
├─ packages/
│  └─ core/           ← shared framework-agnostic TypeScript (@sot/core)
├─ package.json       ← npm-workspaces root
└─ tsconfig.base.json ← shared compiler options, extended by each package/app
```

**Workspace manager:** npm workspaces (the repo already uses npm; no pnpm or
Turborepo — not needed for two apps + one package, YAGNI). Turborepo can be added
later if build orchestration warrants it.

### What moves to `packages/core`

The framework-agnostic modules currently under `src/lib`, **with their vitest
suites**:

- `selectors.ts` (+ `selectors.test.ts`) — decay/control/rank math, the
  characterization-pinned core
- `game/rules.ts` — ramp + underdog multiplier
- `standings.ts` (+ `standings.test.ts`)
- `recognition.ts` (+ `recognition.test.ts`)
- `notifications.ts` (+ `notifications.test.ts`)
- `types.ts`
- `geo.ts`
- `ratingQueue.ts` (+ `ratingQueue.test.ts`)
- The **DTO interfaces** currently declared in `src/lib/api.ts` (`RealmDTO`,
  `MeDTO`, `StandingsDTO`, `NotificationsDTO`, `ThroneDTO`, etc.) — extracted so
  both clients share one source of truth for the wire shapes.

Consumed as **TS source** via workspace + tsconfig path alias (`@sot/core`), not
pre-built to `dist` — keeps the vitest suites and the edit loop simple. Both Next
(via its bundler) and Expo (via Metro, see Risks) transpile the workspace
package's TS.

`@sot/core` has **no runtime dependencies** beyond what those modules already use
and must import nothing from `next`, `react`, or any DB/server module. This is
the invariant that keeps it consumable by React Native.

### What stays in `apps/web`

Everything server- or Next-coupled: `src/lib/server/*`, `src/app/*`,
`src/components/*`, `src/db/*`, `src/auth.ts`, and the test suites that hit Neon
(`src/test/*`). After the move, web code imports the shared modules from
`@sot/core` instead of `@/lib/*` — mechanical find-replace, no logic change.
`copy.tsx` stays web-only for now (it is JSX; mobile gets its own copy layer in a
later sub-project — the underlying strings can be shared then).

### Test split after the move

- **`packages/core`:** fast, DB-free vitest suites (the moved pure tests). Green
  here is the primary proof the extraction changed no behavior.
- **`apps/web`:** the DB-backed vitest suites stay, still hitting the `.env.test`
  Neon branch (test-DB rule unchanged). Green here proves the import refactor +
  the `sessionInfo` change broke nothing server-side.

## Native auth

The backend is NextAuth with a **JWT session strategy**; identity is
`googleSubject` (Google's `providerAccountId`), read from the session cookie by
`sessionInfo()`. Native is cross-origin and cannot use that cookie flow, so we
add a **parallel bearer-token path** that converges on the same identity.

### Flow

1. **On device:** Expo Google sign-in
   (`@react-native-google-signin/google-signin`) returns a Google **ID token** (a
   JWT signed by Google) whose `sub` equals the same value web stores as
   `googleSubject`.
2. **`POST /api/auth/native`** (new route): body `{ idToken }`. The server
   verifies the ID token with `google-auth-library`
   (`OAuth2Client.verifyIdToken` — signature via Google JWKS, `aud` ∈ our OAuth
   client IDs, `iss` ∈ `accounts.google.com` / `https://accounts.google.com`, not
   expired). **Fail-closed:** any verification failure → 401, no token issued.
   On success it extracts `sub` and issues **our own** session bearer: a signed
   JWT (`jose`) with claim `{ googleSubject }` + an expiry (e.g. 30 days), signed
   with a dedicated `NATIVE_JWT_SECRET`. Response: `{ token }`.
3. **App storage:** the bearer is stored in `expo-secure-store` (iOS Keychain /
   Android Keystore) and sent as `Authorization: Bearer <token>` on every API
   call. On a 401 the app clears the token and returns to sign-in.
4. **`sessionInfo()` refactor** (`src/lib/server/session.ts`): check
   `headers()` for an `Authorization: Bearer` token first → verify our JWT with
   `NATIVE_JWT_SECRET` → `googleSubject`; otherwise fall back to the existing
   `auth()` cookie path. Both branches produce the **same `SessionInfo` union**,
   so every route that calls `sessionInfo()` is untouched and **web behavior is
   byte-for-byte unchanged**. No schema change, no user migration. No bearer and
   no cookie → `{ kind: "anonymous" }`, exactly as today (Wandering Peasant
   read-only mode works on native).

### Why this shape

`googleSubject` stays the single identity key across both transports, so the
entire authenticated surface (profile, ratings, standings, moderation-exempt
routes) works for native with zero per-route change. The web OAuth flow is not
modified at all.

## First screen & config

Expo app (expo-router) with **one real screen**:

- **Signed out:** "Sign in with Google" + "Continue as Wandering Peasant".
- **Signed in:** calls `/api/me`, renders the profile payload (name, house, rank,
  streak) using the shared `MeDTO` from `@sot/core`.

This is intentionally a "hello-world that proves the pipeline" (auth + shared
DTO + core logic), **not** product UI — real screens come in Sub-projects 2–3.

**Config:** mobile reads `EXPO_PUBLIC_API_BASE_URL`. For Foundation it points at
the **prod (or a Vercel preview) API**; the only writes are sign-in/profile
reads, so the risk of pointing dev at prod is low. A dedicated staging API is
deferred to the write-heavy sub-projects (2–3), where it matters.

## Error handling

- ID-token verification failure → 401, fail-closed, no token issued.
- Bearer verification failure on an API call → 401; app clears the stored token
  and returns to sign-in.
- Network failure on the mobile side → simple retry affordance for Foundation
  (the richer offline-tolerant patterns arrive with the rating loop in
  Sub-project 2).

## Testing

- **`packages/core`:** the moved suites run green in their new home — the main
  correctness gate for the restructure (behavior must be identical).
- **`apps/web`:** existing DB-backed suites stay green (import refactor +
  `sessionInfo` change break nothing). **Add:**
  - a unit test for the bearer branch of `sessionInfo` (mocked `headers()` +
    a JWT signed with a test `NATIVE_JWT_SECRET`), covering valid, expired, and
    tampered tokens;
  - a test for `POST /api/auth/native` with the Google verifier **mocked** — so
    the endpoint is fully testable before real OAuth client IDs exist.
- **Mobile:** a manual simulator/device smoke (sign in → see `/me`). Automated RN
  testing is deferred to later sub-projects.
- **Build gates:** `apps/web` `npm run build` clean; the Expo app builds and runs
  on a simulator.

## Risks & owner-only external dependencies

Flagged loudly because several block *end-to-end* sign-in but not the build, and
one can break the prod deploy:

1. **Vercel Root Directory → `apps/web`.** After the web app moves, the Vercel
   project's Root Directory must be set to `apps/web` (dashboard, or `vercel.json`
   / `vercel.ts`). **Until this is done the prod deploy breaks** — this is the
   single biggest "do not push blind" item. Owner action.
2. **Google Cloud OAuth client IDs** (iOS + Android + a web/backend audience) —
   owner-only setup in Google Cloud. Blocks *live* native sign-in but **not** the
   build or tests (the mocked verifier covers dev). Owner action.
3. **`NATIVE_JWT_SECRET`** env var — a dedicated secret (kept separate from
   `AUTH_SECRET` for clean concern separation) set on Vercel and locally. Owner
   action.
4. **Metro workspace resolution** — Expo consuming a workspace TS package needs
   `metro.config.js` tuning (`watchFolders` for the repo root, `nodeModulesPaths`
   for hoisted deps). Known-fiddly; budget a little time.

## Explicit non-goals for Foundation

- No product UI (map, ratings, standings, profile screens) — those are
  Sub-projects 2–3.
- No native push — Sub-project 3.
- No Mapbox, no hex re-tune — Sub-project 2.
- No native moderation surfaces — web-only, permanently.
- No staging API environment — deferred to Sub-project 2.
- No CI change for mobile builds — manual simulator smoke for now.
