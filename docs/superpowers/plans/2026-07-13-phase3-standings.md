# Phase 3 · Cycle A — Standings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Standings tab with an individual contributor leaderboard ("The Small Council") and a team board ("House Standings"), computed purely from the existing influence ledger.

**Architecture:** A new pure module `src/lib/standings.ts` computes both boards from `InfluenceEvent[]` (keyed by the unique `authorName`), mirroring `selectors.ts`. A thin server module + `GET /api/standings` route fetches events, maps them, computes server-side, and returns a DTO. A new `Standings.tsx` tab renders it. No schema change, no writes, no new infra. Individual rank stays lifetime/undecayed (spec D1).

**Tech Stack:** Next.js App Router, TypeScript, Drizzle (Postgres), Vitest, Tailwind. Follows existing patterns in `src/lib/selectors.ts`, `src/lib/server/realm.ts`, `src/app/api/realm/route.ts`, `src/lib/api.ts`.

**Spec:** `docs/superpowers/specs/2026-07-13-phase3-standings-design.md`

---

## File Structure

- **Create `src/lib/standings.ts`** — pure selectors: `weekWindow`, `seasonWindow`, `windowRange`, `smallCouncil`, `houseStandings`, and the row/window types. One responsibility: compute standings from events. Imports `HOUSES` from `data.ts` and `fiefControl` from `selectors.ts` (reuse — do not reimplement decay).
- **Create `src/lib/standings.test.ts`** — Vitest units, mirroring `selectors.test.ts`.
- **Create `src/lib/server/standings.ts`** — server data-access: query `influenceEvents`, map via existing `toGameEvent`, call the pure selectors, assemble the DTO. Mirrors `src/lib/server/realm.ts`.
- **Create `src/app/api/standings/route.ts`** — thin `GET` handler; validates query params to safe defaults, resolves the viewer via `sessionInfo()`.
- **Modify `src/lib/api.ts`** — add `StandingsDTO` + `api.standings(...)` client method.
- **Create `src/components/Standings.tsx`** — the tab UI (segmented control, window toggle, House filter, both boards).
- **Modify `src/components/TabBar.tsx`** — add the `"standings"` tab.
- **Modify `src/app/page.tsx`** — render the Standings tab.
- **Modify `src/lib/copy.tsx`** — plain-speech labels for the new UI strings.

**Note on identity:** `users.displayName` is `UNIQUE` (schema line 43) and `InfluenceEvent.authorName` carries it, so `authorName` uniquely identifies a contributor. No join beyond the events query is needed. This matches `lifetimeXp(authorName, events)`, which already keys rank on `authorName` — so reversal (`reason: "reversal"`, negative `points`) events attributed to the original author net out per-author automatically.

---

## Task 1: Pure standings module — windows

**Files:**
- Create: `src/lib/standings.ts`
- Test: `src/lib/standings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/standings.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { HouseId, InfluenceEvent } from "./types";
import {
  houseStandings,
  seasonWindow,
  smallCouncil,
  weekWindow,
  windowRange,
} from "./standings";

const DAY = 86_400_000;
// Thursday 2026-07-16 12:00:00 UTC
const NOW = Date.UTC(2026, 6, 16, 12, 0, 0);

function event(overrides: Partial<InfluenceEvent>): InfluenceEvent {
  return {
    id: "i1", fiefId: "f1", houseId: "flush", points: 10,
    reason: "rating", throneId: "t1", authorName: "Alice", createdAt: NOW,
    ...overrides,
  };
}

describe("weekWindow", () => {
  it("starts Monday 00:00 UTC and spans 7 days", () => {
    const { start, end } = weekWindow(NOW);
    // Monday of that week is 2026-07-13 00:00 UTC
    expect(start).toBe(Date.UTC(2026, 6, 13));
    expect(end).toBe(Date.UTC(2026, 6, 20));
  });

  it("puts Monday 00:00 itself in the current week", () => {
    const monday = Date.UTC(2026, 6, 13);
    expect(weekWindow(monday).start).toBe(monday);
  });

  it("puts Sunday 23:59 in the same week (not the next)", () => {
    const sundayNight = Date.UTC(2026, 6, 19, 23, 59);
    expect(weekWindow(sundayNight).start).toBe(Date.UTC(2026, 6, 13));
  });
});

describe("seasonWindow", () => {
  it("returns 56-day windows aligned to the genesis Monday", () => {
    const { start, end, index } = seasonWindow(NOW);
    expect((end - start) / DAY).toBe(56);
    expect(Number.isInteger(index)).toBe(true);
    expect(start).toBeLessThanOrEqual(NOW);
    expect(end).toBeGreaterThan(NOW);
  });
});

describe("windowRange", () => {
  it("returns null for all-time (no bounds)", () => {
    expect(windowRange("all", NOW)).toBeNull();
  });
  it("returns the week bounds for week", () => {
    expect(windowRange("week", NOW)).toEqual(weekWindow(NOW));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/standings.test.ts`
