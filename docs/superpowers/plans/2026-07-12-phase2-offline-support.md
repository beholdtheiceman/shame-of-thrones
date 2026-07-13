# Phase 2 Cycle 3: Offline Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offline support per `docs/superpowers/specs/2026-07-12-phase2-offline-support-design.md`: SW-cached map tiles + app shell, last-known realm snapshot, queue-and-sync for ratings.

**Architecture:** Hand-rolled `public/sw.js` (tiles cache-first capped at 1,500; shell network-first; `/api/*` untouched). App code owns data: `src/lib/ratingQueue.ts` is a pure, storage-injected module; `store.tsx` persists/hydrates the realm snapshot, flags `offline`, enqueues failed ratings, and flushes on `online`/start. **No schema or API changes.**

**Tech Stack:** Service Worker API, localStorage, existing Plain Speech COPY dictionary.

**Division of labor (lean):** Codex implements Tasks 1–3 synchronously (code + `npx.cmd tsc --noEmit` only; no vitest/npm/git — sandbox constraint). Claude runs tests/commits, does Task 4 (one combined review + live verification), and gates the push on Larry.

**File map:**

| File | Role |
|---|---|
| `src/lib/ratingQueue.ts` (create) | pure queue: enqueue/pending/flush, storage-injected |
| `src/lib/ratingQueue.test.ts` (create) | units (memStorage, fake submit) |
| `public/sw.js` (create) | tile + shell caches |
| `src/components/ServiceWorkerRegistrar.tsx` (create) | registers sw.js |
| `src/components/OfflineBanner.tsx` (create) | offline / queued / dropped notices |
| `src/lib/store.tsx` (modify) | snapshot, offline flag, queue integration, flush |
| `src/lib/copy.tsx` (modify) | 3 new keys |
| `src/components/SittingFlow.tsx` (modify) | queued-result message |
| `src/app/layout.tsx`, `src/app/page.tsx` (modify) | mount registrar / banner |

---

### Task 1: `ratingQueue` module (TDD)

**Files:** Create `src/lib/ratingQueue.ts`, `src/lib/ratingQueue.test.ts`.

- [ ] **Step 1: failing tests** — `src/lib/ratingQueue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { enqueue, flush, pending, type QueuedRating } from "./ratingQueue";

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

function rating(over: Partial<QueuedRating> = {}): QueuedRating {
  return { throneId: "t1", verdict: 4, tags: [], verified: true, queuedAt: 1, ...over };
}

class HttpError extends Error { constructor(public status: number) { super("http"); } }
const isHttp = (e: unknown) => e instanceof HttpError;

describe("ratingQueue", () => {
  it("enqueue/pending round-trips", () => {
    const s = memStorage();
    enqueue(rating({ throneId: "a" }), s);
    enqueue(rating({ throneId: "b" }), s);
    expect(pending(s).map((r) => r.throneId)).toEqual(["a", "b"]);
  });

  it("flush submits in order and empties the queue", async () => {
    const s = memStorage();
    enqueue(rating({ throneId: "a" }), s);
    enqueue(rating({ throneId: "b" }), s);
    const seen: string[] = [];
    const res = await flush(async (r) => { seen.push(r.throneId); }, isHttp, s);
    expect(seen).toEqual(["a", "b"]);
    expect(res).toMatchObject({ submitted: 2, halted: false });
    expect(res.dropped).toEqual([]);
    expect(pending(s)).toEqual([]);
  });

  it("drops on http error and continues", async () => {
    const s = memStorage();
    enqueue(rating({ throneId: "bad" }), s);
    enqueue(rating({ throneId: "good" }), s);
    const res = await flush(async (r) => {
      if (r.throneId === "bad") throw new HttpError(404);
    }, isHttp, s);
    expect(res.submitted).toBe(1);
    expect(res.dropped.map((r) => r.throneId)).toEqual(["bad"]);
    expect(pending(s)).toEqual([]);
  });

  it("halts on network error and keeps the remainder", async () => {
    const s = memStorage();
    enqueue(rating({ throneId: "a" }), s);
    enqueue(rating({ throneId: "b" }), s);
    const res = await flush(async () => { throw new TypeError("failed to fetch"); }, isHttp, s);
    expect(res).toMatchObject({ submitted: 0, halted: true });
    expect(pending(s).map((r) => r.throneId)).toEqual(["a", "b"]);
  });

  it("resets a malformed queue", () => {
    const s = memStorage();
    s.setItem("sot-rating-queue", "{nonsense");
    expect(pending(s)).toEqual([]);
  });

  it("guards against concurrent flushes", async () => {
    const s = memStorage();
    enqueue(rating(), s);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const first = flush(async () => { await gate; }, isHttp, s);
    const second = await flush(async () => {}, isHttp, s);
    expect(second).toMatchObject({ submitted: 0, halted: false });
    release();
    expect((await first).submitted).toBe(1);
  });
});
```

