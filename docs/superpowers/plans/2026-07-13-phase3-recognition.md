# Phase 3 · Cycle B — Recognition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add streaks + two new badges (Night's Watch, Oathkeeper) and move all badge awarding to a unified computed-on-read model.

**Architecture:** New pure module `src/lib/recognition.ts` derives streak + badges from a user's ratings/thrones-added on profile read (reusing `weekWindow` from `standings.ts`). `mePayload` computes them; the scattered imperative `users.badges` writes are removed. No schema migration.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle, Vitest. Follows `src/lib/standings.ts` (Cycle A) and existing server/test patterns.

**Spec:** `docs/superpowers/specs/2026-07-13-phase3-recognition-design.md`

---

## Task 1: Pure recognition module — streak + badges

**Files:** Create `src/lib/recognition.ts`, `src/lib/recognition.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/recognition.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { Rating } from "./types";
import { currentStreak, earnedBadges, OATHKEEPER_WEEKS } from "./recognition";

const DAY = 86_400_000;
const WEEK = 7 * DAY;
// Thursday 2026-07-16 12:00 UTC — current week starts Mon 2026-07-13.
const NOW = Date.UTC(2026, 6, 16, 12, 0, 0);

function rating(overrides: Partial<Rating>): Rating {
  return {
    id: "r1", throneId: "t1", authorName: "A", houseId: "flush",
    verdict: 3, tags: [], testimony: "", verified: true, createdAt: NOW,
    ...overrides,
  };
}

describe("currentStreak", () => {
  it("counts consecutive active weeks ending this week", () => {
    const ratings = [
      rating({ createdAt: NOW }),               // this week
      rating({ createdAt: NOW - WEEK }),         // -1
      rating({ createdAt: NOW - 2 * WEEK }),     // -2
      rating({ createdAt: NOW - 3 * WEEK }),     // -3
    ];
    expect(currentStreak(ratings, NOW)).toEqual({ weeks: 4, thisWeekActive: true });
  });

  it("keeps an at-risk streak alive when this week is not yet active", () => {
    const ratings = [
      rating({ createdAt: NOW - WEEK }),         // -1
      rating({ createdAt: NOW - 2 * WEEK }),     // -2
    ];
    expect(currentStreak(ratings, NOW)).toEqual({ weeks: 2, thisWeekActive: false });
  });

  it("is zero when neither this week nor last week is active", () => {
    const ratings = [rating({ createdAt: NOW - 3 * WEEK })];
    expect(currentStreak(ratings, NOW)).toEqual({ weeks: 0, thisWeekActive: false });
  });

  it("breaks the run on a gap week", () => {
    const ratings = [
      rating({ createdAt: NOW }),               // this week
      // -1 missing
      rating({ createdAt: NOW - 2 * WEEK }),     // -2
    ];
    expect(currentStreak(ratings, NOW)).toEqual({ weeks: 1, thisWeekActive: true });
  });

  it("ignores unverified ratings", () => {
    const ratings = [rating({ createdAt: NOW, verified: false })];
    expect(currentStreak(ratings, NOW)).toEqual({ weeks: 0, thisWeekActive: false });
  });

  it("counts multiple ratings in one week as one active week", () => {
    const ratings = [
      rating({ id: "a", createdAt: NOW }),
      rating({ id: "b", createdAt: NOW - DAY }),
    ];
    expect(currentStreak(ratings, NOW)).toEqual({ weeks: 1, thisWeekActive: true });
  });
});

describe("earnedBadges", () => {
  const noRatings: Rating[] = [];

  it("returns nothing for a brand-new user", () => {
    expect(earnedBadges({ ratings: noRatings, thronesAdded: 0, streakWeeks: 0, now: NOW })).toEqual([]);
  });

  it("grants first_of_their_name only on a verified rating", () => {
    expect(
      earnedBadges({ ratings: [rating({ verified: false })], thronesAdded: 0, streakWeeks: 0, now: NOW })
    ).not.toContain("first_of_their_name");
    expect(
      earnedBadges({ ratings: [rating({ verified: true })], thronesAdded: 0, streakWeeks: 0, now: NOW })
    ).toContain("first_of_their_name");
  });

  it("grants cartographer when thronesAdded > 0", () => {
    expect(earnedBadges({ ratings: noRatings, thronesAdded: 1, streakWeeks: 0, now: NOW })).toContain("cartographer");
  });

  it("grants nights_watch for a rating before 05:00 UTC but not at 05:00", () => {
    const preDawn = rating({ createdAt: Date.UTC(2026, 6, 16, 4, 59) });
    const fiveAM = rating({ createdAt: Date.UTC(2026, 6, 16, 5, 0) });
    expect(earnedBadges({ ratings: [preDawn], thronesAdded: 0, streakWeeks: 0, now: NOW })).toContain("nights_watch");
    expect(earnedBadges({ ratings: [fiveAM], thronesAdded: 0, streakWeeks: 0, now: NOW })).not.toContain("nights_watch");
  });

  it("grants oathkeeper at exactly the threshold, not below", () => {
    expect(earnedBadges({ ratings: noRatings, thronesAdded: 0, streakWeeks: OATHKEEPER_WEEKS - 1, now: NOW })).not.toContain("oathkeeper");
    expect(earnedBadges({ ratings: noRatings, thronesAdded: 0, streakWeeks: OATHKEEPER_WEEKS, now: NOW })).toContain("oathkeeper");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm run test -- src/lib/recognition.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `src/lib/recognition.ts`:

```typescript
import { weekWindow } from "./standings";
import type { BadgeId, Rating } from "./types";

