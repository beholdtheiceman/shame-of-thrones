# Phase 3 · Cycle C — Underdog Blessing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give a trailing House (Realm influence share < 15%) a ×1.25 Influence multiplier on ratings, applied at award time and shown transparently on House Standings + in the rating feedback.

**Architecture:** Pure `underdogMultiplier` in `rules.ts`; a lean `realmHouseShares` in `standings.ts` (reused by `houseStandings`, which gains a `blessed` flag); `submitRating` applies the multiplier and returns `blessed`. No schema migration.

**Tech Stack:** Next.js, TypeScript, Drizzle, Vitest. Follows Cycles A/B patterns.

**Spec:** `docs/superpowers/specs/2026-07-13-phase3-underdog-blessing-design.md`

---

## Task 1: The rule — `underdogMultiplier`

**Files:** Modify `src/lib/game/rules.ts`, `src/lib/standings.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `src/lib/standings.test.ts`:

```typescript
import { UNDERDOG, underdogMultiplier } from "./game/rules";

describe("underdogMultiplier", () => {
  it("boosts a House below the share threshold", () => {
    expect(underdogMultiplier(0.149)).toBe(UNDERDOG.multiplier);
  });
  it("does not boost at or above the threshold", () => {
    expect(underdogMultiplier(UNDERDOG.shareThreshold)).toBe(1);
    expect(underdogMultiplier(0.30)).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm run test -- src/lib/standings.test.ts -t "underdogMultiplier"`
Expected: FAIL (not exported).

- [ ] **Step 3: Implement**

In `src/lib/game/rules.ts`, add after the `INFLUENCE` block:

```typescript
/** Underdog Blessing (PRD §5.6): a House trailing in the Realm earns a
 * temporary Influence multiplier. Self-correcting — earning more lifts the
 * House's share back over the threshold and the blessing ends. */
export const UNDERDOG = { shareThreshold: 0.15, multiplier: 1.25 } as const;

export function underdogMultiplier(share: number): number {
  return share < UNDERDOG.shareThreshold ? UNDERDOG.multiplier : 1;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm run test -- src/lib/standings.test.ts -t "underdogMultiplier"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/game/rules.ts src/lib/standings.test.ts
git commit -m "feat(underdog): underdogMultiplier + UNDERDOG config"
```

---

## Task 2: `realmHouseShares` + `blessed` on House Standings

**Files:** Modify `src/lib/standings.ts`, `src/lib/standings.test.ts`

- [ ] **Step 1: Read the current `houseStandings`**

Run: `grep -n "houseStandings\|HouseStandingRow\|influence\|share\|fiefsLed" src/lib/standings.ts`
Confirm the current shape: `HouseStandingRow = { houseId; influence; share; fiefsLed }` and that `houseStandings` sums decayed influence per House, computes `share`, and counts `fiefsLed` via `fiefControl`.

- [ ] **Step 2: Add the failing tests**

Append to `src/lib/standings.test.ts`:

```typescript
import { realmHouseShares } from "./standings";

describe("realmHouseShares", () => {
  it("returns each House's decayed share, summing to 1", () => {
    const events = [
      event({ houseId: "flush", points: 100, createdAt: NOW }),
      event({ houseId: "bidet", points: 300, createdAt: NOW }),
    ];
    const shares = realmHouseShares(events, NOW);
    expect(shares.get("flush")).toBeCloseTo(0.25, 5);
    expect(shares.get("bidet")).toBeCloseTo(0.75, 5);
    const total = [...shares.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 5);
  });
  it("is all zero on empty input", () => {
    const shares = realmHouseShares([], NOW);
    expect([...shares.values()].every((s) => s === 0)).toBe(true);
  });
});

describe("houseStandings blessed flag", () => {
  it("marks a sub-threshold House blessed and a dominant House not", () => {
    const events = [
      event({ houseId: "bidet", fiefId: "f1", points: 1000, createdAt: NOW }),
      event({ houseId: "flush", fiefId: "f1", points: 10, createdAt: NOW }), // ~1% share
    ];
    const rows = houseStandings(events, NOW);
    const byId = Object.fromEntries(rows.map((r) => [r.houseId, r]));
    expect(byId.flush.blessed).toBe(true);
    expect(byId.bidet.blessed).toBe(false);
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `npm run test -- src/lib/standings.test.ts -t "realmHouseShares"`
Expected: FAIL.

- [ ] **Step 4: Implement**

In `src/lib/standings.ts`:
- add `import { underdogMultiplier } from "./game/rules";` (keep existing imports).
- add `blessed: boolean;` to the `HouseStandingRow` interface.
- add `realmHouseShares` and refactor `houseStandings` to use it. Replace the influence/share computation in `houseStandings` with a call to `realmHouseShares`, keep the `fiefsLed` loop, and set `blessed`:

```typescript
/** Each House's current decayed Realm-influence share (0..1), summing to 1
 * (or all 0 when the Realm has no influence). Lean — no per-fief work. */
export function realmHouseShares(events: InfluenceEvent[], now: number): Map<HouseId, number> {
  const influence = new Map<HouseId, number>();
  for (const h of HOUSES) influence.set(h.id, 0);
  for (const ev of events) {
    const days = Math.max(0, (now - ev.createdAt) / DAY);
    influence.set(ev.houseId, (influence.get(ev.houseId) ?? 0) + ev.points * Math.pow(0.98, days));
  }
  const total = [...influence.values()].reduce((a, b) => a + b, 0);
  const shares = new Map<HouseId, number>();
  for (const h of HOUSES) shares.set(h.id, total > 0 ? (influence.get(h.id) ?? 0) / total : 0);
  return shares;
}
```

Then in `houseStandings`, compute `const shares = realmHouseShares(events, now);` and build each row with `share: shares.get(h.id) ?? 0` and `blessed: underdogMultiplier(shares.get(h.id) ?? 0) !== 1`. Keep the `influence` field (still needed for sorting/display) — you may keep the existing per-House influence sum for it. Do not change the sort (by influence desc) or the `fiefsLed` logic. Reuse the `DAY` constant already in the file; do not redefine it.

- [ ] **Step 5: Run — expect PASS (full standings suite)**

Run: `npm run test -- src/lib/standings.test.ts`
Expected: PASS, including the prior Cycle-A cases. The House Standings row now has `blessed`; if a Cycle-A test did a strict `toEqual` on a full House row, add `blessed` to its expected object.

- [ ] **Step 6: Commit**

```bash
git add src/lib/standings.ts src/lib/standings.test.ts
git commit -m "feat(underdog): realmHouseShares + blessed flag on House Standings"
```

---

## Task 3: Apply the blessing in `submitRating`

**Files:** Modify `src/lib/server/ratings.ts`

- [ ] **Step 1: Re-read the award section**

Re-read `src/lib/server/ratings.ts` lines ~48-107 (the `isFirstRating` check, the `fiefEventRows` load, `base`/`firstBonus`, `newEvents`, `points`, and the return object).

- [ ] **Step 2: Load realm-wide events and compute the multiplier**

Replace the fief-only events load with a realm-wide load, derive the fief slice from it, and compute the awarding House's multiplier. Change the current
`const fiefEventRows = await tx.select().from(influenceEvents).where(eq(influenceEvents.fiefId, fiefId));`
to:

```typescript
const allEventRows = await tx.select().from(influenceEvents);
const fiefEventRows = allEventRows.filter((e) => e.fiefId === fiefId);
const shares = realmHouseShares(allEventRows.map(toGameEvent), now);
const multiplier = underdogMultiplier(shares.get(user.houseId) ?? 0);
const blessed = multiplier !== 1;
```

Add the imports: `realmHouseShares` from `@/lib/standings`, and `underdogMultiplier` added to the existing `@/lib/game/rules` import. Keep the existing `before = fiefControl(fiefId, fiefEventRows.map(toGameEvent), now)`.

- [ ] **Step 3: Apply the multiplier to the awards**

Change `base` and `firstBonus` to multiply by `multiplier` and round up:

```typescript
const base = Math.ceil(
  rampedPoints(input.verified ? INFLUENCE.verifiedRating : INFLUENCE.hearsayRating, accountAgeMs) * multiplier
);
const firstBonus = Math.ceil(rampedPoints(INFLUENCE.firstOfNameBonus, accountAgeMs) * multiplier);
```

Add `blessed` to the successful return (the `updated: false` branch):

```typescript
return {
  updated: false as const, influence: points, flipped, firstOfName: isFirstRating, fief: after,
  ratingId: insertedRating.id,
  throne: { id: throne.id, lat: throne.lat, lng: throne.lng },
  blessed,
};
```

Also add `blessed: false` to the early `updated: true` (24h repeat) return so the shape is consistent.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: compiles (client `submitRating` type updated in Task 4; a type error at the call site until then is fine — proceed to Task 4).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/ratings.ts
git commit -m "feat(underdog): apply the blessing multiplier to rating Influence"
```

---

## Task 4: Client types + rating feedback

**Files:** Modify `src/lib/api.ts`, and the component that shows the rating result

- [ ] **Step 1: Add `blessed` to the client result type**

In `src/lib/api.ts`, find `submitRating`'s `request<…>(…)` result type (currently `{ updated: boolean; influence: number; flipped: boolean; testimonyBlocked?: boolean }`) and add `blessed?: boolean`.

- [ ] **Step 2: Find where the rating result is shown**

Run: `grep -rn "submitRating\|flipped\|influence" src/components | grep -iv test`
Identify the component that consumes `api.submitRating(...)`'s result (the sitting/rating flow that shows the awarded Influence). Read it.

- [ ] **Step 3: Surface the blessing**

Where that component renders the awarded Influence, add a note when `result.blessed` is true:

```tsx
{result.blessed && (
  <p className="font-mono text-[12px] text-brass">{t("underdogApplied")}</p>
)}
```

Match the component's existing style/copy usage. If it doesn't use the copy dictionary, prefer adding `useCopy`; a plain "Underdog Blessing applied (+25%)" is an acceptable fallback (Task 6 adds the key).

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.ts src/components
git commit -m "feat(underdog): surface blessing in the rating feedback"
```

---

## Task 5: House Standings "Blessed" tag

**Files:** Modify `src/components/Standings.tsx`

- [ ] **Step 1: Render the tag**

In the `HouseList` block of `src/components/Standings.tsx` (where each House row shows share % + fiefs led), add a tag when `h.blessed`:

```tsx
{h.blessed && (
  <span className="pixel-chip bg-brass px-1.5 py-0.5 text-[10px] text-on-brass">
    {t("blessed")}
  </span>
)}
```

Place it near the House name/stats, matching the row's existing layout. `h.blessed` is already on each row (it flows through `StandingsDTO.houses`). If `HouseList` lacks `useCopy`, add it or use a plain "Blessed ×1.25" string (Task 6 adds `blessed`).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/Standings.tsx
git commit -m "feat(underdog): Blessed tag on House Standings"
```

---

## Task 6: Plain-speech copy

**Files:** Modify `src/lib/copy.tsx`

- [ ] **Step 1: Add keys**

Following the `{themed, plain}` shape, add:

```typescript
  blessed: { themed: "⭐ Blessed ×1.25", plain: "Boosted ×1.25" },
  underdogApplied: { themed: "Underdog Blessing applied (+25% Influence)", plain: "Underdog boost applied (+25%)" },
```

Use these keys wherever Tasks 4/5 referenced `t("blessed")` / `t("underdogApplied")`.

- [ ] **Step 2: Test + build**

Run: `npm run test -- src/lib/copy.test.ts` then `npm run build`
Expected: PASS + clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/copy.tsx src/components
git commit -m "feat(underdog): plain-speech for blessing labels"
```

---

## Task 7: Integration test — blessed award

**Files:** Modify `src/test/ratings.test.ts`

- [ ] **Step 1: Read the fixtures**

Run: `grep -n "makeUser\|makeThrone\|houseId\|joinedAt" src/test/fixtures.ts`
Confirm `makeUser({ houseId })` and how influence is seeded (via `submitRating`). Confirm accounts are old enough to avoid the new-account ramp (existing tests expect full 10/2/15, so they are).

- [ ] **Step 2: Add the tests**

Append inside the `describe("submitRating", …)` block:

```typescript
it("applies the Underdog Blessing when the House is below the share threshold", async () => {
  // Pile Realm influence onto bidet so flush sits well under 15% share.
  const bidet = await makeUser({ houseId: "bidet" });
  for (let i = 0; i < 6; i++) {
    const t = await makeThrone(bidet.id);
    await submitRating(bidet, { throneId: t.id, verdict: 5, tags: [], verified: true }); // 10 each (+15 first)
  }
  const flush = await makeUser({ houseId: "flush" });
  const throne = await makeThrone(flush.id);
  const result = await submitRating(flush, { throneId: throne.id, verdict: 4, tags: [], verified: true });

  // First rating on a fresh throne: base 10 + first bonus 15, each ×1.25 → 13 + 19 = 32.
  expect(result.blessed).toBe(true);
  expect(result.influence).toBe(Math.ceil(10 * 1.25) + Math.ceil(15 * 1.25)); // 13 + 19 = 32
});

it("does not bless a House at or above the threshold", async () => {
  const flush = await makeUser({ houseId: "flush" });
  const throne = await makeThrone(flush.id);
  // Seed one flush rating so the Realm isn't empty; the second rating then sees
  // flush holding ~100% share (not an underdog).
  await submitRating(flush, { throneId: throne.id, verdict: 5, tags: [], verified: true });
  const throne2 = await makeThrone(flush.id);
  const result = await submitRating(flush, { throneId: throne2.id, verdict: 5, tags: [], verified: true });
  expect(result.blessed).toBe(false);
});
```

NOTE: a House's share is computed from events **before** the new award. On a truly empty Realm the first-ever rater's share is 0 (< threshold) → blessed; that edge is acceptable and not asserted (the second test seeds a flush rating first so the asserted award sees flush at ~100%).

- [ ] **Step 3: Run**

Run: `npm run test -- src/test/ratings.test.ts`
Expected: PASS. If `makeThrone`/`makeUser` seed influence differently than assumed, recompute the expected numbers from observed values — do not fudge the assertion.

- [ ] **Step 4: Commit**

```bash
git add src/test/ratings.test.ts
git commit -m "test(underdog): blessed vs unblessed rating awards"
```

---

## Task 8: Full verification

- [ ] **Step 1:** `npm run test` → all pass against the real DB (note count vs. the 165 baseline).
- [ ] **Step 2:** `npm run build` → clean.
- [ ] **Step 3: Live-verify** (dev server): a `POST /api/ratings` for a below-threshold House returns `blessed: true` with boosted `influence`; `GET /api/standings` shows `blessed: true` on the trailing House. (If the preview pane is unavailable, verify via direct API calls as in Cycles A/B.)
- [ ] **Step 4: Roadmap** — in `docs/ROADMAP.md`, check off *Underdog Blessing* under Phase 3, annotated shipped-in-Cycle-C (threshold 15% / ×1.25, ratings-only, transparent on House Standings; notifications split to its own session). Mirror the Cycle-A/B annotation style.
- [ ] **Step 5:** `git add docs/ROADMAP.md && git commit -m "docs: mark Phase 3 Underdog Blessing shipped"`

---

## Self-Review Notes (for the executor)

- **`realmHouseShares` is the single source of truth** for shares — used by both `houseStandings` (Task 2) and the award path (Task 3). Do not compute shares twice with divergent logic.
- **Multiplier applies to already-ramped points, then `Math.ceil`** — integers, never zero, composes with the new-account ramp.
- **Share is measured BEFORE the current award** (from existing events). A first-ever rater on an empty Realm has share 0 → blessed; acceptable edge behaviour.
- **`blessed` reaches the client two ways:** `submitRating`'s result (rating feedback) and `HouseStandingRow` (House Standings) — no new endpoint.
- **Confirmation awards (`thrones.ts`) are intentionally NOT blessed** this cycle.