- [ ] **Step 2: run to fail** — `npx.cmd vitest run src/lib/ratingQueue.test.ts` → FAIL (module missing).
- [ ] **Step 3: implement** — `src/lib/ratingQueue.ts` (complete file):

```ts
export interface QueuedRating {
  throneId: string;
  verdict: 1 | 2 | 3 | 4 | 5;
  tags: string[];
  verified: boolean;
  testimony?: string;
  queuedAt: number;
}

export interface FlushResult {
  submitted: number;
  dropped: QueuedRating[];
  halted: boolean; // network failure mid-flush; remainder kept for next trigger
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY = "sot-rating-queue";

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function write(queue: QueuedRating[], storage: StorageLike): void {
  try {
    storage.setItem(KEY, JSON.stringify(queue));
  } catch {
    // quota/privacy failure — queue silently disabled (spec: degrade to online-only)
  }
}

export function pending(storage: StorageLike | null = defaultStorage()): QueuedRating[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as QueuedRating[]) : [];
  } catch {
    try { storage.removeItem(KEY); } catch {}
    return [];
  }
}

export function enqueue(rating: QueuedRating, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  write([...pending(storage), rating], storage);
}

let flushing = false;

/** Sequential, ordered flush. `isHttpError` distinguishes a server rejection
 * (drop, keep going) from a network failure (halt, keep the rest). */
export async function flush(
  submit: (r: QueuedRating) => Promise<void>,
  isHttpError: (e: unknown) => boolean,
  storage: StorageLike | null = defaultStorage()
): Promise<FlushResult> {
  const result: FlushResult = { submitted: 0, dropped: [], halted: false };
  if (flushing || !storage) return result;
  flushing = true;
  try {
    let queue = pending(storage);
    while (queue.length > 0) {
      const head = queue[0];
      try {
        await submit(head);
        result.submitted++;
      } catch (e) {
        if (isHttpError(e)) {
          result.dropped.push(head);
        } else {
          result.halted = true;
          break;
        }
      }
      queue = queue.slice(1);
      write(queue, storage);
    }
    return result;
  } finally {
    flushing = false;
  }
}
```

- [ ] **Step 4: run to pass** — `npx.cmd vitest run src/lib/ratingQueue.test.ts` → 6 PASS; `npx.cmd tsc --noEmit` clean.
- [ ] **Step 5 (Claude): commit** — `git add src/lib/ratingQueue.ts src/lib/ratingQueue.test.ts && git commit -m "feat: rating queue — pure enqueue/flush module for offline sync"`

### Task 2: Store integration + banner + copy

**Files:** Modify `src/lib/store.tsx`, `src/lib/copy.tsx`, `src/components/SittingFlow.tsx`, `src/app/page.tsx`; Create `src/components/OfflineBanner.tsx`.

- [ ] **Step 1: COPY keys** — append to the COPY object in `src/lib/copy.tsx`:

```ts
  offlineBanner: { themed: "The ravens cannot fly — you see the Realm as it was", plain: "You're offline — showing saved data" },
  ratingQueued: { themed: "Your deed will be sung when the ravens return.", plain: "Saved — your rating will submit when you're back online." },
  queueDropped: { themed: "A queued deed was refused by the Maesters.", plain: "A saved rating couldn't be submitted." },
```

- [ ] **Step 2: store.tsx** — changes, all inside `StoreProvider` unless noted:

Add imports:

```ts
import { enqueue, flush, pending, type QueuedRating } from "./ratingQueue";
```

Extend `StoreState` (top of file):

```ts
export interface StoreState {
  authStatus: AuthStatus;
  profile: MeDTO["profile"];
  rank: MeDTO["rank"] | null;
  ageGate: { confirmed: boolean; locked: boolean } | null;
  realm: RealmDTO | null;
  error: string | null;
  offline: boolean;
  snapshotSavedAt: number | null;
  queuedCount: number;
  queueDropped: boolean;
}
```

Initial state gains `offline: false, snapshotSavedAt: null, queuedCount: pending().length, queueDropped: false`.

Add above `StoreProvider`:

