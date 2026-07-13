# Phase 2 Cycle 3 — Offline Support (design)

Date: 2026-07-12
Status: approved by Larry (brainstorm session)
Scope source: ROADMAP Phase 2 / PRD §7 — cache map tiles + last-known Throne
data, queue-and-sync ratings when connectivity drops.

Larry's architecture choice: **small hand-rolled service worker** (no new
dependencies) for tiles + app shell; realm snapshot and ratings queue live in
app code (localStorage).

## 1. Service worker (`public/sw.js` + registration)

- Hand-rolled SW, registered from a tiny client component
  (`src/components/ServiceWorkerRegistrar.tsx`) mounted in `layout.tsx`;
  registration is a no-op where `navigator.serviceWorker` is unavailable.
- **Tile cache**: fetch handler intercepts requests whose host ends with
  `tile.openstreetmap.org`; cache-first (serve hit, else fetch + put). Cap
  ~1,500 entries with FIFO eviction (delete oldest keys when over cap).
  Only tiles the user actually viewed are cached — consistent with OSM's
  tile-usage policy (no bulk/area downloading).
- **Shell cache**: navigation requests are network-first with cache
  fallback (cache a copy of `/` on successful fetch); same-origin static
  assets (`/_next/static/*`) are cache-first (they're content-hashed).
- `/api/*` requests are **never** SW-cached — freshness is app-controlled.
- Versioned cache names (`sot-tiles-v1`, `sot-shell-v1`); `activate` deletes
  old versions. `skipWaiting` + `clients.claim` so updates apply on reload.

## 2. Last-known realm snapshot

- `src/lib/store.tsx`: after every successful realm fetch, persist the
  payload + `savedAt` to `localStorage["sot-realm-snapshot"]` (try/catch —
  quota or privacy-mode failures degrade silently).
- On realm fetch failure (network error) or offline start: hydrate state
  from the snapshot if present, and set an `offline: true` flag in store
  state (cleared on the next successful fetch or `online`-event refetch).
- Offline banner component (`src/components/OfflineBanner.tsx`) rendered in
  `page.tsx` when `offline`: themed "The ravens cannot fly — you see the
  Realm as it was" / plain "You're offline — showing saved data", plus the
  snapshot age ("as of N minutes/hours ago"). New COPY keys; follows the
  cycle-2 Plain Speech dictionary.

## 3. Queue-and-sync ratings

- New module `src/lib/ratingQueue.ts` (pure logic, injected fetch for
  testability): `enqueue(rating)`, `pending()`, `flush(submit)` over
  `localStorage["sot-rating-queue"]`. Queued shape: `{ throneId, verdict,
  tags, verified, testimony?, queuedAt }`.
- `store.tsx` `submitRating`: on network failure (fetch rejection) or
  `navigator.onLine === false`, enqueue instead of failing; surface a
  distinct "queued" result so SittingFlow can show themed "Your deed will
  be sung when the ravens return" / plain "Saved — will submit when you're
  back online" (new COPY keys).
- Flush triggers: `online` event + app start (store init). Ordered,
  sequential submission:
  - success → remove from queue, refresh realm once at the end;
  - HTTP 4xx (age gate, suspension, hidden throne, validation) → **drop**
    the item and surface a notice (themed "A queued deed was refused" /
    plain "A saved rating couldn't be submitted") — never retried;
  - network failure → keep the item, stop the flush (retry on next trigger).
- Timestamps: the server stamps sync time as `createdAt` (client-supplied
  timestamps would be a gaming vector). Accepted v1 tradeoff: decay and
  travel heuristics see sync time. `queuedAt` stays client-side only.
- **Ratings only.** Add-throne, confirmations, photos, and reports remain
  online-only (photos/reports have server-side screening that must not lag;
  the rest is YAGNI until users ask).
- Proximity: unchanged — GPS works offline; `verified` is computed on-device
  at rating time and preserved in the queue.
- **Cold offline start is read-only.** If `/api/me` can't be reached, auth
  state is unknown, so the app renders as anonymous browsing over the
  snapshot (rating UI gated as today). Queueing only arises when a
  signed-in session loses connectivity mid-use — which is the PRD's
  basement scenario. The queue itself is keyed to whoever flushes it (the
  session cookie at sync time), matching that assumption.

## Error handling

- localStorage unavailable → queue/snapshot silently disabled; app behaves
  exactly as today (online-only).
- Malformed queue/snapshot JSON → discarded (try/catch, reset key).
- Double-flush guard: a module-level in-flight flag prevents concurrent
  flushes (online event + manual refresh racing).

## Testing

- Vitest units for `ratingQueue` with injected localStorage + submit fn:
  enqueue/pending round-trip, ordered flush, 4xx drop + notice list,
  network-failure retention + stop, double-flush guard, malformed JSON reset.
- Existing suite stays green (no schema/API changes).
- Live verification (devtools offline emulation): offline banner + snapshot
  render, tile pan from cache, queued rating on submit, reconnect flush
  visible in the queue row/ledger, 4xx drop path exercised via a hidden
  throne if practical.

## Out of scope (YAGNI)

- PWA manifest/installability, Background Sync API, push.
- Offline queueing for anything but ratings.
- Client-supplied timestamps; offline conflict resolution.
- Precaching tiles for areas the user hasn't viewed.
