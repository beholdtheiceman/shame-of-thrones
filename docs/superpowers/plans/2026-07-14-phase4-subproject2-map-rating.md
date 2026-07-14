# Phase 4 · Sub-project 2 — Native Map + Rating Loop (design + plan)

> Brainstorming was folded into this doc per an explicit "knock these out, don't stop" directive. High-level Phase 4 decisions (native, RN+Expo, monorepo, 3 sub-projects, web-only moderation) were agreed earlier. Runtime verification is deferred (no simulator / Mapbox token / Google client IDs in the build env) — the gate here is `tsc --noEmit` clean + any backend tests green.

**Goal:** The heart of the app on native — a Mapbox map of thrones + fiefs, the ThroneSheet/FiefCard detail surfaces, and the ~20s sitting/rating flow with the offline queue — reusing `@sot/core` model functions and the existing REST API via the bearer client.

## Design decisions (made autonomously; recorded for review)
- **Map:** `@rnmapbox/maps`. Needs a **Mapbox access token** (owner dep) via `EXPO_PUBLIC_MAPBOX_TOKEN`, and a style URL via `EXPO_PUBLIC_MAPBOX_STYLE_URL` (defaults to `mapbox://styles/mapbox/dark-v11`; the custom fantasy style is a later design dep). Requires a dev build (config plugin) — consistent with google-signin.
- **Navigation:** `@react-navigation/native` + `@react-navigation/bottom-tabs` + `@react-navigation/native-stack`. Tabs: **Realm** (this sub-project), **Standings** + **Profile** (placeholders here; built in Sub-project 3). Keeps the existing `App.tsx` entry.
- **Storage:** `react-native-mmkv` (synchronous). A thin adapter exposes MMKV as core's `StorageLike` (`getItem/setItem/removeItem`), so `@sot/core`'s `ratingQueue` (enqueue/flush/pending) works **unchanged**. The realm offline snapshot uses the same MMKV instance.
- **State:** a native `lib/store.tsx` mirroring `apps/web/src/lib/store.tsx` (Context + `useStore`), but using the mobile bearer `api` client, MMKV snapshot, `AppState`-based refresh (instead of `window` focus/interval), and core `ratingQueue`.
- **Fief polygons:** derived from each fief's H3 cell id via core `geo` (`cellToBoundary`). No new geometry source.
- **Hex resolution:** extract the H3 resolution in `packages/core/src/geo.ts` to a named constant `FIEF_H3_RESOLUTION` and reference it everywhere the literal is used. **DO NOT change its value** — flipping res-9 → res-7 invalidates existing prod fief/seed data and is a Phase 5 launch-ops action. This task only makes it a single tunable constant + documents that.

## API base assumption
The mobile `lib/api.ts` from Foundation has only `fetchMe`. This sub-project grows it into a full client mirroring `apps/web/src/lib/api.ts` (realm, me, notifications, standings, ratings, report, thrones, confirmThrone, addThrone, ageGate, profile, photos) — every call absolute (`API_BASE_URL`) + bearer header, importing DTOs from `@sot/core`. `ApiError` (status) is ported so the store's offline/queue logic can distinguish HTTP rejections from network failures exactly as web does.

## Tasks

### Task 1: Core — name the H3 resolution constant
- **Files:** `packages/core/src/geo.ts` (+ its consumers if they hardcode the res).
- Extract the H3 resolution literal used by `fiefIdForCoords` into `export const FIEF_H3_RESOLUTION = <current value>;` and use it. Grep core for other hardcoded uses of that integer in an h3 call and route them through the constant. Value unchanged.
- Verify: `npm run test --workspace @sot/core` green (61 tests); `npm run test --workspace apps/web` green (124).
- Commit: `refactor(phase4): name FIEF_H3_RESOLUTION constant in core (value unchanged)`.

### Task 2: Mobile deps + storage + full API client + native store
- **Files:** `apps/mobile/lib/mmkv.ts` (MMKV instance + `StorageLike` adapter), `apps/mobile/lib/api.ts` (grow to full client + `ApiError`), `apps/mobile/lib/store.tsx` (native store), `apps/mobile/package.json`.
- Install: `react-native-mmkv`, `@react-navigation/native`, `@react-navigation/bottom-tabs`, `@react-navigation/native-stack`, `react-native-screens`, `react-native-safe-area-context`, `@rnmapbox/maps`.
- `lib/mmkv.ts`: a singleton MMKV + `export const mmkvStorage: StorageLike` mapping `getItem/setItem/removeItem` onto MMKV's `getString/set/delete`.
- `lib/api.ts`: read `apps/web/src/lib/api.ts` and port EVERY method to absolute URL + bearer (reuse `getToken()` from `lib/auth.ts`); port `ApiError`. Keep DTO imports from `@sot/core`.
- `lib/store.tsx`: read `apps/web/src/lib/store.tsx` and port it — same `StoreState`/`useStore` surface, but: MMKV snapshot instead of `localStorage`; `AppState.addEventListener("change", ...)` + an interval for refresh instead of `window` focus; pass `mmkvStorage` to `enqueue/flush/pending`. Same offline/queue semantics (ApiError = online rejection, else = network → queue).
- Verify: `cd apps/mobile && npx tsc --noEmit` clean.
- Commit: `feat(phase4): mobile storage(mmkv) + full bearer API client + native store`.