```ts
const SNAPSHOT_KEY = "sot-realm-snapshot";

function saveSnapshot(realm: RealmDTO): void {
  try {
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ savedAt: Date.now(), realm }));
  } catch {}
}

function loadSnapshot(): { savedAt: number; realm: RealmDTO } | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY) ?? "null");
    return parsed && typeof parsed.savedAt === "number" && parsed.realm ? parsed : null;
  } catch {
    return null;
  }
}
```

In `refresh` success path: call `saveSnapshot(realm);` and switch the `setState` to a functional update that preserves queue fields and sets `offline: false, snapshotSavedAt: null`:

```ts
saveSnapshot(realm);
setState((s) => ({
  ...s,
  realm,
  profile: me?.profile ?? null,
  rank: me?.rank ?? null,
  ageGate: me?.ageGate ?? null,
  authStatus: me === null ? "anonymous" : me.profile === null ? "needs_profile" : "ready",
  error: null,
  offline: false,
  snapshotSavedAt: null,
}));
```

In `refresh` catch: network failures (anything that is NOT an `ApiError`) hydrate the snapshot:

```ts
} catch (e) {
  if (!(e instanceof ApiError)) {
    const snap = loadSnapshot();
    setState((s) => ({
      ...s,
      realm: s.realm ?? snap?.realm ?? null,
      authStatus: s.authStatus === "loading" ? "anonymous" : s.authStatus, // cold offline start = read-only browsing (spec §3)
      offline: true,
      snapshotSavedAt: s.realm ? s.snapshotSavedAt : snap?.savedAt ?? null,
      error: null,
    }));
  } else {
    setState((s) => ({ ...s, error: e.message }));
  }
}
```

`submitRating` becomes queue-aware (replace the existing implementation; the signature in `StoreContextValue` changes to `Promise<{ testimonyBlocked: boolean; queued: boolean }>`):

```ts
submitRating: async (input) => {
  const payload = {
    throneId: input.throneId, verdict: input.verdict, tags: input.tags, verified: input.verified,
    testimony: input.testimony.trim() || undefined,
  };
  try {
    const res = await api.submitRating(payload);
    await refresh();
    return { testimonyBlocked: !!res.testimonyBlocked, queued: false };
  } catch (e) {
    if (e instanceof ApiError) {
      await refresh();
      throw e; // server rejections keep today's behavior
    }
    enqueue({ ...payload, queuedAt: Date.now() });
    setState((s) => ({ ...s, offline: true, queuedCount: pending().length }));
    return { testimonyBlocked: false, queued: true };
  }
},
```

Flush wiring — add after the existing refresh effect:

```ts
const runFlush = useCallback(async () => {
  const result = await flush(
    async (r: QueuedRating) => {
      await api.submitRating({ throneId: r.throneId, verdict: r.verdict, tags: r.tags, verified: r.verified, testimony: r.testimony });
    },
    (e) => e instanceof ApiError
  );
  if (result.submitted > 0 || result.dropped.length > 0) {
    setState((s) => ({ ...s, queuedCount: pending().length, queueDropped: s.queueDropped || result.dropped.length > 0 }));
    await refresh();
  }
}, [refresh]);

useEffect(() => {
  void runFlush();
  const onOnline = () => { void runFlush(); };
  window.addEventListener("online", onOnline);
  return () => window.removeEventListener("online", onOnline);
}, [runFlush]);
```

- [ ] **Step 3: OfflineBanner** — create `src/components/OfflineBanner.tsx`:

```tsx
"use client";

import { useCopy } from "@/lib/copy";
import { useStore } from "@/lib/store";

function age(ms: number): string {
  const min = Math.max(1, Math.round((Date.now() - ms) / 60_000));
  return min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
}

export function OfflineBanner() {
  const { state } = useStore();
  const t = useCopy();
  if (!state.offline && state.queuedCount === 0 && !state.queueDropped) return null;
  return (
    <div role="status" className="pointer-events-none absolute inset-x-0 top-16 z-[950] flex justify-center px-4">
      <div className="pixel-chip pointer-events-auto bg-vellum-raised px-3 py-1.5 text-center font-mono text-[13px] text-ink-soft">
        {state.offline && (
          <span>
            {t("offlineBanner")}
            {state.snapshotSavedAt ? ` (${age(state.snapshotSavedAt)})` : ""}
          </span>
        )}
        {state.queuedCount > 0 && <span>{state.offline ? " · " : ""}{state.queuedCount} ✉</span>}
        {state.queueDropped && <span className="text-crimson-strong"> · {t("queueDropped")}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: mount + SittingFlow** — in `src/app/page.tsx`, render `<OfflineBanner />` (import it) as the first child inside the realm-tab `<div className="relative h-full w-full">`. In `src/components/SittingFlow.tsx`, the submit handler receives `{ testimonyBlocked, queued }` — when `queued` is true show `t("ratingQueued")` as the confirmation message instead of the normal success copy (follow the component's existing message-state pattern; the rating did NOT post yet, so don't show influence gained).

- [ ] **Step 5:** `npx.cmd tsc --noEmit` clean. (Claude) full `npx.cmd vitest run` → green; commit `git add -A src && git commit -m "feat: offline snapshot, rating queue integration, offline banner"`

### Task 3: Service worker + registration

**Files:** Create `public/sw.js`, `src/components/ServiceWorkerRegistrar.tsx`; Modify `src/app/layout.tsx`.

- [ ] **Step 1:** `public/sw.js` (complete file):

```js
const TILE_CACHE = "sot-tiles-v1";
const SHELL_CACHE = "sot-shell-v1";
const TILE_CAP = 1500;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== TILE_CACHE && n !== SHELL_CACHE).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

async function trimTiles() {
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  if (keys.length > TILE_CAP) {
    await Promise.all(keys.slice(0, keys.length - TILE_CAP).map((k) => cache.delete(k)));
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // Map tiles: cache-first, capped. Only tiles the user actually viewed
  // are cached (OSM tile-usage policy: no bulk downloads).
  if (url.hostname.endsWith("tile.openstreetmap.org")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(TILE_CACHE);
        const hit = await cache.match(event.request);
        if (hit) return hit;
        const res = await fetch(event.request);
        if (res.ok) {
          await cache.put(event.request, res.clone());
          event.waitUntil(trimTiles());
        }
        return res;
      })()
    );
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // freshness is app-controlled

  // Hashed build assets: cache-first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const hit = await cache.match(event.request);
        if (hit) return hit;
        const res = await fetch(event.request);
        if (res.ok) await cache.put(event.request, res.clone());
        return res;
      })()
    );
    return;
  }

  // App shell: network-first with cached fallback so the app opens offline.
  if (event.request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        try {
          const res = await fetch(event.request);
          if (res.ok) await cache.put("/", res.clone());
          return res;
        } catch {
          return (await cache.match("/")) || Response.error();
        }
      })()
    );
  }
});
```

- [ ] **Step 2:** `src/components/ServiceWorkerRegistrar.tsx`:

```tsx
"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // registration failure (unsupported/blocked) — app stays online-only
      });
    }
  }, []);
  return null;
}
```

- [ ] **Step 3:** mount `<ServiceWorkerRegistrar />` in `src/app/layout.tsx` inside `<body>`, before the providers (import from `@/components/ServiceWorkerRegistrar`).
- [ ] **Step 4:** `npx.cmd tsc --noEmit` clean. (Claude) commit `git add public/sw.js src/components/ServiceWorkerRegistrar.tsx src/app/layout.tsx && git commit -m "feat: service worker — capped tile cache + offline app shell"`

### Task 4 (Claude): combined review, live verification, push gate

- [ ] ONE combined review (spec + quality) over the cycle diff. Points of interest: `flushing` module flag vs React StrictMode double-effects; SW caching a redirected navigation; snapshot auth-state handling; SittingFlow queued-path UX.
- [ ] Full `npm test` + `npm run build`.
- [ ] Live verification (browser pane; screenshots hang on this app, use JS eval):
  - Load app online, pan the map; simulate offline (stub `window.fetch` to reject for `/api/*` or stop the dev server) → reload: shell + tiles render, offline banner with snapshot age.
  - Queue path: with fetch stubbed offline, submit a rating (or drive `enqueue`/`flush` with a stubbed submit if no signed-in session) → queued count shows → restore → flush submits, banner clears.
  - Confirm `/api/*` is never served from SW cache.
- [ ] Update ROADMAP checkbox + HANDOFF; ask Larry before pushing (prod deploy).

## Self-review notes
- Spec §1 → Task 3; §2 → Task 2; §3 → Tasks 1–2; error handling → Tasks 1–2 code; testing → Tasks 1, 4.
- Type consistency: `QueuedRating`/`FlushResult`/`pending`/`enqueue`/`flush` identical across Tasks 1–2; COPY keys match between copy.tsx additions and OfflineBanner/SittingFlow usage.
- StrictMode note: the flush effect may run twice in dev; the `flushing` guard makes the second call a no-op by design.
