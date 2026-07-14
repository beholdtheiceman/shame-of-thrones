# Phase 3 · Notifications (design)

**Date:** 2026-07-13
**Status:** approved design, **NOT yet implemented** (spec only)
**Roadmap:** Phase 3 (retention systems), item *Notifications* — the last Phase 3 item.

## Context

Phase 3 Cycles A (Standings), B (Recognition), C (Underdog Blessing) are done.
Notifications is the final item and the only one that is real **infrastructure**
rather than computation over existing data. It was deliberately deferred to its
own effort. This spec is written; **implementation should run in a fresh
session** (it is large, and the Web Push transport is blocked on VAPID secrets
only the owner can set).

## Strategy: one model, two transports, staged

Decision (approved): **design both in-app and Web Push, ship the in-app inbox
first.** Both transports read from a single persisted source of truth so nothing
built first is throwaway.

## Data model

### `notifications` table (new — first Phase 3 migration)

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `userId` | uuid → users.id | recipient |
| `category` | enum `notification_category` | `contested` \| `banner_fallen` \| `season_start` |
| `title` | text | themed dispatch title |
| `body` | text | one line |
| `link` | text nullable | e.g. a fief id to focus on open |
| `createdAt` | timestamptz default now | |
| `readAt` | timestamptz nullable | null = unread |

Index on `(userId, readAt)` and `(userId, category, link, createdAt)` (for dedupe).

Per the test-DB rule, after `db:generate` the migration must be applied to
**both** the prod Neon branch and the `.env.test` branch.

### Opt-in prefs

`users.notifyPrefs` jsonb, default `{ contested: true, banner_fallen: true,
season_start: true }`. Generation consults it; unknown/missing keys default on.

### Web Push (increment, deferred)

`push_subscriptions` table: `id, userId, endpoint (unique), p256dh, auth,
createdAt`. VAPID public/private keys as env vars (`VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) in Vercel + `.env` + `.env.test`.

## Generation — at the triggering rating

`submitRating` already computes `flipped` and the fief's `before`/`after`
`fiefControl`, so it is the trigger point. After the influence events are
inserted:

- **`banner_fallen`** — when `flipped` and `before.leader` existed: notify
  contributing members of the House that *lost* the fief
  (`before.leader.houseId`).
- **`contested`** — when `after.contested && !before.contested`: notify
  contributing members of the leader and runner-up Houses.
- **Recipients** = distinct `userId`s with any influence event in that fief
  (queried from `influenceEvents`), filtered to the relevant House(s), minus the
  acting user, intersected with each user's `notifyPrefs`.
- **Dedupe / rate limit** (honors PRD "≤1 territory push/day"): skip creating a
  row if the same `(userId, category, link)` has a row with `createdAt` within
  24h. Coalesces repeated contests/flips of the same fief.

`season_start` is **not** rating-triggered: it is generated lazily on read — when
a user's latest `season_start` notification predates the current
`seasonWindow(now).index`, insert one. No cron needed (consistent with the app's
read-time-computation model).

Generation must never fail the rating: wrap notification creation so an error is
swallowed/logged, not propagated (the rating is the user's action; notifications
are a side effect).

## In-app inbox (ship first)

- **Header bell** with an unread count (`count(*) where readAt is null`), next to
  the existing header controls. Opens a panel (dialog, Esc-closable, focus-trapped
  — match the Phase 2 a11y patterns) listing notifications newest-first; each row
  shows title/body/relative-time and links to its `link` fief (focus it on the
  map). **Mark-as-read** stamps `readAt` on open (or per-item).
- **Settings**: a small toggle group (in `ProfilePanel`) bound to `notifyPrefs`.
- **Endpoints:**
  - `GET /api/notifications` → recent notifications for the session user +
    unread count (also runs the lazy `season_start` check).
  - `POST /api/notifications/read` → mark all (or a set of ids) read.
  - `POST /api/profile` extended (or a dedicated route) to update `notifyPrefs`.

## Web Push increment (designed, built later)

1. Subscribe flow: a "Get raven alerts" opt-in that calls
   `Notification.requestPermission()` + `pushManager.subscribe({ applicationServerKey:
   VAPID_PUBLIC_KEY })`, POSTing the subscription to `POST /api/push/subscribe`
   (upsert into `push_subscriptions`).
2. `public/sw.js`: add `push` (show `registration.showNotification`) and
   `notificationclick` (focus/open the app at the notification's link) handlers.
   Guard the existing offline cache logic — do not regress it.
3. Send-on-create: when a `notifications` row is inserted, if the user has a
   subscription, is opted-in, and is under the daily cap, send a Web Push
   (server, via `web-push` with the VAPID keys). Prune subscriptions on 404/410.
4. **Blocked on:** owner setting the VAPID env vars. Until then the send path is
   inert and the in-app inbox is the only surface.

## Testing

- Pure: recipient-selection + dedupe logic factored into a testable helper
  (`notificationsFor(before, after, flipped, fiefContributors, prefs, existing)`
  → rows to insert). Unit-test contested/flip/no-op/dedupe/pref-filtered cases.
- Integration (real DB): a rating that flips a fief inserts a `banner_fallen`
  row for a losing-House contributor and none for opted-out users; a second flip
  within 24h does not duplicate.
- `GET /api/notifications` shape + unread count; `read` clears unread; the lazy
  `season_start` insert.
- Web Push increment: subscribe upsert; SW handler smoke (hard to unit-test —
  rely on live verification once VAPID keys exist).

## Implementation order (for the fresh session)

1. Migration (`notifications`, `notifyPrefs`) → apply to both DBs.
2. Pure recipient/dedupe helper + tests.
3. Generation in `submitRating` (swallow errors) + integration test.
4. `GET`/`read` endpoints + `notifyPrefs` update.
5. In-app inbox UI (bell + panel + settings) → **ship / push to prod here.**
6. Web Push increment (subscriptions table, subscribe flow, SW handlers,
   send-on-create) — after VAPID env vars are set.

## Out of scope

- Freshness-quest notifications (no quest system exists).
- Email/SMS transports.
- Digest batching beyond the 24h dedupe.
- Per-category independent rate limits (one 24h dedupe rule covers v1).