### Task 3: Navigation shell + Mapbox Realm map
- **Files:** `apps/mobile/App.tsx` (NavigationContainer + StoreProvider + bottom tabs), `apps/mobile/screens/RealmScreen.tsx`, `apps/mobile/components/RealmMap.tsx`, placeholder `screens/StandingsScreen.tsx` + `screens/ProfileScreen.tsx` (each a titled `Text` stub noting "Sub-project 3").
- `RealmMap.tsx`: `@rnmapbox/maps` `MapView` + `Camera`; render throne markers from `state.realm.thrones` (marker style/tier via core `tierForScore`/`scoreBand`); render fief polygons from `state.realm.fiefs` using `geo.cellToBoundary` for each fief id (fill by leading House). Tapping a throne opens ThroneSheet (Task 4); tapping a fief opens FiefCard (Task 4). Read `apps/web/src/components/RealmMap.tsx` for the data mapping + house colors; reimplement with Mapbox/RN primitives (do NOT use react-leaflet).
- Set the Mapbox token at init from `EXPO_PUBLIC_MAPBOX_TOKEN` (`Mapbox.setAccessToken(...)`).
- Verify: `tsc --noEmit` clean.
- Commit: `feat(phase4): navigation shell + Mapbox realm map (thrones + fiefs)`.

### Task 4: ThroneSheet + FiefCard (RN)
- **Files:** `apps/mobile/components/ThroneSheet.tsx`, `apps/mobile/components/FiefCard.tsx` (present as bottom-sheet modals or native-stack screens — a simple RN `Modal` is fine).
- Port `apps/web/src/components/ThroneSheet.tsx`: tier chip (core `displayTier`/`tierForScore`), score/rating count, photos list (via `api.listPhotos`), report button (opens a report modal — a minimal RN `ReportModal`), and a "Take a Seat" button → SittingFlow (Task 5).
- Port `apps/web/src/components/FiefCard.tsx`: House share bars + Contested badge via core `fiefCardModel`.
- Verify: `tsc --noEmit` clean.
- Commit: `feat(phase4): native ThroneSheet + FiefCard (reusing core models)`.

### Task 5: Sitting/rating flow + AddThrone + offline UI
- **Files:** `apps/mobile/components/SittingFlow.tsx`, `apps/mobile/components/AddThroneFlow.tsx`, `apps/mobile/components/OfflineBanner.tsx`, `apps/mobile/components/ReportModal.tsx` (if not already made in Task 4).
- `SittingFlow.tsx`: port `apps/web/src/components/SittingFlow.tsx` — verdict 1–5, tag chips, optional testimony (280 char), verified toggle; calls `useStore().submitRating(...)`; surfaces `testimonyBlocked`, `queued` (offline), and `blessed` (Underdog) outcomes exactly as web copy does.
- `AddThroneFlow.tsx`: port `apps/web/src/components/AddThroneFlow.tsx` — name, category picker (no "residence"), amenities, public-access attestation; uses current map center or device location for lat/lng; calls `addThrone`.
- `OfflineBanner.tsx`: show when `state.offline`, with `snapshotSavedAt` + `queuedCount`.
- Verify: `tsc --noEmit` clean; `npm run test --workspace apps/web` still green (no web regressions — this sub-project shouldn't touch web except Task 1's core constant).
- Commit: `feat(phase4): native sitting/rating flow + add-throne + offline UI`.

## Owner deps introduced (device-QA blockers, not build blockers)
- `EXPO_PUBLIC_MAPBOX_TOKEN` (+ optional `EXPO_PUBLIC_MAPBOX_STYLE_URL`) — Mapbox account/token. Map renders blank without it.
- `@rnmapbox/maps` needs a dev build (config plugin in `app.json`) — Expo Go won't show the map.

## Non-goals
- Standings/Profile/Notifications screens + native push → Sub-project 3.
- Custom fantasy Mapbox style (design dep) — default dark style for now.
- Changing the H3 resolution value / regenerating fief data → Phase 5.
- Photo capture/upload UI polish — a minimal list + existing upload endpoint; full camera UX later.
