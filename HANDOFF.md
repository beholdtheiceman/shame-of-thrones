# Handoff — 2026-07-14 (Phase 4 · all sub-projects built)

## Where things stand
**Phase 3 complete** (except Web Push, now superseded) and on prod via `feat/phase0-backend`.
**Phase 4 (ship on mobile) — ALL THREE sub-projects BUILT** on branch
**`feat/phase4-foundation`** (off `feat/phase0-backend`), **15 commits, NOT pushed,
NOT merged, NOT on prod.** Decisions (brainstorm): commit to native, **React Native
+ Expo**, **full monorepo**, web-only moderation. Executed Claude subagent-driven.
Specs/plans: `docs/superpowers/{specs,plans}/2026-07-14-phase4-*`.

**Verification bar this session:** `tsc --noEmit` clean everywhere + backend tests green
(`apps/web` **133/133**, `@sot/core` **61**, `next build` clean). **Runtime UI was never
executed** — no simulator, Mapbox token, or Google client IDs in the build env. Every
mobile screen is type-checked but needs **real-device QA** once the owner deps land.

## What got built
- **SP1 Foundation:** monorepo (`apps/web` + `apps/mobile` Expo + `packages/core`=`@sot/core`,
  framework-agnostic). Native bearer auth: `sessionInfo()` accepts an HS256 app-JWT
  (`googleSubject`, `NATIVE_JWT_SECRET`) falling back to the cookie — fail-closed, web
  unchanged. `POST /api/auth/native` verifies a Google ID token → mints the app-JWT.
- **SP2 Map + rating loop:** `react-native-mmkv` sync storage (core `ratingQueue` reused
  unchanged), full bearer API client, native store (mirrors web offline/queue semantics),
  `@react-navigation` tabs, `@rnmapbox/maps` map (throne markers + fief polygons),
  ThroneSheet/FiefCard/SittingFlow/AddThrone/OfflineBanner/ReportModal. `verified` = manual
  toggle (no GPS yet). H3 resolution left at 9 (res-7 retune is a Phase 5 data action).
- **SP3 Retention + native push:** native Standings/Profile/NotificationInbox; **Expo
  push** — `push_tokens` table (**migration 0006, applied to TEST Neon only**),
  `POST /api/push/register`, best-effort `sendPushToUser` wired post-commit/error-swallowed
  into `ratings.ts` + `notifications.ts`; `expo-notifications` client registration
  (fire-and-forget, soft-fail).

## ⚠️ Owner-only deps — block LIVE sign-in/push + prod deploy (NOT the build/tests)
1. **Vercel Root Directory → `apps/web`** — set before ANY prod deploy of this branch or it
   breaks (web app is no longer at repo root). Biggest do-not-push-blind item.
2. **Google Cloud OAuth client IDs** → `GOOGLE_NATIVE_CLIENT_IDS` (web) + `EXPO_PUBLIC_GOOGLE_*` (mobile).
3. **`NATIVE_JWT_SECRET`** env on Vercel (prod) + any preview the app targets.
4. **Mapbox tokens** → `EXPO_PUBLIC_MAPBOX_TOKEN` (runtime) + `RNMapboxMapsDownloadToken` in
   `apps/mobile/app.json` (build). Map is blank without them.
5. **Expo/EAS `projectId`** (+ APNs/FCM for standalone builds) for push token delivery.
6. **Apply migration `0006` to PROD Neon** before deploying.

## Next steps
1. Owner sets deps 1–6.
2. Make an Expo **dev build** (the native modules — Mapbox, google-signin, mmkv, notifications
   — don't run in Expo Go).
3. **Real-device QA:** Google sign-in → `/api/auth/native` → `/api/me`; map render + marker/
   polygon geometry; the fief-tap-vs-background-tap guard (`lastFeatureTapAt` in RealmMap —
   flagged, unverified); the ~20s rating flow + offline queue; push token delivery.
4. Merge `feat/phase4-foundation` + deploy on Larry's OK.
5. **Phase 5** (data seeding + closed beta) and the res-9 → res-7 hex retune.
6. Trademark/legal still the only open Phase 1 item.

## Notes / known cleanups (non-blocking)
- `apps/web/package-lock.json` is a stale duplicate of the root lockfile (harmless Next
  "multiple lockfiles" warning).
- Mobile copy is the web's default *themed* strings (no plain-speech toggle on mobile yet).
- NetInfo-based auto-flush on reconnect is a documented follow-up (mobile flushes on
  AppState-active + 30s poll instead of a browser `online` event).
- This was a large single session (brainstorm → spec/plans → 6 implementer subagents across
  3 sub-projects); ran well past the usual one-cycle budget at the user's explicit direction.