Expected: FAIL — cannot import from `./standings` (module does not exist).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/standings.ts`:

```typescript
import { HOUSES } from "./data";
import { fiefControl } from "./selectors";
import type { HouseId, InfluenceEvent } from "./types";

const DAY = 86_400_000;

export type WindowKey = "week" | "season" | "all";

/** Current calendar week, resetting Monday 00:00 UTC. */
export function weekWindow(now: number): { start: number; end: number } {
  const d = new Date(now);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const sinceMonday = (dow + 6) % 7; // Mon=0 .. Sun=6
  const midnightToday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const start = midnightToday - sinceMonday * DAY;
  return { start, end: start + 7 * DAY };
}

export const SEASON_LENGTH_DAYS = 56;
/** Monday 2026-01-05 00:00 UTC — aligns season starts to week boundaries. */
export const SEASON_GENESIS = Date.UTC(2026, 0, 5);

export function seasonWindow(now: number): { start: number; end: number; index: number } {
  const span = SEASON_LENGTH_DAYS * DAY;
  const index = Math.floor((now - SEASON_GENESIS) / span);
  const start = SEASON_GENESIS + index * span;
  return { start, end: start + span, index };
}

export function windowRange(window: WindowKey, now: number): { start: number; end: number } | null {
  if (window === "week") return weekWindow(now);
  if (window === "season") {
    const s = seasonWindow(now);
    return { start: s.start, end: s.end };
  }
  return null; // all-time: unbounded
}
```

- [ ] **Step 4: Run test to verify the window tests pass**

Run: `npm run test -- src/lib/standings.test.ts -t "weekWindow"`
Then: `npm run test -- src/lib/standings.test.ts -t "seasonWindow"`
Expected: PASS for `weekWindow`, `seasonWindow`, `windowRange`. The `smallCouncil`/`houseStandings` imports at the top of the test file will still error until Task 2/3 — that is expected. If the runner cannot collect the file due to the missing named exports, temporarily comment the `smallCouncil, houseStandings` names out of the import for this step, then restore them in Task 2.

- [ ] **Step 5: Commit**

```bash
git add src/lib/standings.ts src/lib/standings.test.ts
git commit -m "feat(standings): week/season/all-time window helpers"
```

---

## Task 2: Small Council selector

**Files:**
- Modify: `src/lib/standings.ts`
- Test: `src/lib/standings.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/standings.test.ts` (`HouseId` is already imported at the top from Task 1):

```typescript
describe("smallCouncil", () => {
  const base = { now: NOW, houseFilter: null as HouseId | null, viewerName: undefined };

  it("sums a user's points within the window and ranks desc", () => {
    const events = [
      event({ authorName: "Alice", points: 30, createdAt: NOW - 1 * DAY }),
      event({ authorName: "Bob", points: 50, createdAt: NOW - 1 * DAY }),
      event({ authorName: "Alice", points: 15, createdAt: NOW - 2 * DAY }),
    ];
    const { rows } = smallCouncil(events, { ...base, window: "week" });
    expect(rows.map((r) => [r.name, r.points, r.position])).toEqual([
      ["Bob", 50, 1],
      ["Alice", 45, 2],
    ]);
  });

  it("excludes events outside the window", () => {
    const events = [
      event({ authorName: "Alice", points: 30, createdAt: NOW - 1 * DAY }),
      event({ authorName: "Old", points: 999, createdAt: NOW - 30 * DAY }),
    ];
    const { rows } = smallCouncil(events, { ...base, window: "week" });
    expect(rows.map((r) => r.name)).toEqual(["Alice"]);
  });

  it("nets out reversal events per author and drops non-positive totals", () => {
    const events = [
      event({ authorName: "Alice", points: 40, createdAt: NOW - 1 * DAY }),
      event({ authorName: "Alice", points: -40, reason: "reversal", createdAt: NOW - 1 * DAY }),
      event({ authorName: "Bob", points: 10, createdAt: NOW - 1 * DAY }),
    ];
    const { rows } = smallCouncil(events, { ...base, window: "week" });
    expect(rows.map((r) => r.name)).toEqual(["Bob"]); // Alice netted to 0
  });

  it("restricts population by house filter", () => {
    const events = [
      event({ authorName: "Alice", houseId: "flush", points: 30, createdAt: NOW - 1 * DAY }),
      event({ authorName: "Bob", houseId: "bidet", points: 50, createdAt: NOW - 1 * DAY }),
    ];
    const { rows } = smallCouncil(events, { ...base, window: "week", houseFilter: "flush" });
    expect(rows.map((r) => r.name)).toEqual(["Alice"]);
  });

  it("tie-breaks equal points by earliest contribution then name", () => {
    const events = [
      event({ authorName: "Zed", points: 20, createdAt: NOW - 1 * DAY }),
      event({ authorName: "Amy", points: 20, createdAt: NOW - 2 * DAY }),
    ];
    const { rows } = smallCouncil(events, { ...base, window: "week" });
    expect(rows.map((r) => r.name)).toEqual(["Amy", "Zed"]); // Amy earned earlier
  });

  it("all-time equals the lifetime point sum regardless of date", () => {
    const events = [
      event({ authorName: "Alice", points: 30, createdAt: NOW - 300 * DAY }),
      event({ authorName: "Alice", points: 20, createdAt: NOW }),
    ];
    const { rows } = smallCouncil(events, { ...base, window: "all" });
    expect(rows).toEqual([{ name: "Alice", houseId: "flush", points: 50, position: 1 }]);
  });

  it("pins the viewer's true position when off the top-50 list", () => {
    const events = Array.from({ length: 55 }, (_, i) =>
      event({ authorName: `U${String(i).padStart(2, "0")}`, points: 1000 - i, createdAt: NOW - 1 * DAY })
    );
    const { rows, viewerRow } = smallCouncil(events, { ...base, window: "week", viewerName: "U54" });
    expect(rows).toHaveLength(50);
    expect(viewerRow).toEqual({ name: "U54", houseId: "flush", points: 946, position: 55 });
  });

  it("returns viewerRow null when the viewer is already in the top list", () => {
    const events = [event({ authorName: "Alice", points: 30, createdAt: NOW - 1 * DAY })];
    const { viewerRow } = smallCouncil(events, { ...base, window: "week", viewerName: "Alice" });
    expect(viewerRow).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/standings.test.ts -t "smallCouncil"`
Expected: FAIL — `smallCouncil` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/standings.ts`:

```typescript
export interface CouncilRow {
  name: string;
  houseId: HouseId;
  points: number;
  position: number;
}

export interface SmallCouncilResult {
  rows: CouncilRow[];
  viewerRow: CouncilRow | null;
}

export interface SmallCouncilOptions {
  window: WindowKey;
  houseFilter: HouseId | null;
  now: number;
  viewerName?: string;
}

const TOP_N = 50;

export function smallCouncil(
  events: InfluenceEvent[],
  opts: SmallCouncilOptions
): SmallCouncilResult {
  const { window, houseFilter, now, viewerName } = opts;
  const range = windowRange(window, now);

  const agg = new Map<
    string,
    { name: string; houseId: HouseId; points: number; earliest: number; latestAt: number }
  >();

  for (const ev of events) {
    if (range && (ev.createdAt < range.start || ev.createdAt >= range.end)) continue;
    if (houseFilter && ev.houseId !== houseFilter) continue;
    const cur = agg.get(ev.authorName);
    if (cur) {
      cur.points += ev.points;
      cur.earliest = Math.min(cur.earliest, ev.createdAt);
      if (ev.createdAt >= cur.latestAt) {
        cur.latestAt = ev.createdAt;
        cur.houseId = ev.houseId; // chip reflects the author's most recent House
      }
    } else {
      agg.set(ev.authorName, {
        name: ev.authorName,
        houseId: ev.houseId,
        points: ev.points,
        earliest: ev.createdAt,
        latestAt: ev.createdAt,
      });
    }
  }

  const sorted = [...agg.values()]
    .filter((r) => r.points > 0)
    .sort(
      (a, b) =>
        b.points - a.points || a.earliest - b.earliest || a.name.localeCompare(b.name)
    )
    .map((r, i) => ({ name: r.name, houseId: r.houseId, points: r.points, position: i + 1 }));

  const rows = sorted.slice(0, TOP_N);

  let viewerRow: CouncilRow | null = null;
  if (viewerName && !rows.some((r) => r.name === viewerName)) {
    viewerRow = sorted.find((r) => r.name === viewerName) ?? null;
  }

  return { rows, viewerRow };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/standings.test.ts -t "smallCouncil"`
Expected: PASS (8 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/standings.ts src/lib/standings.test.ts
git commit -m "feat(standings): Small Council individual leaderboard selector"
```

---

## Task 3: House Standings selector

**Files:**
- Modify: `src/lib/standings.ts`
- Test: `src/lib/standings.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/standings.test.ts`:

```typescript
describe("houseStandings", () => {
  it("ranks Houses by current decayed realm-wide influence with shares", () => {
    const events = [
      event({ houseId: "flush", fiefId: "f1", points: 100, createdAt: NOW }),
      event({ houseId: "bidet", fiefId: "f1", points: 300, createdAt: NOW }),
    ];
    const rows = houseStandings(events, NOW);
    expect(rows).toHaveLength(4); // all Houses always present
    expect(rows[0].houseId).toBe("bidet");
    expect(rows[0].share).toBeCloseTo(0.75, 5);
    expect(rows[1].houseId).toBe("flush");
    expect(rows[1].share).toBeCloseTo(0.25, 5);
  });

  it("counts fiefs led per House", () => {
    const events = [
      // f1: bidet leads
      event({ houseId: "bidet", fiefId: "f1", points: 100, createdAt: NOW }),
      event({ houseId: "flush", fiefId: "f1", points: 10, createdAt: NOW }),
      // f2: flush leads
      event({ houseId: "flush", fiefId: "f2", points: 100, createdAt: NOW }),
    ];
    const rows = houseStandings(events, NOW);
    const byId = Object.fromEntries(rows.map((r) => [r.houseId, r]));
    expect(byId.bidet.fiefsLed).toBe(1);
    expect(byId.flush.fiefsLed).toBe(1);
    expect(byId.plunger.fiefsLed).toBe(0);
  });

  it("returns an honest zero state when there is no influence", () => {
    const rows = houseStandings([], NOW);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.influence === 0 && r.share === 0 && r.fiefsLed === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/standings.test.ts -t "houseStandings"`
Expected: FAIL — `houseStandings` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/standings.ts`:

```typescript
export interface HouseStandingRow {
  houseId: HouseId;
  influence: number;
  share: number;
  fiefsLed: number;
}

/** Houses ranked by current realm-wide Influence (same 0.98^days decay as the
 * map, summed across every fief). All four Houses are always returned. */
export function houseStandings(events: InfluenceEvent[], now: number): HouseStandingRow[] {
  const influence = new Map<HouseId, number>();
  const led = new Map<HouseId, number>();
  for (const h of HOUSES) {
    influence.set(h.id, 0);
    led.set(h.id, 0);
  }

  for (const ev of events) {
    const days = Math.max(0, (now - ev.createdAt) / DAY);
    const decayed = ev.points * Math.pow(0.98, days);
    influence.set(ev.houseId, (influence.get(ev.houseId) ?? 0) + decayed);
  }

  for (const fiefId of new Set(events.map((e) => e.fiefId))) {
    const ctrl = fiefControl(fiefId, events, now);
    if (ctrl.leader && ctrl.leader.influence > 0) {
      led.set(ctrl.leader.houseId, (led.get(ctrl.leader.houseId) ?? 0) + 1);
    }
  }

  const total = [...influence.values()].reduce((a, b) => a + b, 0);
  return HOUSES.map((h) => {
    const inf = influence.get(h.id) ?? 0;
    return {
      houseId: h.id,
      influence: inf,
      share: total > 0 ? inf / total : 0,
      fiefsLed: led.get(h.id) ?? 0,
    };
  }).sort((a, b) => b.influence - a.influence);
}
```

- [ ] **Step 4: Run the full standings suite**

Run: `npm run test -- src/lib/standings.test.ts`
Expected: PASS (all describe blocks green). Restore the `smallCouncil, houseStandings` import names from Task 1 Step 4 if they were commented out.

- [ ] **Step 5: Commit**

```bash
git add src/lib/standings.ts src/lib/standings.test.ts
git commit -m "feat(standings): House Standings selector (share + fiefs led)"
```

---

## Task 4: Server data-access + API route

**Files:**
- Create: `src/lib/server/standings.ts`
- Create: `src/app/api/standings/route.ts`

- [ ] **Step 1: Verify `toGameEvent` produces `authorName` (do this FIRST)**

Run: `grep -n "authorName\|export function toGameEvent" src/lib/server/mappers.ts`
Expected: `toGameEvent` maps a DB row to a game `InfluenceEvent` including `authorName`. If it does NOT (e.g. only `userId`), the events query in Step 2 must join `users` (`.innerJoin(users, eq(influenceEvents.userId, users.id))`) and supply `displayName` as `authorName`, following the ratings join in `src/lib/server/realm.ts:11-15`. Read the mapper before writing Step 2 — do not guess.

- [ ] **Step 2: Write the server data-access module**

Create `src/lib/server/standings.ts` (mirrors `src/lib/server/realm.ts`):

```typescript
import { db } from "@/db/client";
import { influenceEvents } from "@/db/schema";
import {
  houseStandings,
  seasonWindow,
  smallCouncil,
  windowRange,
  type HouseStandingRow,
  type SmallCouncilResult,
  type WindowKey,
} from "@/lib/standings";
import type { HouseId } from "@/lib/types";
import { toGameEvent } from "./mappers";

export interface StandingsPayload {
  council: SmallCouncilResult;
  houses: HouseStandingRow[];
  window: { key: WindowKey; start: number | null; end: number | null; seasonIndex?: number };
}

export async function standingsPayload(args: {
  window: WindowKey;
  house: HouseId | null;
  viewerName: string | null;
  now?: number;
}): Promise<StandingsPayload> {
  const now = args.now ?? Date.now();
  const eventRows = await db.select().from(influenceEvents);
  const events = eventRows.map(toGameEvent);

  const council = smallCouncil(events, {
    window: args.window,
    houseFilter: args.house,
    now,
    viewerName: args.viewerName ?? undefined,
  });
  const houses = houseStandings(events, now);
  const range = windowRange(args.window, now);

  return {
    council,
    houses,
    window: {
      key: args.window,
      start: range?.start ?? null,
      end: range?.end ?? null,
      seasonIndex: args.window === "season" ? seasonWindow(now).index : undefined,
    },
  };
}
```

If Step 1 showed the mapper lacks `authorName`, replace the query line with the join form and map `{ ...row.event, authorName: row.displayName }` (or call `toGameEvent(row.event, row.displayName)` per the mapper's actual signature).

- [ ] **Step 3: Verify the session user field name**

Run: `grep -n "displayName\|kind:\|user:" src/lib/server/session.ts`
Expected: the `kind === "user"` branch exposes a `user` object with `displayName`. If the field differs, adjust `info.user.displayName` in Step 4. (The `me` route uses `info.user.id`/`info.user.googleSubject`, so the user row is present — confirm the display-name field name.)

- [ ] **Step 4: Write the route**

Create `src/app/api/standings/route.ts` (thin; mirrors `src/app/api/realm/route.ts` + session use in `src/app/api/me/route.ts`):

```typescript
import { NextResponse } from "next/server";
import { HOUSES } from "@/lib/data";
import { sessionInfo } from "@/lib/server/session";
import { standingsPayload } from "@/lib/server/standings";
import type { WindowKey } from "@/lib/standings";
import type { HouseId } from "@/lib/types";

export const dynamic = "force-dynamic";

const WINDOWS: WindowKey[] = ["week", "season", "all"];

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;

  const wRaw = params.get("window");
  const window: WindowKey = WINDOWS.includes(wRaw as WindowKey) ? (wRaw as WindowKey) : "week";

  const hRaw = params.get("house");
  const house: HouseId | null = HOUSES.some((h) => h.id === hRaw) ? (hRaw as HouseId) : null;

  const info = await sessionInfo();
  const viewerName = info.kind === "user" ? info.user.displayName : null;

  return NextResponse.json(await standingsPayload({ window, house, viewerName }));
}
```

- [ ] **Step 5: Typecheck & build**

Run: `npm run build`
Expected: compiles with no type errors. Fix any import/type mismatches surfaced here.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/standings.ts src/app/api/standings/route.ts
git commit -m "feat(standings): /api/standings route + server computation"
```

---

## Task 5: Client API method + DTO types

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Add DTO types and the client method**

In `src/lib/api.ts`, add the row-type import near the top (alongside the existing `./selectors` import on line 1):

```typescript
import type { CouncilRow, HouseStandingRow, WindowKey } from "./standings";
```

Confirm `HouseId` is in the `./types` import on line 2; if not, add it. Add the DTO interface after `MeDTO` (around line 25):

```typescript
export interface StandingsDTO {
  council: { rows: CouncilRow[]; viewerRow: CouncilRow | null };
  houses: HouseStandingRow[];
  window: { key: WindowKey; start: number | null; end: number | null; seasonIndex?: number };
}
```

Add the method inside the `api` object (after `confirmThrone`, before the closing brace on line 81):

```typescript
  standings: (window: WindowKey, house: HouseId | "all") =>
    request<StandingsDTO>(`/api/standings?window=${window}&house=${house}`),
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: compiles cleanly.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(standings): client api.standings + StandingsDTO"
```

---

## Task 6: Standings tab UI

**Files:**
- Create: `src/components/Standings.tsx`
- Modify: `src/components/TabBar.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Add the tab to `TabBar.tsx`**

In `src/components/TabBar.tsx`, change the type and the `TABS` array:

```typescript
export type TabId = "realm" | "ledger" | "ranks" | "standings";

const TABS: { id: TabId; label: string }[] = [
  { id: "realm", label: "Realm" },
  { id: "ledger", label: "Ledger" },
  { id: "ranks", label: "Ranks" },
  { id: "standings", label: "Standings" },
];
```

- [ ] **Step 2: Create the Standings component**

Create `src/components/Standings.tsx`. It fetches on mount and whenever the window/House filter changes, and reads the viewer's House + anonymous state from `useStore`. Uses existing `pixel-*` classes and House colors (`HOUSE_BY_ID[...].colorVar`).

```tsx
"use client";

import { useEffect, useState } from "react";
import { api, type StandingsDTO } from "@/lib/api";
import { HOUSE_BY_ID } from "@/lib/data";
import type { WindowKey } from "@/lib/standings";
import { useStore } from "@/lib/store";

type Board = "council" | "houses";
const WINDOW_LABELS: { key: WindowKey; label: string }[] = [
  { key: "week", label: "This Week" },
  { key: "season", label: "This Season" },
  { key: "all", label: "All-Time" },
];

export function Standings() {
  const { state } = useStore();
  const anonymous = state.authStatus === "anonymous";
  const myHouse = state.profile?.houseId ?? null;

  const [board, setBoard] = useState<Board>("council");
  const [window, setWindow] = useState<WindowKey>("week");
  const [mine, setMine] = useState(false);
  const [data, setData] = useState<StandingsDTO | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    setError(false);
    setData(null);
    const houseParam = mine && myHouse ? myHouse : "all";
    api
      .standings(window, houseParam)
      .then((d) => live && setData(d))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [window, mine, myHouse]);

  return (
    <div className="mx-auto max-w-md px-4 py-4">
      <div className="mb-3 flex gap-2">
        <SegBtn on={board === "council"} onClick={() => setBoard("council")}>
          Small Council
        </SegBtn>
        <SegBtn on={board === "houses"} onClick={() => setBoard("houses")}>
          House Standings
        </SegBtn>
      </div>

      {error && (
        <p className="pixel-panel p-4 font-mono text-[13px] text-ink-soft">
          The ravens could not reach the Citadel. Try again once you are back on the map.
        </p>
      )}

      {!error && board === "council" && (
        <>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {WINDOW_LABELS.map((w) => (
              <SegBtn key={w.key} on={window === w.key} onClick={() => setWindow(w.key)}>
                {w.label}
              </SegBtn>
            ))}
          </div>
          {!anonymous && myHouse && (
            <div className="mb-3 flex gap-1.5">
              <SegBtn on={!mine} onClick={() => setMine(false)}>All Houses</SegBtn>
              <SegBtn on={mine} onClick={() => setMine(true)}>My House</SegBtn>
            </div>
          )}
          <CouncilList data={data} viewerName={anonymous ? null : state.profile?.name ?? null} />
          {anonymous && (
            <p className="mt-3 font-mono text-[12px] text-ink-faint">
              Sign in to take your seat on the Small Council.
            </p>
          )}
        </>
      )}

      {!error && board === "houses" && <HouseList data={data} />}
    </div>
  );
}

function SegBtn({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`pixel-chip px-3 py-1.5 font-mono text-[12px] uppercase tracking-wide ${
        on ? "bg-brass text-ink-inverse" : "bg-vellum text-ink-soft"
      }`}
    >
      {children}
    </button>
  );
}

function Chip({ houseId }: { houseId: string }) {
  const house = HOUSE_BY_ID[houseId as keyof typeof HOUSE_BY_ID];
  return (
    <span
      className="pixel-chip inline-block h-4 w-4 shrink-0"
      style={{ background: house?.colorVar }}
      role="img"
      aria-label={house?.name ?? "House"}
    />
  );
}

function CouncilList({
  data,
  viewerName,
}: {
  data: StandingsDTO | null;
  viewerName: string | null;
}) {
  if (!data) return <p className="font-mono text-[13px] text-ink-faint">Summoning the Council…</p>;
  if (data.council.rows.length === 0) {
    return (
      <p className="pixel-panel p-4 font-mono text-[13px] text-ink-soft">
        No deeds recorded here yet — be the first.
      </p>
    );
  }
  return (
    <div className="pixel-panel divide-y divide-vellum-line">
      {data.council.rows.map((r) => (
        <Row key={r.name} pos={r.position} name={r.name} houseId={r.houseId} points={r.points} me={r.name === viewerName} />
      ))}
      {data.council.viewerRow && (
        <Row
          pos={data.council.viewerRow.position}
          name={data.council.viewerRow.name}
          houseId={data.council.viewerRow.houseId}
          points={data.council.viewerRow.points}
          me
        />
      )}
    </div>
  );
}

function Row({
  pos,
  name,
  houseId,
  points,
  me,
}: {
  pos: number;
  name: string;
  houseId: string;
  points: number;
  me?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 font-mono text-[13px] ${
        me ? "bg-brass/15 text-brass" : "text-ink-soft"
      }`}
    >
      <span className="w-7 tabular-nums text-ink-faint">{pos}</span>
      <Chip houseId={houseId} />
      <span className="min-w-0 flex-1 truncate">{me ? `${name} (You)` : name}</span>
      <span className="tabular-nums">{points.toLocaleString()}</span>
    </div>
  );
}

function HouseList({ data }: { data: StandingsDTO | null }) {
  if (!data) return <p className="font-mono text-[13px] text-ink-faint">Counting the banners…</p>;
  return (
    <div className="flex flex-col gap-2">
      {data.houses.map((h) => {
        const house = HOUSE_BY_ID[h.houseId];
        return (
          <div key={h.houseId} className="pixel-panel p-3">
            <div className="flex items-center justify-between font-mono text-[13px] text-ink-soft">
              <span className="flex items-center gap-2">
                <Chip houseId={h.houseId} />
                {house?.name ?? h.houseId}
              </span>
              <span className="tabular-nums">
                {Math.round(h.share * 100)}% · {h.fiefsLed} {h.fiefsLed === 1 ? "fief" : "fiefs"}
              </span>
            </div>
            <div className="mt-2 h-2 bg-vellum-line">
              <div className="h-full" style={{ width: `${Math.round(h.share * 100)}%`, background: house?.colorVar }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

Before building, confirm these tokens/exports exist (they are used elsewhere): `state.authStatus`, `state.profile?.name`, `state.profile?.houseId`, `HOUSE_BY_ID` (`@/lib/data`), and the classes `pixel-panel`, `pixel-chip`, `bg-brass`, `bg-vellum`, `text-ink-soft`, `text-ink-faint`, `text-brass`, `border`/`divide-vellum-line`. If `text-ink-inverse` is not a defined token, substitute the token the header/AddThrone buttons use for text-on-brass (check `src/app/globals.css`); if `divide-vellum-line`/`bg-vellum-line` are absent, use the border token the header uses (`border-vellum-line`).

- [ ] **Step 3: Wire the tab in `page.tsx`**

In `src/app/page.tsx`, add the import near the other component imports (with `TabBar` on line 15):

```tsx
import { Standings } from "@/components/Standings";
```

Add a render branch after the `activeTab === "ranks"` block (after line 159, before `</main>`):

```tsx
        {activeTab === "standings" && (
          <div className="h-full overflow-y-auto">
            <Standings />
          </div>
        )}
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: compiles cleanly. Resolve any missing-token or type issues.

- [ ] **Step 5: Commit**

```bash
git add src/components/Standings.tsx src/components/TabBar.tsx src/app/page.tsx
git commit -m "feat(standings): Standings tab UI (Small Council + House Standings)"
```

---

## Task 7: Plain-speech copy

**Files:**
- Modify: `src/lib/copy.tsx` (and `src/lib/copy.test.ts` if its pattern covers new keys)

- [ ] **Step 1: Inspect the copy pattern**

Run: `grep -n "export\|Record\|plain\|useCopy\|function" src/lib/copy.tsx`
Expected: reveals the copy-dictionary shape (themed → plain) and how components consume it (a hook or a map). Follow that exact shape.

- [ ] **Step 2: Add plain-speech entries and consume them**

Add plain equivalents for the new *functional* strings, following the file's existing structure. Game-identity terms stay themed (per the Phase 2 rule); only functional wording gets a plain form:

- "Small Council" → "Top Contributors"
- "House Standings" → "Team Standings"
- "All Houses" → "All Teams" ; "My House" → "My Team"
- "No deeds recorded here yet — be the first." → "No contributions here yet — be the first."
- "Sign in to take your seat on the Small Council." → "Sign in to appear on the contributor list."
- Window labels ("This Week"/"This Season"/"All-Time") are already plain — leave as-is.

Consume the dictionary in `Standings.tsx` the same way an existing component does (e.g. `FiefCard`/`ThroneSheet`), replacing the hard-coded strings above. If the copy system is a fixed key set and adding these is heavy, wrap only these labels and leave themed flavor text (raven/Citadel error, chip aria-labels) as-is.

- [ ] **Step 3: Run copy tests + build**

Run: `npm run test -- src/lib/copy.test.ts`
Then: `npm run build`
Expected: PASS + clean build.

- [ ] **Step 4: Commit**

```bash
git add src/lib/copy.tsx src/lib/copy.test.ts src/components/Standings.tsx
git commit -m "feat(standings): plain-speech copy for the Standings tab"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: all tests pass (existing suite + the new standings units). Note the total count vs. the prior 136 baseline.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean production build.

- [ ] **Step 3: Live-verify on the dev server**

Start the dev server (`.claude/launch.json`) and, signed in:
- The **Standings** tab appears in the bottom bar and opens.
- **Small Council**: This Week / This Season / All-Time changes the list; All Houses / My House filters the population; your row is highlighted, or pinned at the bottom with a real position if off-board.
- **House Standings**: four Houses with share % + fiefs led; bars match shares; shares are sensible against the map.
- **Anonymous** (signed out): both boards viewable; My-House filter and "You" row gone; sign-in nudge shows.
- **Network tab**: `GET /api/standings?window=…&house=…` returns 200 with the DTO shape; it is NOT served from the service-worker cache (it is under `/api/*`).
- **Empty state**: an empty window shows the honest "no deeds recorded" panel, not a blank box.

Capture a screenshot of each board for the handoff.

- [ ] **Step 4: Update the roadmap**

In `docs/ROADMAP.md`, check off the two Phase 3 items delivered and annotate them shipped-in-Cycle-A (Leaderboards; individual rank decay resolved as a documented "no"), mirroring the completed Phase 2 annotation style.

- [ ] **Step 5: Final commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs: mark Phase 3 Cycle A (Standings) shipped in roadmap"
```

---

## Self-Review Notes (for the executor)

- **Verify assumptions early (Task 4 Steps 1 & 3):** that `toGameEvent` yields `authorName` and the session `user` exposes `displayName`. Both have explicit grep steps; do not skip them — the rest of the server code depends on them.
- **Reversal attribution:** per-author netting assumes reversal events carry the penalized author's `authorName` — the same assumption `lifetimeXp` already relies on for rank clawback. The "nets out reversal" test (Task 2) pins it.
- **No decay on individual rank** is intentional (spec D1); the All-Time board equals the lifetime point sum by construction, guarded by the all-time test (Task 2).
- **Offline:** standings are deliberately not in the offline snapshot; the tab shows the error panel offline. Expected this cycle, not a bug.
- **DRY:** `houseStandings` reuses `fiefControl` from `selectors.ts` for fiefs-led; do not duplicate decay math.
