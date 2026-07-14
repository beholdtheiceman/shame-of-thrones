# Phase 4 · Sub-project 3 — Retention Surfaces + Native Push (design + plan)

> Brainstorming folded per the "knock these out" directive. Runtime UI verification deferred (no simulator/creds) — gate = `tsc --noEmit` clean; the backend push work IS testable (vitest + DB) and MUST be tested.

**Goal:** Bring the retention surfaces to native — Standings, Profile (badges/streaks/house-switch/notify-prefs), and the notification inbox — and add **native push via Expo Notifications**, which finally delivers the push transport that Web Push was deferred on. All reusing `@sot/core` selectors + the existing REST API; the push backend reuses the existing notification-generation path.

## Design decisions
- **Push transport:** Expo Notifications (no VAPID — that was Web Push). The app registers an **Expo push token**; the server stores it and POSTs to Expo's push service (`https://exp.host/--/api/v2/push/send`) when it generates a notification. Idempotent with the existing in-app inbox: push is an *additional transport* over the same `notifications` rows, not a new source of truth.
- **Token storage:** new `push_tokens` table (a user can have several devices), migration `0006`. Per the test-DB rule, apply the generated migration to the **`.env.test` Neon branch** now; the **prod Neon apply is an owner action** (branch isn't deployed yet).
- **Send is best-effort:** wrapped in try/catch and fired **after** the notification row commits (mirrors the existing error-swallowed generation in `server/notifications.ts`) — a push failure never breaks a rating.
- **UI:** real Standings + Profile screens replace the Sub-project 2 placeholders; a Notification inbox screen/sheet. Ported from the web components, RN primitives, reuse core selectors.

## Tasks

### Task 1 (backend, TDD + DB): push-token storage + register endpoint + Expo send
- **Files:** `apps/web/src/db/schema.ts` (+ generated `drizzle/0006_*.sql`), `apps/web/src/app/api/push/register/route.ts` (+ `.test.ts`), `apps/web/src/lib/server/push.ts` (+ `.test.ts`), and a call site in `apps/web/src/lib/server/notifications.ts`.
- **Schema:** `push_tokens` = `{ id uuid pk, userId uuid → users.id, token text unique, platform text, createdAt timestamptz default now }`. `npm run db:generate` → new `0006`. Apply to the `.env.test` branch (`npm run db:migrate` with `.env.test` loaded, matching how the repo migrates the test DB). Report the exact migrate commands used.
- **`POST /api/push/register`** (bearer or cookie via `sessionInfo()`): body `{ token, platform }`; requires a `kind:"user"` session (401 otherwise); upsert the token (on-conflict-do-nothing / update `userId`). Test: authed register inserts; duplicate token no-ops; anonymous → 401. Use the repo's DB-test conventions (`resetDb`, `makeUser`, bearer or cookie mock — reuse the pattern from `src/test/session-bearer.test.ts` if bearer).
- **`lib/server/push.ts`:** `sendPushToUser(userId, { title, body, data })` — look up the user's `push_tokens`, POST an array of `{ to, title, body, data }` messages to `https://exp.host/--/api/v2/push/send`, **best-effort** (try/catch, no throw). Test with `fetch` mocked: sends one message per token; swallows a network error; no tokens → no fetch.
- **Wire into notification generation:** in `server/notifications.ts`, wherever a notification row is created for a recipient, call `sendPushToUser(...)` **after commit, error-swallowed** (same shape as the existing post-commit generation). Do not change in-app inbox behavior. Keep existing notification tests green.
- **Verify:** `npm run test --workspace apps/web` green (existing 124 + new push tests); `npm run build --workspace apps/web` clean.
- **Commit:** `feat(phase4): push_tokens + /api/push/register + best-effort Expo push on notify`.

### Task 2 (mobile UI): Standings + Profile + Notification inbox screens
- **Files:** `apps/mobile/screens/StandingsScreen.tsx`, `apps/mobile/screens/ProfileScreen.tsx` (replace SP2 placeholders), `apps/mobile/components/NotificationInbox.tsx`, and a bell/indicator in the tab bar or Realm header.
- **StandingsScreen:** port `apps/web/src/components/Standings.tsx` — window (Week/Season/All) + House filter, The Small Council + House Standings, "Blessed ×1.25" tag; data via `api.standings(window, house)` (already in mobile `api.ts`) + render `StandingsDTO` (computed server-side).
- **ProfileScreen:** port `apps/web/src/components/ProfilePanel.tsx` — name, House, rank (core `RankInfo`), "🔥 N-week streak" + at-risk hint, badges, House switch (`switchHouse`), notify-prefs toggles (`updateNotifyPrefs`), sign-out. Read profile/rank/streak from `useStore()`.
- **NotificationInbox:** port `apps/web/src/components/NotificationInbox.tsx` — list from `state.notifications`, unread styling, `markNotificationsRead`.
- **Verify:** `cd apps/mobile && npx tsc --noEmit` clean.
- **Commit:** `feat(phase4): native Standings + Profile + Notification inbox screens`.

### Task 3 (mobile push client): expo-notifications registration
- **Files:** `apps/mobile/lib/push.ts`, a registration call on sign-in / app-ready (in `lib/store.tsx` or `App.tsx`), `apps/mobile/app.json` (expo-notifications plugin).
- Install `expo-notifications`. `lib/push.ts`: `registerForPush()` — request permission, get the Expo push token (`getExpoPushTokenAsync`), POST it to `/api/push/register` via the bearer `api` (add an `api.registerPush(token, platform)` method to mobile `api.ts`). Call it after a successful sign-in (and on app-ready if a bearer already exists). No-op/soft-fail if permission denied or running without a projectId.
- **Verify:** `cd apps/mobile && npx tsc --noEmit` clean.
- **Commit:** `feat(phase4): expo-notifications registration -> /api/push/register`.

## Owner deps introduced (device-QA / prod blockers, not build blockers)
- **Prod Neon migration `0006`** — apply before any prod deploy of this branch.
- **Expo project / EAS `projectId`** for `getExpoPushTokenAsync`, and APNs/FCM credentials for standalone push. Dev builds work with the Expo push service.
- (Carried from SP2: Mapbox tokens; from Foundation: Vercel root dir, Google client IDs, `NATIVE_JWT_SECRET`.)

## Non-goals
- Rich push categories/actions, badge counts, deep-link routing beyond the notification `link` — later.
- Web Push (still deferred; native push supersedes the immediate need).
- Changing notification generation logic — push is purely an added transport.
