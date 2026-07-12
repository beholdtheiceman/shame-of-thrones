# Phase 2 Cycle 1: Display Gaps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tier-name-first score display in ThroneSheet, tap-a-fief control-breakdown card on the map, and the location-privacy re-verification audit — per `docs/superpowers/specs/2026-07-12-phase2-display-gaps-design.md`.

**Architecture:** Pure display helpers (`tierForScore`, `fiefCardModel`) go in `src/lib/selectors.ts` where the other display math lives, unit-tested in `src/lib/selectors.test.ts` (plain vitest, no DB). UI changes are client-only: a chip in `ThroneSheet`, a new `FiefCard` bottom card fed by the already-fetched `fiefs` prop, and click plumbing in `RealmMap`/`page.tsx`. **No schema, migration, or API changes.** The privacy audit is a read-only code walk whose findings amend the spec.

**Tech Stack:** Next.js 16 client components, react-leaflet Polygon events, Vitest.

**Division of labor:** Codex writes code and runs `npx.cmd tsc --noEmit` ONLY (sandbox has no network/git). Claude runs `npm test`, `npm run build`, browser verification, and every commit. Claude does Task 5 (audit) itself — it is reading, not writing code. **Push/deploy requires Larry's explicit OK — pushing `feat/phase0-backend` deploys production.**

**File map:**

| File | Role |
|---|---|
| `src/lib/selectors.ts` (modify) | `tierForScore`, `fiefCardModel` + exported types |
| `src/lib/selectors.test.ts` (modify) | units for both helpers |
| `src/components/ThroneSheet.tsx` (modify) | tier chip in the status row; score text demoted |
| `src/components/FiefCard.tsx` (create) | bottom card with House share bars |
| `src/components/RealmMap.tsx` (modify) | polygon click → `onSelectFief`; background click callback |
| `src/app/page.tsx` (modify) | `selectedFiefId` state; mutual exclusivity wiring |
| `docs/superpowers/specs/2026-07-12-phase2-display-gaps-design.md` (modify) | audit checklist filled in (Task 5) |

---

### Task 1: `tierForScore` helper