export const OATHKEEPER_WEEKS = 4;

const WEEK_MS = 7 * 86_400_000;

/** Consecutive Mon-00:00-UTC weeks with >= 1 verified rating. `weeks` is the run
 * ending at the current week (if active) else at last week; `thisWeekActive`
 * flags whether the current week already counts. */
export function currentStreak(
  ratings: Rating[],
  now: number
): { weeks: number; thisWeekActive: boolean } {
  const activeStarts = new Set<number>();
  for (const r of ratings) {
    if (!r.verified) continue;
    activeStarts.add(weekWindow(r.createdAt).start);
  }

  const thisWeekStart = weekWindow(now).start;
  const thisWeekActive = activeStarts.has(thisWeekStart);

  // Start counting at this week if active, otherwise at last week.
  let cursor = thisWeekActive ? thisWeekStart : thisWeekStart - WEEK_MS;
  let weeks = 0;
  while (activeStarts.has(cursor)) {
    weeks += 1;
    cursor -= WEEK_MS;
  }

  return { weeks, thisWeekActive };
}

export function earnedBadges(input: {
  ratings: Rating[];
  thronesAdded: number;
  streakWeeks: number;
  now: number;
}): BadgeId[] {
  const { ratings, thronesAdded, streakWeeks } = input;
  const badges: BadgeId[] = [];

  if (ratings.some((r) => r.verified)) badges.push("first_of_their_name");
  if (thronesAdded > 0) badges.push("cartographer");
  if (ratings.some((r) => new Date(r.createdAt).getUTCHours() < 5)) badges.push("nights_watch");
  if (streakWeeks >= OATHKEEPER_WEEKS) badges.push("oathkeeper");

  return badges;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm run test -- src/lib/recognition.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recognition.ts src/lib/recognition.test.ts
git commit -m "feat(recognition): streak + computed-badge selectors"
```

---

## Task 2: Extend BadgeId

**Files:** Modify `src/lib/types.ts`

- [ ] **Step 1: Widen the type**

In `src/lib/types.ts`, change line 73:

```typescript
export type BadgeId = "first_of_their_name" | "cartographer" | "nights_watch" | "oathkeeper";
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: compiles (Task 1 already used the new members via the widened type). If `ProfilePanel`'s `BADGE_META` (typed `Record<BadgeId, …>`) now errors for missing keys, that is fixed in Task 5 — you may see it here; proceed to Task 5 before declaring build green.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(recognition): add nights_watch + oathkeeper BadgeIds"
```

---

## Task 3: Compute badges + streak in mePayload; remove imperative writes

**Files:** Modify `src/lib/server/profile.ts`, `src/lib/server/ratings.ts`, `src/lib/server/thrones.ts`

- [ ] **Step 1: Read the three files first**

Run: `grep -n "badges\|mePayload\|thronesAdded\|addedBy\|first_of_their_name\|cartographer" src/lib/server/profile.ts src/lib/server/ratings.ts src/lib/server/thrones.ts`
Understand: how `mePayload` currently builds its return (it returns `badges: user.badges` around `src/lib/server/profile.ts:63`); the exact badge-write blocks in `ratings.ts` (~lines 95-98) and `thrones.ts` (~lines 31-32). Note the table/columns for the user's ratings and thrones-added count (`ratings.userId`, `thrones.addedBy`).

- [ ] **Step 2: Compute in `mePayload`**

In `src/lib/server/profile.ts`, within `mePayload(userId)`: load the user's ratings and their thrones-added count, then compute streak + badges. Mirror how the file already maps DB rating rows to game `Rating`s (reuse the existing mapper — likely `toGameRating` from `./mappers`; if `mePayload` doesn't already import it, add it). Sketch (adapt to the file's actual style and existing `db`/`now` usage):

```typescript
import { eq, sql } from "drizzle-orm";
import { ratings as ratingsTable, thrones } from "@/db/schema";
import { currentStreak, earnedBadges } from "@/lib/recognition";
import { toGameRating } from "./mappers";
// ...
const now = Date.now();
const myRatingRows = await db
  .select({ rating: ratingsTable, displayName: users.displayName, houseId: users.houseId })
  .from(ratingsTable)
  .innerJoin(users, eq(ratingsTable.userId, users.id))
  .where(eq(ratingsTable.userId, userId));
const myRatings = myRatingRows.map((r) => toGameRating(r.rating, { displayName: r.displayName, houseId: r.houseId }));
const [{ n: thronesAdded }] = await db
  .select({ n: sql<number>`count(*)::int` })
  .from(thrones)
  .where(eq(thrones.addedBy, userId));
const streak = currentStreak(myRatings, now);
const badges = earnedBadges({ ratings: myRatings, thronesAdded, streakWeeks: streak.weeks, now });
```

Return `badges` (computed) and add `streak` to the returned object, replacing the previous `badges: user.badges`. If the exact `toGameRating` signature differs, match it — the goal is a `Rating[]` with correct `verified` and `createdAt` (ms number). Only `verified` and `createdAt` are actually read by the selectors, so a lighter projection (`select({ verified, createdAt })` mapped to `{ verified, createdAt: createdAt.getTime() }` plus filler fields) is acceptable if simpler.

- [ ] **Step 3: Remove the imperative badge writes**

- In `src/lib/server/ratings.ts`, delete the block that appends `"first_of_their_name"` to `badges` and writes `users.badges` (~lines 95-98). **Keep** the `first_of_name` Influence event and its point bonus.
- In `src/lib/server/thrones.ts`, delete the block that appends `"cartographer"` and writes `users.badges` (~lines 31-32). **Keep** any Influence logic.
- If removing these leaves unused variables/imports (e.g. a now-unused `badges` local or `users` import), clean them up so lint/build stays green.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: compiles (modulo the ProfilePanel BADGE_META change in Task 5).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/profile.ts src/lib/server/ratings.ts src/lib/server/thrones.ts
git commit -m "feat(recognition): compute badges + streak in mePayload; drop imperative writes"
```

---

## Task 4: Client DTO — streak

**Files:** Modify `src/lib/api.ts`

- [ ] **Step 1: Add `streak` to `MeDTO`**

In `src/lib/api.ts`, extend `MeDTO` (currently ends around line 25) to include:

```typescript
  streak?: { weeks: number; thisWeekActive: boolean };
```

(`badges: string[]` stays; it now carries the computed list.)

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean (pending Task 5).

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(recognition): MeDTO.streak"
```

---

## Task 5: ProfilePanel — new badges + streak line

**Files:** Modify `src/components/ProfilePanel.tsx` (and `src/lib/store.tsx` if streak must be threaded)

- [ ] **Step 1: Read the current badge display**

Run: `grep -n "BADGE_META\|badges\|streak\|profile\.\|useStore\|MeDTO" src/components/ProfilePanel.tsx src/lib/store.tsx`
Read the `BADGE_META` record (~lines 10-30) and the badges render block (~lines 120-135) to match the existing style, and see how the me payload (badges/rank) reaches the panel.

- [ ] **Step 2: Add the two badges to `BADGE_META`**

Extend the `Record<BadgeId, {icon,title,desc}>` with themed entries (match the tone of the existing two):

```typescript
  nights_watch: {
    icon: "🌙",
    title: "The Night's Watch",
    desc: "Rated a throne in the small hours (before 5am).",
  },
  oathkeeper: {
    icon: "🛡️",
    title: "Oathkeeper",
    desc: "Kept a 4-week streak of verified deeds.",
  },
```

- [ ] **Step 3: Render the streak**

Add a streak line near the rank/badges area, driven by `streak` from the me payload. Example, adapting to how the panel accesses data and the copy system:

```tsx
{streak && streak.weeks > 0 && (
  <p className="font-mono text-[13px] text-ink-soft">
    🔥 {streak.weeks}-week streak
    {!streak.thisWeekActive && (
      <span className="text-ink-faint"> · {t("streakAtRisk")}</span>
    )}
  </p>
)}
```

Thread `streak` through the same channel `badges`/`rank` use. If it isn't on the store's profile/me shape yet, add it where `src/lib/store.tsx` maps the me response (mirror the `badges` handling) so `ProfilePanel` can read it.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean; `BADGE_META` now covers all four `BadgeId`s.

- [ ] **Step 5: Commit**

```bash
git add src/components/ProfilePanel.tsx src/lib/store.tsx
git commit -m "feat(recognition): ProfilePanel badges + streak line"
```

---

## Task 6: Plain-speech copy

**Files:** Modify `src/lib/copy.tsx`

- [ ] **Step 1: Add functional streak wording**

Following the existing `{themed, plain}` dictionary shape (see Cycle A's additions), add e.g.:

```typescript
  streakAtRisk: { themed: "at risk — rate this week to keep it", plain: "at risk — rate this week to keep it" },
```

(Badge titles stay themed via `BADGE_META`; they are game identity, not run through the copy dictionary.)

- [ ] **Step 2: Test + build**

Run: `npm run test -- src/lib/copy.test.ts` then `npm run build`
Expected: PASS + clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/copy.tsx
git commit -m "feat(recognition): plain-speech for streak wording"
```

---

## Task 7: Update server tests to the computed model

**Files:** Modify `src/test/ratings.test.ts`, `src/test/thrones.test.ts`

- [ ] **Step 1: Find the stale assertions**

Run: `grep -n "badges\|first_of_their_name\|cartographer\|mePayload" src/test/ratings.test.ts src/test/thrones.test.ts`
The current tests assert the stored `users.badges` column contains the badge after the action (e.g. `src/test/ratings.test.ts:23`).

- [ ] **Step 2: Rewrite to assert computed badges**

Replace each stored-column assertion with one that calls `mePayload(userId)` after the action and asserts the returned `badges` contains the expected badge. Example (adapt to the test's existing setup/imports):

```typescript
import { mePayload } from "@/lib/server/profile";
// ... after the first verified rating for `userId`:
const me = await mePayload(userId);
expect(me.badges).toContain("first_of_their_name");
```

For `thrones.test.ts`, likewise assert `cartographer` via `mePayload` after adding a throne. Keep every other assertion (influence points, flips, etc.) intact.

- [ ] **Step 3: Run those suites**

Run: `npm run test -- src/test/ratings.test.ts src/test/thrones.test.ts`
Expected: PASS. If a DB connection is unavailable in your environment, note it — the parent runs these against the real DB.

- [ ] **Step 4: Commit**

```bash
git add src/test/ratings.test.ts src/test/thrones.test.ts
git commit -m "test(recognition): assert computed badges via mePayload"
```

---

## Task 8: Full verification

- [ ] **Step 1:** `npm run test` → all pass against the real DB (note count vs. the 154 Cycle-A baseline).
- [ ] **Step 2:** `npm run build` → clean.
- [ ] **Step 3: Live-verify** (signed in): the profile shows the correct badges for the account's history and a streak line; a pre-05:00-UTC rating yields Night's Watch; a 4-week verified run yields Oathkeeper + "🔥 4-week streak"; a lapsed current week shows "at risk". (If the preview pane is unavailable, verify via `mePayload` output / a direct `/api/me` fetch while signed in.)
- [ ] **Step 4: Roadmap** — in `docs/ROADMAP.md`, check off *Titles & badges* and *Streaks* under Phase 3, annotated shipped-in-Cycle-B (note Breaker of Chains + streak-protection deferred), mirroring the Cycle-A annotation style.
- [ ] **Step 5:** `git add docs/ROADMAP.md && git commit -m "docs: mark Phase 3 Cycle B (Recognition) shipped"`

---

## Self-Review Notes (for the executor)

- **Verify assumptions early (Task 3 Step 1):** the exact `mePayload` shape, the `toGameRating` signature, and the precise badge-write blocks to delete. Do not guess — grep first.
- **Only `verified` + `createdAt` are read** by the selectors, so the ratings projection in `mePayload` can be minimal.
- **Removing the imperative writes will break the old stored-column tests** — Task 7 rewrites them; don't skip it or the suite stays red.
- **`weekWindow` is reused** from `standings.ts` (Cycle A) — do not duplicate week math.
- **`users.badges` column is intentionally left in place** (no migration); it is simply no longer read or written.