**Files:**
- Modify: `src/lib/selectors.ts`
- Test: `src/lib/selectors.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `src/lib/selectors.test.ts` (add `tierForScore` to the existing `./selectors` import):

```ts
describe("tierForScore", () => {
  it("rounds to the nearest tier", () => {
    expect(tierForScore(4.2).label).toBe("Fit for a Knight");
    expect(tierForScore(2.49).label).toBe("Peasant's Privy");
    expect(tierForScore(2.5).label).toBe("Soldier's Rest");
    expect(tierForScore(4.5).label).toBe("The Iron Throne");
    expect(tierForScore(1.0).label).toBe("The Dungeon");
  });

  it("clamps out-of-range scores", () => {
    expect(tierForScore(0.2).value).toBe(1);
    expect(tierForScore(9).value).toBe(5);
  });

  it("returns the glyph for display", () => {
    expect(tierForScore(4.2).glyph).toBe("🏰");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx.cmd vitest run src/lib/selectors.test.ts`
Expected: FAIL — `tierForScore` is not exported.

- [ ] **Step 3: Implement** — in `src/lib/selectors.ts`, change the first import line to also pull `VERDICT_SCALE`:

```ts
import { HOUSES, VERDICT_SCALE } from "./data";
```

and append at the end of the file:

```ts
export interface VerdictTier {
  value: 1 | 2 | 3 | 4 | 5;
  glyph: string;
  label: string;
}

/** Maps an average score to the nearest VERDICT_SCALE tier ("Fit for a
 * Knight" leads the display; the raw number is secondary — PRD register). */
export function tierForScore(score: number): VerdictTier {
  const clamped = Math.min(5, Math.max(1, score));
  const value = Math.round(clamped) as VerdictTier["value"];
  return VERDICT_SCALE.find((t) => t.value === value) as VerdictTier;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx.cmd vitest run src/lib/selectors.test.ts`
Expected: PASS (all existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/selectors.ts src/lib/selectors.test.ts
git commit -m "feat: tierForScore — nearest verdict tier for an average score"
```

### Task 2: `fiefCardModel` helper

**Files:**
- Modify: `src/lib/selectors.ts`
- Test: `src/lib/selectors.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `src/lib/selectors.test.ts` (add `fiefCardModel` to the `./selectors` import). Reuses the existing `event()` factory and `NOW`:

```ts
describe("fiefCardModel", () => {
  it("maps shares to integer percents, sorted desc, all four Houses", () => {
    const control = fiefControl("f1", [
      event({ id: "a", houseId: "flush", points: 42 }),
      event({ id: "b", houseId: "bidet", points: 38 }),
      event({ id: "c", houseId: "garderobe", points: 20 }),
    ], NOW);
    const model = fiefCardModel(control);
    expect(model.held).toBe(true);
    expect(model.leaderHouseId).toBe("flush");
    expect(model.rows.map((r) => r.houseId)).toEqual([
      "flush", "bidet", "garderobe", "porcelain",
    ]);
    expect(model.rows.map((r) => r.percent)).toEqual([42, 38, 20, 0]);
  });

  it("flags contested fiefs", () => {
    const control = fiefControl("f1", [
      event({ id: "a", houseId: "flush", points: 50 }),
      event({ id: "b", houseId: "bidet", points: 48 }),
    ], NOW);
    expect(fiefCardModel(control).contested).toBe(true);
  });

  it("renders the empty state for missing or zero-influence fiefs", () => {
    for (const model of [fiefCardModel(null), fiefCardModel(fiefControl("f9", [], NOW))]) {
      expect(model.held).toBe(false);
      expect(model.leaderHouseId).toBeNull();
      expect(model.contested).toBe(false);
      expect(model.rows).toHaveLength(4);
      expect(model.rows.every((r) => r.percent === 0)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx.cmd vitest run src/lib/selectors.test.ts`
Expected: FAIL — `fiefCardModel` is not exported.

- [ ] **Step 3: Implement** — append to `src/lib/selectors.ts`:

```ts
export interface FiefCardRow {
  houseId: HouseId;
  percent: number; // integer 0-100
  share: number; // 0-1, for bar width
}

export interface FiefCardModel {
  rows: FiefCardRow[];
  leaderHouseId: HouseId | null;
  contested: boolean;
  held: boolean; // false => "No House holds this land"
}

/** Display model for the fief bottom card. Accepts null/undefined so a
 * tapped fief with no influence events renders an honest empty state. */
export function fiefCardModel(control: FiefControl | null | undefined): FiefCardModel {
  if (!control || control.totalInfluence <= 0) {
    return {
      rows: HOUSES.map((h) => ({ houseId: h.id, percent: 0, share: 0 })),
      leaderHouseId: null,
      contested: false,
      held: false,
    };
  }
  return {
    rows: control.shares.map((s) => ({
      houseId: s.houseId,
      percent: Math.round(s.share * 100),
      share: s.share,
    })),
    leaderHouseId: control.leader?.houseId ?? null,
    contested: control.contested,
    held: true,
  };
}
```

(`HouseId` is already imported in `selectors.ts` via `import type { HouseId, ... } from "./types"`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx.cmd vitest run src/lib/selectors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/selectors.ts src/lib/selectors.test.ts
git commit -m "feat: fiefCardModel — display model for the fief control card"
```

### Task 3: ThroneSheet tier chip

**Files:**
- Modify: `src/components/ThroneSheet.tsx` (the chip row, currently lines ~134-156)

No unit test — the repo has no component-test rig; correctness is carried by Task 1's units plus Task 6's browser verification. Type-check with `npx.cmd tsc --noEmit`.

- [ ] **Step 1: Implement** — in `src/components/ThroneSheet.tsx`:

Add an import (there is no selectors import yet):

```ts
import { tierForScore } from "@/lib/selectors";
```

Directly under `const count = throne.ratingCount;` add:

```ts
const tier = score !== null ? tierForScore(score) : null;
```

Replace the whole chip-row `<div className="mt-3 flex flex-wrap items-center gap-2">…</div>` block with (chip order per spec: status, tier, forgotten, then the demoted score text — note the score span no longer says "/ 5"):

```tsx
<div className="mt-3 flex flex-wrap items-center gap-2">
  {throne.status === "rumored" ? (
    <span className="pixel-chip bg-brass/20 px-2.5 py-1 font-mono text-[13px] uppercase tracking-wide text-brass-strong">
      Rumored
    </span>
  ) : (
    <span className="pixel-chip bg-emerald/20 px-2.5 py-1 font-mono text-[13px] uppercase tracking-wide text-emerald">
      ✓ Verified
    </span>
  )}
  {tier && (
    <span className="pixel-chip bg-brass/20 px-2.5 py-1 font-mono text-[13px] uppercase tracking-wide text-brass-strong">
      {tier.glyph} {tier.label}
    </span>
  )}
  {forgotten && (
    <span className="pixel-chip bg-crimson/20 px-2.5 py-1 font-mono text-[13px] uppercase tracking-wide text-crimson">
      Forgotten by the Realm
    </span>
  )}
  {score !== null ? (
    <span className="font-mono text-[15px] tabular text-ink-soft">
      {score.toFixed(1)} · {count} sitting{count === 1 ? "" : "s"}
    </span>
  ) : (
    <span className="font-mono text-[15px] text-ink-faint">Unrated</span>
  )}
</div>
```

- [ ] **Step 2: Type-check**

Run: `npx.cmd tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/ThroneSheet.tsx
git commit -m "feat: tier name leads the ThroneSheet score display (PRD register)"
```

### Task 4: FiefCard + map click plumbing

**Files:**
- Create: `src/components/FiefCard.tsx`
- Modify: `src/components/RealmMap.tsx`, `src/app/page.tsx`

- [ ] **Step 1: Create `src/components/FiefCard.tsx`:**

```tsx
"use client";

import { HOUSE_BY_ID } from "@/lib/data";
import { fiefCardModel, type FiefControl } from "@/lib/selectors";

export function FiefCard({
  control,
  onClose,
}: {
  control: FiefControl | null;
  onClose: () => void;
}) {
  const model = fiefCardModel(control);
  const leader = model.leaderHouseId ? HOUSE_BY_ID[model.leaderHouseId] : null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[900] flex justify-center px-4">
      <div className="pixel-panel pointer-events-auto w-full max-w-md p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[13px] uppercase tracking-widest text-brass">
              This Fief
            </p>
            {leader ? (
              <p className="mt-1 font-display text-[12px]" style={{ color: leader.colorVar }}>
                {leader.name} holds this land
              </p>
            ) : (
              <p className="mt-1 font-display text-[12px] text-ink-faint">
                No House holds this land
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {model.contested && (
              <span className="pixel-chip bg-crimson/20 px-2.5 py-1 font-mono text-[12px] uppercase tracking-wide text-crimson">
                Contested
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="pixel-chip shrink-0 bg-vellum px-2.5 py-1 font-mono text-sm text-ink-faint hover:text-ink"
            >
              ✕
            </button>
          </div>
        </div>

        <ul className="mt-3 space-y-2">
          {model.rows.map((row) => {
            const house = HOUSE_BY_ID[row.houseId];
            return (
              <li key={row.houseId}>
                <div className="flex items-center justify-between font-mono text-[13px]">
                  <span style={{ color: row.percent > 0 ? house.colorVar : "var(--ink-faint)" }}>
                    {house.name}
                  </span>
                  <span className="tabular text-ink-soft">{row.percent}%</span>
                </div>
                <div className="mt-1 h-2 w-full border border-vellum-line bg-vellum">
                  <div
                    className="h-full"
                    style={{ width: `${row.percent}%`, background: house.colorVar }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire clicks in `src/components/RealmMap.tsx`:**

Add two props to `RealmMapProps` (and destructure them in the component):

```ts
onSelectFief: (fiefId: string) => void;
onBackgroundClick: () => void;
```

Replace `ClickHandler` with a version that always listens — add-mode clicks place a throne, normal clicks report background taps (used to dismiss the card):

```tsx
function ClickHandler({
  addMode,
  onAddClick,
  onBackgroundClick,
}: {
  addMode: boolean;
  onAddClick: (lat: number, lng: number) => void;
  onBackgroundClick: () => void;
}) {
  useMapEvents({
    click(e) {
      if (addMode) onAddClick(e.latlng.lat, e.latlng.lng);
      else onBackgroundClick();
    },
  });
  return null;
}
```

and update its usage in the JSX:

```tsx
<ClickHandler addMode={addMode} onAddClick={onMapClick} onBackgroundClick={onBackgroundClick} />
```

`FiefLayer` gains `addMode` and `onSelectFief` props (pass both through from the parent: `<FiefLayer thrones={thrones} fiefs={fiefs} addMode={addMode} onSelectFief={onSelectFief} />`), and each `Polygon` gets an event handler. In add mode the polygon does nothing and the click bubbles to `ClickHandler`, preserving place-a-throne; otherwise it stops DOM propagation so the background-dismiss handler doesn't immediately close the card:

```tsx
function FiefLayer({
  thrones,
  fiefs,
  addMode,
  onSelectFief,
}: {
  thrones: ThroneDTO[];
  fiefs: FiefControl[];
  addMode: boolean;
  onSelectFief: (fiefId: string) => void;
}) {
  const fiefIds = useMemo(
    () => [...new Set(thrones.map((t) => t.fiefId))],
    [thrones]
  );

  return (
    <>
      {fiefIds.map((fiefId) => {
        const control = fiefs.find((fief) => fief.fiefId === fiefId);
        if (!control) return null;
        if (!control.leader) return null;
        const color = HOUSE_BY_ID[control.leader.houseId].colorVar;
        return (
          <Polygon
            key={fiefId}
            positions={fiefBoundary(fiefId)}
            eventHandlers={{
              click: (e) => {
                if (addMode) return;
                e.originalEvent.stopPropagation();
                onSelectFief(fiefId);
              },
            }}
            pathOptions={{
              color: control.contested ? "var(--crimson)" : "var(--vellum-line)",
              weight: control.contested ? 3 : 2,
              fillColor: color,
              fillOpacity: 0.3 + control.leader.share * 0.3,
              dashArray: control.contested ? "6 4" : undefined,
            }}
          />
        );
      })}
    </>
  );
}
```

- [ ] **Step 3: Wire state in `src/app/page.tsx`:**

Add an import:

```ts
import { FiefCard } from "@/components/FiefCard";
```

Add state next to `selectedThroneId`:

```ts
const [selectedFiefId, setSelectedFiefId] = useState<string | null>(null);
```

Add a memo next to `selectedThrone`:

```ts
const selectedFief = useMemo(
  () => (state.realm?.fiefs ?? []).find((f) => f.fiefId === selectedFiefId) ?? null,
  [state.realm?.fiefs, selectedFiefId]
);
```

Update the `<RealmMap …>` call — throne selection closes the card, fief selection closes the sheet, background taps close the card:

```tsx
<RealmMap
  thrones={thrones}
  fiefs={state.realm?.fiefs ?? []}
  selectedThroneId={selectedThroneId}
  onSelectThrone={(id) => {
    setSelectedThroneId(id);
    setSelectedFiefId(null);
  }}
  onSelectFief={(id) => {
    setSelectedFiefId(id);
    setSelectedThroneId(null);
  }}
  onBackgroundClick={() => setSelectedFiefId(null)}
  addMode={addMode}
  onMapClick={(lat, lng) => {
    setPendingCoords({ lat, lng });
    setAddMode(false);
  }}
  flyTarget={flyTarget}
/>
```

Hide the NearestWorthy button while the card is open (they share the bottom edge) — wrap the existing block:

```tsx
{!selectedFiefId && (
  <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
    <NearestWorthyButton
      onFound={(id, coords) => {
        setSelectedThroneId(id);
        setFlyTarget(coords);
      }}
    />
  </div>
)}
```

Render the card inside the realm-tab `<div className="relative h-full w-full">`, after the NearestWorthy block:

```tsx
{selectedFiefId && (
  <FiefCard control={selectedFief} onClose={() => setSelectedFiefId(null)} />
)}
```

- [ ] **Step 4: Type-check**

Run: `npx.cmd tsc --noEmit`
Expected: clean. (If tsc complains about the polygon handler's parameter, type it as `LeafletMouseEvent` imported from `leaflet`.)

- [ ] **Step 5: Commit**

```bash
git add src/components/FiefCard.tsx src/components/RealmMap.tsx src/app/page.tsx
git commit -m "feat: tap a fief for the House control breakdown card"
```

### Task 5: Privacy re-verification audit (Claude, read-only)

**Files:**
- Modify: `docs/superpowers/specs/2026-07-12-phase2-display-gaps-design.md` (fill in the §3 checklist)

- [ ] **Step 1: Walk the code.** For each checklist item in spec §3, find the evidence:
  - Grep `src/db/schema.ts` for any lat/lng/geohash/coordinate column outside `thrones`.
  - Read `src/app/api/ratings/route.ts` + `src/lib/server/ratings.ts`: confirm the request's lat/lng is used for the proximity check and discarded — never inserted.
  - Read `src/lib/server/signals.ts` (impossible-travel heuristic): confirm inputs are throne coordinates + timestamps only, and the persisted `ReviewSignal` JSON contains no user coordinates.
  - Read `src/lib/server/reports.ts`, `review.ts`, `triage.ts`, `testimonyScreen.ts`: confirm queue rows and AI payloads carry no user coordinates.
  - Read the photo upload route + its server module: determine whether EXIF/GPS survives into the stored bytea and whether the serving route returns original bytes. **This is the likeliest FAIL** — if original bytes are stored and served, EXIF GPS from a camera photo would be publicly exposed.
  - Grep route handlers/middleware for any logging of raw coordinates (`console.log`, logger calls with lat/lng).
- [ ] **Step 2: Record findings.** Change each `- [ ]` in spec §3 to `- [x] PASS — <file:line evidence>` or `- [ ] FAIL — <what leaks, where>`. Add a "Findings (2026-07-12)" note under the checklist summarizing.
- [ ] **Step 3: If any FAIL:** stop and surface it to Larry with the proposed fix (e.g. strip EXIF by re-encoding on upload) before writing more code — a fix is a scope addition to this cycle, and photo re-encoding may need a library decision.
- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-12-phase2-display-gaps-design.md
git commit -m "docs: privacy re-verification audit findings (spec §3)"
```

### Task 6: Full verification

- [ ] **Step 1: Full suite** — Run: `npm test`. Expected: all pass (117 existing + 6 new).
- [ ] **Step 2: Build** — Run: `npm run build`. Expected: clean.
- [ ] **Step 3: Browser verification (dev server, per house rules):**
  - Rated throne → tier chip shows (e.g. "🏰 Fit for a Knight") with `4.2 · N sittings` after it; no "/ 5" anywhere.
  - Unrated throne → "Unrated", no tier chip.
  - Tap a fief polygon → card opens: leader line, four Houses sorted desc with bars + integer %, Contested badge on a contested fief.
  - Tap a throne pin while the card is open → card closes, ThroneSheet opens (pin priority).
  - Tap empty map → card closes.
  - Toggle Add-a-Throne, tap inside a fief polygon → the add-throne form opens (no fief card).
- [ ] **Step 4: Ask Larry before push** — pushing `feat/phase0-backend` deploys production. Do not push without his explicit OK in-conversation.

## Self-review notes

- Spec coverage: §1 → Tasks 1+3; §2 → Tasks 2+4; §3 → Task 5; spec "Testing" → Tasks 1, 2, 6.
- Types consistent: `VerdictTier`, `FiefCardModel`/`FiefCardRow`, `onSelectFief`/`onBackgroundClick` used identically across Tasks 2/4.
- No placeholders; every code step shows the code.
