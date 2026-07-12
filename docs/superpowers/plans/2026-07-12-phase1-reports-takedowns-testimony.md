# Phase 1 Cycle A: Reports, Takedowns, Enforcement, Testimony — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User report flows on thrones/ratings, moderator takedowns with influence reversal, account suspend/ban, and Scroll of Testimony with hybrid AI screening — per `docs/superpowers/specs/2026-07-12-phase1-reports-takedowns-testimony-design.md`.

**Architecture:** Soft-hide columns + append-only negative "reversal" influence events (copying original `createdAt` so decay cancels exactly). Reports dedupe per reporter and merge into one pending `review_queue` row per subject. Testimony is screened synchronously by one Haiku call (block severe / flag borderline / fail open). One `POST /api/moderate` endpoint dispatches all moderator actions and auto-resolves queue rows.

**Tech Stack:** Same as sub-project 1 — Next.js 16 route handlers, Drizzle/Neon, zod v4, Vitest against the `.env.test` DB, `@anthropic-ai/sdk` structured outputs.

**Division of labor:** Codex writes code and runs `npx.cmd tsc --noEmit` ONLY (sandbox has no network/git). Claude runs `npm test`, `npm run build`, `npm run db:generate`/`db:migrate` (BOTH DBs — see memory `test-db-needs-own-migrations`), browser verification, and every commit. Deploy is pre-authorized by Larry for this push.

**File map:**

| File | Role |
|---|---|
| `src/db/schema.ts` (modify) | `reports` table; enum additions; hide/enforcement/testimony columns; `ReviewSignal` variants |
| `src/lib/types.ts` (modify) | `InfluenceEvent.reason` += `"reversal"` |
| `drizzle/0003_phase1-cycle-a.sql` (generated) | migration |
| `src/lib/server/standing.ts` (create) | `requireGoodStanding`, suspend/ban/reinstate |
| `src/lib/server/enforcement.ts` (create) | `hideThrone`/`hideRating`/`hideTestimony` + reversal insertion |
| `src/lib/server/testimonyScreen.ts` (create) | `ScreenClient`, `anthropicScreenClient`, fail-open `screenTestimony` |
| `src/lib/server/reports.ts` (create) | `submitReport` + queue merging/escalation |
| `src/lib/server/realm.ts`, `mappers.ts`, `profile.ts` (modify) | hidden filtering, testimony passthrough/masking, XP clamp |
| `src/lib/server/ratings.ts`, `thrones.ts` (modify) | testimony storage; hidden-throne 404s; `ratingId` on update-return |
| `src/lib/server/triage.ts` (modify) | `buildPrompt` handles `report`/`testimony` kinds |
| `src/lib/server/review.ts` (modify) | DTO gains `subjectKind`/`subjectId`/`actorUserId` |
| `src/app/api/report/route.ts`, `src/app/api/moderate/route.ts` (create) | new endpoints |
| `src/app/api/ratings\|thrones\|thrones/[id]/confirm\|profile/route.ts` (modify) | standing gate; testimony screen wiring |
| `src/components/SittingFlow.tsx`, `ThroneSheet.tsx`, `ReportModal.tsx` (new), `ModerationQueue.tsx`, `src/lib/api.ts`, `src/lib/store.tsx` (modify) | client |
| `src/test/{schema,standing,enforcement,realm-filtering,testimony-screen,testimony,reports,moderate}.test.ts` | tests |

---

### Task 1: Schema + migration

**Files:**
- Modify: `src/db/schema.ts`, `src/lib/types.ts`, `src/test/db.ts`
- Test: `src/test/schema.test.ts` (append)

- [ ] **Step 1: Write the failing tests** — append to `src/test/schema.test.ts`:

```ts
import { influenceEvents, reports, thrones } from "@/db/schema";

describe("cycle A schema", () => {
  beforeEach(resetDb);

  const AMEN = { accessible: false, babyChanging: false, genderNeutral: false, freeAccess: true, open24h: false };

  it("reports dedupe per reporter+subject via unique index", async () => {
    const [u] = await db.insert(users).values({
      googleSubject: "sub-rep", displayName: "Reporter", houseId: "flush",
    }).returning();
    const subjectId = "00000000-0000-0000-0000-000000000042";
    await db.insert(reports).values({ reporterId: u.id, subjectKind: "throne", subjectId, reason: "closed" });
    await expect(
      db.insert(reports).values({ reporterId: u.id, subjectKind: "throne", subjectId, reason: "spam" })
    ).rejects.toThrow();
  });

  it("hide/enforcement/testimony columns default null", async () => {
    const [u] = await db.insert(users).values({
      googleSubject: "sub-cols", displayName: "Cols", houseId: "flush",
    }).returning();
    expect(u.suspendedUntil).toBeNull();
    expect(u.bannedAt).toBeNull();
    const [t] = await db.insert(thrones).values({
      name: "T", lat: 1, lng: 1, category: "cafe", amenities: AMEN,
      addedBy: u.id, publicAccessAttested: true,
    }).returning();
    expect(t.hiddenAt).toBeNull();
    const [r] = await db.insert(ratings).values({
      throneId: t.id, userId: u.id, verdict: 3, tags: [], verified: false, testimony: "clean enough",
    }).returning();
    expect(r.testimony).toBe("clean enough");
    expect(r.hiddenAt).toBeNull();
    expect(r.testimonyHiddenAt).toBeNull();
  });

  it("influence ledger accepts negative reversal events", async () => {
    const [u] = await db.insert(users).values({
      googleSubject: "sub-rev", displayName: "Rev", houseId: "flush",
    }).returning();
    const [t] = await db.insert(thrones).values({
      name: "T2", lat: 1, lng: 1, category: "cafe", amenities: AMEN,
      addedBy: u.id, publicAccessAttested: true,
    }).returning();
    const [ev] = await db.insert(influenceEvents).values({
      fiefId: "f1", houseId: "flush", userId: u.id, points: -10, reason: "reversal", throneId: t.id,
    }).returning();
    expect(ev.points).toBe(-10);
  });
});
```

(Adjust the import line to merge with whatever the file already imports.)

- [ ] **Step 2 (Claude): Run to verify failure**

Run: `npx vitest run src/test/schema.test.ts`
Expected: FAIL — `reports` not exported / columns missing.

- [ ] **Step 3: Implement schema** — in `src/db/schema.ts`:

Extend existing enums (edit the value arrays in place):

```ts
export const influenceReasonEnum = pgEnum("influence_reason", [
  "rating", "first_of_name", "new_throne", "confirmation", "hearsay", "reversal",
]);
export const reviewKindEnum = pgEnum("review_kind", ["rating", "new_throne", "confirmation", "report", "testimony"]);
```

New enums:

```ts
export const reportSubjectEnum = pgEnum("report_subject", ["throne", "rating"]);
export const reportReasonEnum = pgEnum("report_reason", [
  "wrong_info", "closed", "inappropriate", "not_public_restroom", "harassment", "spam",
]);
```

Column additions — `users`:

```ts
suspendedUntil: timestamp("suspended_until", { withTimezone: true }),
bannedAt: timestamp("banned_at", { withTimezone: true }),
```

`thrones`:

```ts
hiddenAt: timestamp("hidden_at", { withTimezone: true }),
hiddenBy: uuid("hidden_by").references(() => users.id),
```

`ratings`:

```ts
testimony: text("testimony"),
hiddenAt: timestamp("hidden_at", { withTimezone: true }),
hiddenBy: uuid("hidden_by").references(() => users.id),
testimonyHiddenAt: timestamp("testimony_hidden_at", { withTimezone: true }),
testimonyHiddenBy: uuid("testimony_hidden_by").references(() => users.id),
```

`ReviewSignal` union — replace with:

```ts
export type ReviewSignal =
  | { signal: "new_account"; accountAgeDays: number }
  | { signal: "rate_soft"; writesLastHour: number }
  | { signal: "impossible_travel"; kmh: number; fromThroneId: string; minutes: number }
  | { signal: "new_throne" }
  | { signal: "user_report"; reason: string; reporterCount: number }
  | { signal: "testimony_blocked"; category: string }
  | { signal: "testimony_flagged"; category?: string }
  | { signal: "screen_unavailable" };
```

New table (add `uniqueIndex` to the drizzle-orm/pg-core imports):

```ts
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reporterId: uuid("reporter_id").notNull().references(() => users.id),
    subjectKind: reportSubjectEnum("subject_kind").notNull(),
    subjectId: uuid("subject_id").notNull(), // throne or rating id — spans tables, no FK
    reason: reportReasonEnum("reason").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reports_reporter_subject_idx").on(t.reporterId, t.subjectKind, t.subjectId),
    index("reports_subject_idx").on(t.subjectKind, t.subjectId),
  ]
);
```

`src/lib/types.ts` — extend the reason union:

```ts
reason: "rating" | "first_of_name" | "new_throne" | "confirmation" | "hearsay" | "reversal";
```

`src/test/db.ts` — TRUNCATE list gains `reports`:

```ts
sql`TRUNCATE TABLE reports, review_queue, age_attestations, ratings, influence_events, ledger_entries, thrones, users CASCADE`
```

- [ ] **Step 4 (Claude): Generate + apply migration to BOTH DBs**

Run: `npm run db:generate -- --name phase1-cycle-a`
Inspect `drizzle/0003_phase1-cycle-a.sql` (expect ALTER TYPE ADD VALUE ×3, two new enums, new table, ADD COLUMN ×9). No hand edits needed.
Run: `npm run db:migrate`
Run: `export DATABASE_URL="$(grep '^DATABASE_URL=' .env.test | cut -d= -f2- | tr -d '\"')" && npm run db:migrate`

- [ ] **Step 5 (Claude): Verify pass**

Run: `npx vitest run src/test/schema.test.ts`
Expected: PASS.

- [ ] **Step 6 (Claude): Commit**

```bash
git add src/db/schema.ts src/lib/types.ts src/test/db.ts src/test/schema.test.ts drizzle/
git commit -m "feat: cycle-A schema — reports, soft-hide, enforcement, testimony, reversal"
```

---

### Task 2: Standing module (suspend / ban / reinstate)

**Files:**
- Create: `src/lib/server/standing.ts`
- Test: `src/test/standing.test.ts`

- [ ] **Step 1: Failing tests** — `src/test/standing.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { banUser, reinstateUser, requireGoodStanding, StandingError, suspendUser } from "@/lib/server/standing";
import { resetDb } from "./db";
import { makeUser } from "./fixtures";

const DAY = 86_400_000;

describe("standing", () => {
  beforeEach(resetDb);

  it("clean users pass", async () => {
    const user = await makeUser();
    expect(() => requireGoodStanding(user)).not.toThrow();
  });

  it("banned users throw banished", async () => {
    const user = await makeUser();
    const banned = await banUser(user.id);
    try {
      requireGoodStanding(banned);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(StandingError);
      expect((e as StandingError).code).toBe("banished");
    }
  });

  it("suspension blocks until the date, then expires", async () => {
    const user = await makeUser();
    const now = Date.now();
    const suspended = await suspendUser(user.id, 7, now);
    expect(suspended.suspendedUntil!.getTime()).toBe(now + 7 * DAY);
    expect(() => requireGoodStanding(suspended, now + 6 * DAY)).toThrow(StandingError);
    expect(() => requireGoodStanding(suspended, now + 8 * DAY)).not.toThrow();
  });

  it("reinstate clears both levers", async () => {
    const user = await makeUser();
    await suspendUser(user.id, 30);
    await banUser(user.id);
    const clean = await reinstateUser(user.id);
    expect(clean.suspendedUntil).toBeNull();
    expect(clean.bannedAt).toBeNull();
    expect(() => requireGoodStanding(clean)).not.toThrow();
  });
});
```

- [ ] **Step 2 (Claude): Verify fail** — `npx vitest run src/test/standing.test.ts` → module missing.

- [ ] **Step 3: Implement** — `src/lib/server/standing.ts`:

```ts
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";

type UserRow = typeof users.$inferSelect;

export class StandingError extends Error {
  status = 403;
  constructor(public code: "banished" | "suspended", public until?: Date) {
    super(code);
  }
}

/** Sync check against the already-fetched session user row — no extra query.
 * Bans win over suspensions. Reads are never gated, only writes. */
export function requireGoodStanding(
  user: Pick<UserRow, "bannedAt" | "suspendedUntil">,
  now = Date.now()
): void {
  if (user.bannedAt) throw new StandingError("banished");
  if (user.suspendedUntil && user.suspendedUntil.getTime() > now) {
    throw new StandingError("suspended", user.suspendedUntil);
  }
}

export async function suspendUser(userId: string, days: number, now = Date.now()) {
  const [u] = await db.update(users)
    .set({ suspendedUntil: new Date(now + days * 86_400_000) })
    .where(eq(users.id, userId)).returning();
  return u;
}

export async function banUser(userId: string, now = Date.now()) {
  const [u] = await db.update(users)
    .set({ bannedAt: new Date(now) })
    .where(eq(users.id, userId)).returning();
  return u;
}

export async function reinstateUser(userId: string) {
  const [u] = await db.update(users)
    .set({ bannedAt: null, suspendedUntil: null })
    .where(eq(users.id, userId)).returning();
  return u;
}
```

- [ ] **Step 4 (Claude): Verify pass + commit**

```bash
git add src/lib/server/standing.ts src/test/standing.test.ts
git commit -m "feat: account standing — suspend, ban, reinstate, write gate"
```

---

### Task 3: Enforcement module (takedowns + reversal events)

Also pulls one sliver of Task 6 forward so the tests compile: `SubmitRatingInput.testimony` (field + insert only, no screening).

**Files:**
- Create: `src/lib/server/enforcement.ts`
- Modify: `src/lib/server/ratings.ts` (testimony field + `ratingId` on update-return)
- Test: `src/test/enforcement.test.ts`

- [ ] **Step 1: Failing tests** — `src/test/enforcement.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { influenceEvents, ledgerEntries, ratings, thrones } from "@/db/schema";
import { EnforcementError, hideRating, hideTestimony, hideThrone } from "@/lib/server/enforcement";
import { submitRating } from "@/lib/server/ratings";
import { fiefControl } from "@/lib/selectors";
import { toGameEvent } from "@/lib/server/mappers";
import { fiefIdForCoords } from "@/lib/geo";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

const DAY = 86_400_000;

async function fiefTotal(fiefId: string, now: number) {
  const rows = await db.select().from(influenceEvents);
  return fiefControl(fiefId, rows.map(toGameEvent), now).totalInfluence;
}

describe("hideRating reversal math", () => {
  beforeEach(resetDb);

  it("returns fief control to zero at any later time (decay cancels)", async () => {
    const user = await makeUser();
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    const fiefId = fiefIdForCoords(throne.lat, throne.lng);
    const t0 = Date.now();

    const result = await submitRating(user, { throneId: throne.id, verdict: 5, tags: [], verified: true }, t0);
    expect(await fiefTotal(fiefId, t0)).toBeGreaterThan(0);

    const mod = await makeUser({ role: "moderator" });
    await hideRating(result.ratingId, mod, t0 + DAY);

    expect(await fiefTotal(fiefId, t0 + DAY)).toBeCloseTo(0, 10);
    expect(await fiefTotal(fiefId, t0 + 10 * DAY)).toBeCloseTo(0, 10);

    const [hidden] = await db.select().from(ratings).where(eq(ratings.id, result.ratingId));
    expect(hidden.hiddenAt).not.toBeNull();
  });

  it("double-hide 409s and never double-reverses", async () => {
    const user = await makeUser();
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    const t0 = Date.now();
    const result = await submitRating(user, { throneId: throne.id, verdict: 4, tags: [], verified: true }, t0);
    const mod = await makeUser({ role: "moderator" });
    await hideRating(result.ratingId, mod);
    await expect(hideRating(result.ratingId, mod)).rejects.toMatchObject({ status: 409 });
    const reversals = (await db.select().from(influenceEvents)).filter((e) => e.reason === "reversal");
    expect(reversals).toHaveLength(2); // rating event + first-of-name bonus, once each
  });
});

describe("hideThrone", () => {
  beforeEach(resetDb);

  it("cancels ALL the throne's events, skipping already-reversed ratings", async () => {
    const rater = await makeUser();
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    const fiefId = fiefIdForCoords(throne.lat, throne.lng);
    const t0 = Date.now();
    const r1 = await submitRating(rater, { throneId: throne.id, verdict: 5, tags: [], verified: true }, t0);
    const rater2 = await makeUser({ houseId: "bidet" });
    await submitRating(rater2, { throneId: throne.id, verdict: 2, tags: [], verified: false }, t0 + 1000);

    const mod = await makeUser({ role: "moderator" });
    await hideRating(r1.ratingId, mod, t0 + 2000); // one rating already taken down
    await hideThrone(throne.id, mod, t0 + 3000);   // then the whole throne

    expect(await fiefTotal(fiefId, t0 + 5 * DAY)).toBeCloseTo(0, 10);

    const [hidden] = await db.select().from(thrones).where(eq(thrones.id, throne.id));
    expect(hidden.hiddenAt).not.toBeNull();
    const ledger = await db.select().from(ledgerEntries);
    expect(ledger.some((l) => l.text.includes("strike") && l.text.includes(throne.name))).toBe(true);
  });

  it("404s a missing throne and 409s an already-hidden one", async () => {
    const mod = await makeUser({ role: "moderator" });
    await expect(hideThrone("00000000-0000-0000-0000-000000000001", mod)).rejects.toBeInstanceOf(EnforcementError);
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    await hideThrone(throne.id, mod);
    await expect(hideThrone(throne.id, mod)).rejects.toMatchObject({ status: 409 });
  });
});

describe("hideTestimony", () => {
  beforeEach(resetDb);

  it("strikes only the text — influence and rating stand", async () => {
    const user = await makeUser();
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    const fiefId = fiefIdForCoords(throne.lat, throne.lng);
    const t0 = Date.now();
    const result = await submitRating(user, { throneId: throne.id, verdict: 5, tags: [], verified: true, testimony: "a throne most foul" }, t0);
    const before = await fiefTotal(fiefId, t0);

    const mod = await makeUser({ role: "moderator" });
    await hideTestimony(result.ratingId, mod);

    expect(await fiefTotal(fiefId, t0)).toBeCloseTo(before, 10);
    const [row] = await db.select().from(ratings).where(eq(ratings.id, result.ratingId));
    expect(row.testimonyHiddenAt).not.toBeNull();
    expect(row.hiddenAt).toBeNull();
    expect(row.testimony).toBe("a throne most foul"); // text kept for audit, masked at serve time
  });
});
```

- [ ] **Step 2 (Claude): Verify fail** — `npx vitest run src/test/enforcement.test.ts`.

- [ ] **Step 3: Implement** — `src/lib/server/enforcement.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { influenceEvents, ledgerEntries, ratings, thrones, users } from "@/db/schema";

type UserRow = typeof users.$inferSelect;
type EventRow = typeof influenceEvents.$inferSelect;

export class EnforcementError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Reversals negate originals 1:1 and copy the ORIGINAL createdAt so the
 * 0.98^days fief decay cancels exactly for all time. Originals that already
 * have a matching reversal are skipped (idempotence across rating-then-throne
 * takedowns). */
function unreversed(events: EventRow[]): EventRow[] {
  const originals = events.filter((e) => e.reason !== "reversal");
  const reversals = events.filter((e) => e.reason === "reversal");
  return originals.filter(
    (o) => !reversals.some(
      (r) =>
        r.userId === o.userId &&
        r.fiefId === o.fiefId &&
        r.houseId === o.houseId &&
        r.points === -o.points &&
        r.createdAt.getTime() === o.createdAt.getTime()
    )
  );
}

function toReversalValues(events: EventRow[]) {
  return events.map((e) => ({
    fiefId: e.fiefId, houseId: e.houseId, userId: e.userId,
    points: -e.points, reason: "reversal" as const,
    throneId: e.throneId, createdAt: e.createdAt,
  }));
}

export async function hideThrone(throneId: string, moderator: UserRow, now = Date.now()) {
  return db.transaction(async (tx) => {
    const throne = await tx.query.thrones.findFirst({ where: eq(thrones.id, throneId) });
    if (!throne) throw new EnforcementError("no such throne", 404);
    if (throne.hiddenAt) throw new EnforcementError("already stricken", 409);

    const events = await tx.select().from(influenceEvents).where(eq(influenceEvents.throneId, throneId));
    const values = toReversalValues(unreversed(events));
    if (values.length > 0) await tx.insert(influenceEvents).values(values);

    await tx.update(thrones)
      .set({ hiddenAt: new Date(now), hiddenBy: moderator.id })
      .where(eq(thrones.id, throneId));
    await tx.insert(ledgerEntries).values({
      text: `⚖️ The Maesters strike **${throne.name}** from the record.`,
      createdAt: new Date(now),
    });
    return throne;
  });
}

export async function hideRating(ratingId: string, moderator: UserRow, now = Date.now()) {
  return db.transaction(async (tx) => {
    const rating = await tx.query.ratings.findFirst({ where: eq(ratings.id, ratingId) });
    if (!rating) throw new EnforcementError("no such rating", 404);
    if (rating.hiddenAt) throw new EnforcementError("already stricken", 409);

    // The rating's awards were inserted with createdAt === rating.createdAt
    // (rating/hearsay event + any first_of_name bonus).
    const events = await tx.select().from(influenceEvents).where(and(
      eq(influenceEvents.userId, rating.userId),
      eq(influenceEvents.throneId, rating.throneId),
      eq(influenceEvents.createdAt, rating.createdAt)
    ));
    const values = toReversalValues(unreversed(events));
    if (values.length > 0) await tx.insert(influenceEvents).values(values);

    await tx.update(ratings)
      .set({ hiddenAt: new Date(now), hiddenBy: moderator.id })
      .where(eq(ratings.id, ratingId));
    return rating;
  });
}

export async function hideTestimony(ratingId: string, moderator: UserRow, now = Date.now()) {
  const rating = await db.query.ratings.findFirst({ where: eq(ratings.id, ratingId) });
  if (!rating) throw new EnforcementError("no such rating", 404);
  if (!rating.testimony) throw new EnforcementError("no testimony to strike", 409);
  if (rating.testimonyHiddenAt) throw new EnforcementError("already stricken", 409);
  const [updated] = await db.update(ratings)
    .set({ testimonyHiddenAt: new Date(now), testimonyHiddenBy: moderator.id })
    .where(eq(ratings.id, ratingId)).returning();
  return updated;
}
```

`src/lib/server/ratings.ts` (the Task-6 sliver):

- `SubmitRatingInput` gains `testimony?: string`.
- The rating insert gains `testimony: input.testimony?.trim() || null,`.
- The `updated: true` early return gains `ratingId: latest.id`.

- [ ] **Step 4 (Claude): Verify pass** — `npx vitest run src/test/enforcement.test.ts`, then `npm test`.

- [ ] **Step 5 (Claude): Commit**

```bash
git add src/lib/server/enforcement.ts src/lib/server/ratings.ts src/test/enforcement.test.ts
git commit -m "feat: takedowns with append-only influence reversal events"
```

---

### Task 4: Realm filtering + XP clamp

**Files:**
- Modify: `src/lib/server/realm.ts`, `src/lib/server/mappers.ts`, `src/lib/server/profile.ts`, `src/lib/server/ratings.ts`, `src/lib/server/thrones.ts`
- Test: `src/test/realm-filtering.test.ts`

- [ ] **Step 1: Failing tests** — `src/test/realm-filtering.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { hideRating, hideTestimony, hideThrone } from "@/lib/server/enforcement";
import { mePayload } from "@/lib/server/profile";
import { realmPayload } from "@/lib/server/realm";
import { RatingError, submitRating } from "@/lib/server/ratings";
import { confirmThrone, ThroneError } from "@/lib/server/thrones";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

describe("realm filtering of hidden content", () => {
  beforeEach(resetDb);

  it("hidden thrones and their ratings vanish; writes against them 404", async () => {
    const adder = await makeUser();
    const rater = await makeUser({ houseId: "bidet" });
    const throne = await makeThrone(adder.id);
    await submitRating(rater, { throneId: throne.id, verdict: 4, tags: [], verified: true });

    const mod = await makeUser({ role: "moderator" });
    await hideThrone(throne.id, mod);

    const realm = await realmPayload();
    expect(realm.thrones.find((t) => t.id === throne.id)).toBeUndefined();
    expect(realm.ratings.filter((r) => r.throneId === throne.id)).toHaveLength(0);

    await expect(
      submitRating(rater, { throneId: throne.id, verdict: 3, tags: [], verified: false })
    ).rejects.toThrow(RatingError);
    const confirmer = await makeUser({ houseId: "plunger" });
    await expect(confirmThrone(confirmer, throne.id)).rejects.toThrow(ThroneError);
  });

  it("hidden ratings drop out of the score; stricken testimony masks to empty", async () => {
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    const r1 = await makeUser({ houseId: "bidet" });
    const r2 = await makeUser({ houseId: "plunger" });
    const bad = await submitRating(r1, { throneId: throne.id, verdict: 1, tags: [], verified: true, testimony: "vile" });
    await submitRating(r2, { throneId: throne.id, verdict: 5, tags: [], verified: true, testimony: "splendid" });

    const mod = await makeUser({ role: "moderator" });
    await hideRating(bad.ratingId, mod);

    const realm = await realmPayload();
    const dto = realm.thrones.find((t) => t.id === throne.id)!;
    expect(dto.ratingCount).toBe(1);
    expect(dto.score).toBe(5);

    const visible = realm.ratings.filter((r) => r.throneId === throne.id);
    expect(visible).toHaveLength(1);
    expect(visible[0].testimony).toBe("splendid");

    await hideTestimony(visible[0].id, mod);
    const realm2 = await realmPayload();
    expect(realm2.ratings.find((r) => r.id === visible[0].id)!.testimony).toBe("");
  });

  it("rank XP clamps at zero after reversals", async () => {
    const rater = await makeUser({ joinedAt: new Date() }); // ramped newbie
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    const res = await submitRating(rater, { throneId: throne.id, verdict: 5, tags: [], verified: true });
    const mod = await makeUser({ role: "moderator" });
    await hideRating(res.ratingId, mod);
    const me = await mePayload(rater.id);
    expect(me.rank.xp).toBe(0);
    expect(me.rank.name).toBe("Peasant");
  });
});
```

- [ ] **Step 2 (Claude): Verify fail.** `npx vitest run src/test/realm-filtering.test.ts`

- [ ] **Step 3: Implement.**

`src/lib/server/mappers.ts` — testimony passthrough with masking:

```ts
testimony: row.testimonyHiddenAt ? "" : (row.testimony ?? ""),
```

`src/lib/server/realm.ts` — filter hidden (add `isNull` to the drizzle-orm import):

```ts
db.select().from(thrones).where(isNull(thrones.hiddenAt)),
db.select({ rating: ratings, displayName: users.displayName, houseId: users.houseId })
  .from(ratings)
  .innerJoin(users, eq(ratings.userId, users.id))
  .where(isNull(ratings.hiddenAt)),
```

and after fetching, drop ratings on hidden thrones:

```ts
const visibleThroneIds = new Set(throneRows.map((t) => t.id));
const gameRatings = ratingRows
  .filter((r) => visibleThroneIds.has(r.rating.throneId))
  .map((r) => toGameRating(r.rating, { displayName: r.displayName, houseId: r.houseId }));
```

(Influence events are NOT filtered — reversal rows already cancel hidden content in the math.)

`src/lib/server/ratings.ts`:

```ts
if (!throne || throne.hiddenAt) throw new RatingError("no such throne", 404);
```

`src/lib/server/thrones.ts` (`confirmThrone`):

```ts
if (!throne || throne.hiddenAt) throw new ThroneError("no such throne", 404);
```

`src/lib/server/profile.ts` (`mePayload`):

```ts
const xp = Math.max(0, lifetimeXp(userId, events.map(toGameEvent)));
```

- [ ] **Step 4 (Claude): Full suite** — `npm test`.
- [ ] **Step 5 (Claude): Commit**

```bash
git add src/lib/server/realm.ts src/lib/server/mappers.ts src/lib/server/profile.ts src/lib/server/ratings.ts src/lib/server/thrones.ts src/test/realm-filtering.test.ts
git commit -m "feat: hidden content filtered from realm payload; rank XP clamps at 0"
```

---

### Task 5: Testimony screening module

**Files:**
- Create: `src/lib/server/testimonyScreen.ts`
- Test: `src/test/testimony-screen.test.ts`

- [ ] **Step 1: Failing tests** — `src/test/testimony-screen.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { screenTestimony, type ScreenClient } from "@/lib/server/testimonyScreen";

describe("screenTestimony", () => {
  it("passes through the client's verdict", async () => {
    const fake: ScreenClient = {
      async screen() { return { verdict: "block", category: "doxxing", note: "contains a street address" }; },
    };
    const result = await screenTestimony("123 Main St, ask for Dave", fake);
    expect(result.verdict).toBe("block");
    expect(result.category).toBe("doxxing");
  });

  it("fails OPEN on client error — flag with screen_unavailable", async () => {
    const failing: ScreenClient = {
      async screen() { throw new Error("api down"); },
    };
    const result = await screenTestimony("a fine privy", failing);
    expect(result.verdict).toBe("flag");
    expect(result.category).toBe("screen_unavailable");
    expect(result.note).toContain("api down");
  });
});
```

- [ ] **Step 2 (Claude): Verify fail.**

- [ ] **Step 3: Implement** — `src/lib/server/testimonyScreen.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";

export type ScreenVerdict = "allow" | "flag" | "block";
export interface ScreenResult {
  verdict: ScreenVerdict;
  category?: string;
  note: string;
}
export interface ScreenClient {
  screen(text: string): Promise<ScreenResult>;
}

const SYSTEM = `You review 280-character free-text restroom reviews ("testimony") for
"Shame of Thrones", a playful fantasy-themed restroom-rating game. Crude bathroom
humor, profanity, and colorful complaints are ALLOWED and expected — this is a game
about toilets. Your job is narrow:
- verdict "block" ONLY for: slurs/hate speech targeting protected groups; doxxing or
  personal information (a person's name paired with an address/phone/workplace shift);
  explicit threats of violence.
- verdict "flag" for borderline content a human moderator should glance at: targeted
  harassment of a specific individual, sexual content beyond bathroom humor, spam/ads.
- verdict "allow" for everything else, however vulgar.
Give category (slur, doxxing, threat, harassment, sexual, spam) when not "allow", and
a one-sentence note for the moderator (never shown to users).`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["allow", "flag", "block"] },
    category: { type: "string" },
    note: { type: "string" },
  },
  required: ["verdict", "note"],
  additionalProperties: false,
} as const;

export function anthropicScreenClient(): ScreenClient {
  const model = process.env.TRIAGE_MODEL ?? "claude-haiku-4-5";
  return {
    async screen(text) {
      // Lazy construction: a missing ANTHROPIC_API_KEY becomes a caught
      // screen failure (fail-open) instead of an unhandled throw.
      const client = new Anthropic();
      const response = await client.messages.create({
        model,
        max_tokens: 512,
        system: SYSTEM,
        output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
        messages: [{ role: "user", content: `Testimony to review:\n"""\n${text}\n"""` }],
      });
      const raw = response.content.find((b) => b.type === "text")?.text ?? "";
      const parsed = JSON.parse(raw) as ScreenResult;
      const verdict: ScreenVerdict = ["allow", "flag", "block"].includes(parsed.verdict)
        ? parsed.verdict
        : "flag";
      return { verdict, category: parsed.category, note: parsed.note };
    },
  };
}

/** Fail-open wrapper (Larry's rule: the action goes through; a human reviews). */
export async function screenTestimony(
  text: string,
  client: ScreenClient = anthropicScreenClient()
): Promise<ScreenResult> {
  try {
    return await client.screen(text);
  } catch (e) {
    return {
      verdict: "flag",
      category: "screen_unavailable",
      note: `Screen unavailable: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
```

- [ ] **Step 4 (Claude): Verify pass + commit**

```bash
git add src/lib/server/testimonyScreen.ts src/test/testimony-screen.test.ts
git commit -m "feat: testimony screening module — allow/flag/block with fail-open"
```

---

### Task 6: Testimony wiring in the ratings route

**Files:**
- Modify: `src/app/api/ratings/route.ts`, `src/lib/server/ratings.ts` (update-path testimony), `src/lib/server/triage.ts` (buildPrompt kinds)
- Test: `src/test/testimony.test.ts`

- [ ] **Step 1: Failing tests** — `src/test/testimony.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { ratings, reviewQueue } from "@/db/schema";
import { submitBirthDate } from "@/lib/server/ageGate";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/server/testimonyScreen", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server/testimonyScreen")>();
  return { ...mod, screenTestimony: vi.fn(mod.screenTestimony) };
});
import { auth } from "@/auth";
import { screenTestimony } from "@/lib/server/testimonyScreen";
import { POST as ratingsPOST } from "@/app/api/ratings/route";

function post(body: unknown) {
  return new Request("http://test/api/ratings", { method: "POST", body: JSON.stringify(body) });
}

async function attestedUser(overrides = {}) {
  const user = await makeUser(overrides);
  await submitBirthDate(user.googleSubject, "1990-01-01");
  vi.mocked(auth).mockResolvedValue({ googleSubject: user.googleSubject } as never);
  return user;
}

describe("testimony wiring", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(screenTestimony).mockReset();
  });

  it("allowed testimony persists with no queue row", async () => {
    const user = await attestedUser();
    const throne = await makeThrone(user.id);
    vi.mocked(screenTestimony).mockResolvedValue({ verdict: "allow", note: "fine" });
    const res = await ratingsPOST(post({ throneId: throne.id, verdict: 4, tags: [], verified: true, testimony: "a noble seat" }));
    expect(res.status).toBe(201);
    const [row] = await db.select().from(ratings);
    expect(row.testimony).toBe("a noble seat");
    const queue = await db.select().from(reviewQueue);
    expect(queue.filter((q) => q.kind === "testimony")).toHaveLength(0);
  });

  it("blocked testimony: rating posts WITHOUT text; high queue row carries category, never the text", async () => {
    const user = await attestedUser();
    const throne = await makeThrone(user.id);
    vi.mocked(screenTestimony).mockResolvedValue({ verdict: "block", category: "doxxing", note: "address disclosed" });
    const res = await ratingsPOST(post({ throneId: throne.id, verdict: 2, tags: [], verified: true, testimony: "clerk Dave lives at 12 Elm St" }));
    expect(res.status).toBe(201);
    expect((await res.json()).testimonyBlocked).toBe(true);
    const [row] = await db.select().from(ratings);
    expect(row.testimony).toBeNull();
    const [q] = (await db.select().from(reviewQueue)).filter((r) => r.kind === "testimony");
    expect(q.severity).toBe("high");
    expect(q.aiAssessment).toBe("address disclosed");
    expect(JSON.stringify(q.signals)).not.toContain("Elm St");
  });

  it("flagged testimony persists AND queues at medium with the pre-filled note", async () => {
    const user = await attestedUser();
    const throne = await makeThrone(user.id);
    vi.mocked(screenTestimony).mockResolvedValue({ verdict: "flag", category: "harassment", note: "targets an individual" });
    const res = await ratingsPOST(post({ throneId: throne.id, verdict: 1, tags: [], verified: true, testimony: "the day janitor is a troll" }));
    expect(res.status).toBe(201);
    const [row] = await db.select().from(ratings);
    expect(row.testimony).toBe("the day janitor is a troll");
    const [q] = (await db.select().from(reviewQueue)).filter((r) => r.kind === "testimony");
    expect(q.severity).toBe("medium");
    expect(q.aiAssessment).toBe("targets an individual");
    expect(q.aiTriagedAt).not.toBeNull();
  });

  it("screen_unavailable fails open: text persists, queue row pending triage", async () => {
    const user = await attestedUser();
    const throne = await makeThrone(user.id);
    vi.mocked(screenTestimony).mockResolvedValue({ verdict: "flag", category: "screen_unavailable", note: "Screen unavailable: api down" });
    await ratingsPOST(post({ throneId: throne.id, verdict: 3, tags: [], verified: true, testimony: "fine" }));
    const [q] = (await db.select().from(reviewQueue)).filter((r) => r.kind === "testimony");
    expect(q.signals).toEqual([{ signal: "screen_unavailable" }]);
    expect(q.aiTriagedAt).toBeNull(); // real triage still owed
  });

  it("empty testimony never calls the screen", async () => {
    const user = await attestedUser();
    const throne = await makeThrone(user.id);
    await ratingsPOST(post({ throneId: throne.id, verdict: 4, tags: [], verified: true }));
    expect(vi.mocked(screenTestimony)).not.toHaveBeenCalled();
  });

  it("24h update path screens too: blocked update keeps the old text", async () => {
    const user = await attestedUser();
    const throne = await makeThrone(user.id);
    vi.mocked(screenTestimony).mockResolvedValue({ verdict: "allow", note: "fine" });
    await ratingsPOST(post({ throneId: throne.id, verdict: 4, tags: [], verified: true, testimony: "original take" }));
    vi.mocked(screenTestimony).mockResolvedValue({ verdict: "block", category: "slur", note: "slur present" });
    const res = await ratingsPOST(post({ throneId: throne.id, verdict: 2, tags: [], verified: true, testimony: "something vile" }));
    expect(res.status).toBe(200);
    expect((await res.json()).testimonyBlocked).toBe(true);
    const [row] = await db.select().from(ratings);
    expect(row.testimony).toBe("original take");
  });
});
```

- [ ] **Step 2 (Claude): Verify fail.**

- [ ] **Step 3: Implement.**

`src/lib/server/ratings.ts` — update path stores testimony only when explicitly provided (`undefined` = leave unchanged):

```ts
if (latest && now - latest.createdAt.getTime() < RATING_UPDATE_WINDOW_MS) {
  await tx.update(ratings)
    .set({
      verdict: input.verdict, tags: input.tags, verified: input.verified,
      ...(input.testimony !== undefined ? { testimony: input.testimony.trim() || null } : {}),
    })
    .where(eq(ratings.id, latest.id));
  return { updated: true as const, influence: 0, flipped: false, firstOfName: false, ratingId: latest.id };
}
```

`src/app/api/ratings/route.ts` — full replacement:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { reviewQueue } from "@/db/schema";
import { RATING_TAGS } from "@/lib/game/rules";
import { AgeGateError, requireAgeGate } from "@/lib/server/ageGate";
import { RatingError, submitRating } from "@/lib/server/ratings";
import { sessionInfo } from "@/lib/server/session";
import { enforceHardCeiling, evaluateSignals, RateLimitError } from "@/lib/server/signals";
import { requireGoodStanding, StandingError } from "@/lib/server/standing";
import { screenTestimony, type ScreenResult } from "@/lib/server/testimonyScreen";
import { scheduleTriage } from "@/lib/server/triage";

const bodySchema = z.object({
  throneId: z.string().uuid(),
  verdict: z.number().int().min(1).max(5),
  tags: z.array(z.string().refine((t) => (RATING_TAGS as readonly string[]).includes(t), "unknown tag")).default([]),
  verified: z.boolean(),
  testimony: z.string().trim().max(280).optional(),
});

async function queueTestimonyRow(
  ratingId: string, userId: string, screen: ScreenResult, blocked: boolean, now: number
) {
  const unavailable = screen.category === "screen_unavailable";
  const [row] = await db.insert(reviewQueue).values({
    kind: "testimony",
    subjectId: ratingId,
    userId,
    signals: blocked
      ? [{ signal: "testimony_blocked", category: screen.category ?? "unspecified" }]
      : unavailable
        ? [{ signal: "screen_unavailable" }]
        : [{ signal: "testimony_flagged", category: screen.category }],
    severity: blocked ? "high" : "medium",
    // The screen's note doubles as triage — except when the screen never ran.
    ...(unavailable
      ? {}
      : { aiAssessment: screen.note, aiSeverity: blocked ? ("high" as const) : ("medium" as const), aiTriagedAt: new Date(now) }),
    createdAt: new Date(now),
  }).returning();
  if (unavailable) scheduleTriage(row.id);
}

export async function POST(req: Request) {
  const info = await sessionInfo();
  if (info.kind !== "user") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  try {
    await requireAgeGate(info.user.googleSubject);
    requireGoodStanding(info.user);
    await enforceHardCeiling(info.user.id);

    const now = Date.now();
    const testimony = parsed.data.testimony?.trim() || undefined;
    let screen: ScreenResult | null = null;
    let testimonyBlocked = false;

    if (testimony) {
      screen = await screenTestimony(testimony);
      if (screen.verdict === "block") testimonyBlocked = true; // rating posts, words do not
    }

    const result = await submitRating(info.user, {
      throneId: parsed.data.throneId,
      verdict: parsed.data.verdict as 1 | 2 | 3 | 4 | 5,
      tags: parsed.data.tags,
      verified: parsed.data.verified,
      ...(testimony !== undefined && !testimonyBlocked ? { testimony } : {}),
    }, now);

    if (screen && screen.verdict !== "allow") {
      await queueTestimonyRow(result.ratingId, info.user.id, screen, testimonyBlocked, now);
    }

    if (!result.updated) {
      const row = await evaluateSignals({
        kind: "rating", subjectId: result.ratingId, user: info.user,
        rating: { id: result.ratingId, verified: parsed.data.verified, createdAt: now, throne: result.throne },
      }, now);
      if (row) scheduleTriage(row.id);
    }

    return NextResponse.json({ ...result, testimonyBlocked }, { status: result.updated ? 200 : 201 });
  } catch (e) {
    if (e instanceof AgeGateError) return NextResponse.json({ error: e.code }, { status: e.status });
    if (e instanceof StandingError) return NextResponse.json({ error: e.code, until: e.until ?? null }, { status: e.status });
    if (e instanceof RateLimitError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof RatingError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
```

`src/lib/server/triage.ts` — replace `buildPrompt`'s subject if/else with kind-aware resolution:

```ts
let subject = "";
const asRating = (row.kind === "rating" || row.kind === "testimony" || row.kind === "report")
  ? await db.query.ratings.findFirst({ where: eq(ratings.id, row.subjectId) })
  : undefined;
if (asRating) {
  const throne = await db.query.thrones.findFirst({ where: eq(thrones.id, asRating.throneId) });
  subject = `A ${asRating.verified ? "verified" : "hearsay"} rating (verdict ${asRating.verdict}/5, tags: ${asRating.tags.join(", ") || "none"}${asRating.testimony ? `, testimony: "${asRating.testimony}"` : ""}) at throne "${throne?.name}" (category ${throne?.category}, at ${throne?.lat}, ${throne?.lng}).`;
} else if (row.kind === "rating" || row.kind === "testimony") {
  subject = "Rating (missing).";
} else {
  const throne = await db.query.thrones.findFirst({ where: eq(thrones.id, row.subjectId) });
  const label = row.kind === "new_throne" ? "A newly charted throne"
    : row.kind === "report" ? "A reported throne"
    : "A confirmation of throne";
  subject = `${label}: "${throne?.name}" (category ${throne?.category}, at ${throne?.lat}, ${throne?.lng}, status ${throne?.status}).`;
}
```

- [ ] **Step 4 (Claude): Verify** — `npx vitest run src/test/testimony.test.ts` then `npm test`.
- [ ] **Step 5 (Claude): Commit**

```bash
git add src/app/api/ratings/route.ts src/lib/server/ratings.ts src/lib/server/triage.ts src/test/testimony.test.ts
git commit -m "feat: scroll of testimony — hybrid screen wired into rating submission"
```

---

### Task 7: Reports — lib + endpoint

**Files:**
- Create: `src/lib/server/reports.ts`, `src/app/api/report/route.ts`
- Test: `src/test/reports.test.ts`

- [ ] **Step 1: Failing tests** — `src/test/reports.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { reviewQueue } from "@/db/schema";
import { submitBirthDate } from "@/lib/server/ageGate";
import { ReportError, submitReport } from "@/lib/server/reports";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
import { auth } from "@/auth";
import { POST as reportPOST } from "@/app/api/report/route";

describe("submitReport", () => {
  beforeEach(resetDb);

  it("first report creates a queue row owned by the content author", async () => {
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    const reporter = await makeUser({ houseId: "bidet" });
    const { reviewId } = await submitReport(reporter, { subjectKind: "throne", subjectId: throne.id, reason: "closed" });
    const [q] = await db.select().from(reviewQueue);
    expect(q.id).toBe(reviewId);
    expect(q.kind).toBe("report");
    expect(q.severity).toBe("low"); // closed → low
    expect(q.userId).toBe(adder.id); // the AUTHOR, not the reporter
    expect(q.signals).toEqual([{ signal: "user_report", reason: "closed", reporterCount: 1 }]);
  });

  it("duplicate report from the same user 409s", async () => {
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    const reporter = await makeUser();
    await submitReport(reporter, { subjectKind: "throne", subjectId: throne.id, reason: "spam" });
    await expect(
      submitReport(reporter, { subjectKind: "throne", subjectId: throne.id, reason: "closed" })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("second reporter merges into the pending row and escalates severity", async () => {
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    const r1 = await makeUser();
    const r2 = await makeUser();
    await submitReport(r1, { subjectKind: "throne", subjectId: throne.id, reason: "wrong_info" });
    await submitReport(r2, { subjectKind: "throne", subjectId: throne.id, reason: "inappropriate" });
    const rows = await db.select().from(reviewQueue);
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe("medium"); // low escalated one step at 2 reporters
    expect(rows[0].signals).toHaveLength(2);
  });

  it("reporting a hidden or missing subject 404s", async () => {
    const reporter = await makeUser();
    await expect(
      submitReport(reporter, { subjectKind: "throne", subjectId: "00000000-0000-0000-0000-000000000009", reason: "spam" })
    ).rejects.toBeInstanceOf(ReportError);
  });

  it("daily cap 429s at 20", async () => {
    const adder = await makeUser();
    const reporter = await makeUser();
    for (let i = 0; i < 20; i++) {
      const t = await makeThrone(adder.id, { name: `T${i}` });
      await submitReport(reporter, { subjectKind: "throne", subjectId: t.id, reason: "closed" });
    }
    const extra = await makeThrone(adder.id, { name: "one-too-many" });
    await expect(
      submitReport(reporter, { subjectKind: "throne", subjectId: extra.id, reason: "closed" })
    ).rejects.toMatchObject({ status: 429 });
  });
});

describe("POST /api/report gates", () => {
  beforeEach(resetDb);

  it("401 anonymous; 403 unattested; 201 attested", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    const body = { subjectKind: "throne", subjectId: throne.id, reason: "closed" };
    const mk = () => new Request("http://test/api/report", { method: "POST", body: JSON.stringify(body) });
    expect((await reportPOST(mk())).status).toBe(401);

    const user = await makeUser();
    vi.mocked(auth).mockResolvedValue({ googleSubject: user.googleSubject } as never);
    expect((await reportPOST(mk())).status).toBe(403);

    await submitBirthDate(user.googleSubject, "1990-01-01");
    expect((await reportPOST(mk())).status).toBe(201);
  });
});
```

- [ ] **Step 2 (Claude): Verify fail.**

- [ ] **Step 3: Implement.**

`src/lib/server/reports.ts`:

```ts
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { ratings, reports, reviewQueue, thrones, users, type ReviewSignal } from "@/db/schema";
import { scheduleTriage } from "./triage";

type UserRow = typeof users.$inferSelect;
type ReportReason = (typeof reports.$inferSelect)["reason"];
type Severity = "low" | "medium" | "high";

const DAY_MS = 86_400_000;
const REPORT_DAILY_CAP = 20;

const SEVERITY_BY_REASON: Record<ReportReason, Severity> = {
  wrong_info: "low", closed: "low",
  inappropriate: "medium", not_public_restroom: "medium", harassment: "medium", spam: "medium",
};

const ESCALATE: Record<Severity, Severity> = { low: "medium", medium: "high", high: "high" };

export class ReportError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export interface SubmitReportInput {
  subjectKind: "throne" | "rating";
  subjectId: string;
  reason: ReportReason;
  note?: string;
}

export async function submitReport(reporter: UserRow, input: SubmitReportInput, now = Date.now()) {
  // Subject must exist and be visible; the queue row belongs to the content author.
  let authorId: string;
  if (input.subjectKind === "throne") {
    const t = await db.query.thrones.findFirst({ where: eq(thrones.id, input.subjectId) });
    if (!t || t.hiddenAt) throw new ReportError("no such throne", 404);
    authorId = t.addedBy;
  } else {
    const r = await db.query.ratings.findFirst({ where: eq(ratings.id, input.subjectId) });
    if (!r || r.hiddenAt) throw new ReportError("no such rating", 404);
    authorId = r.userId;
  }

  const [{ n: todays }] = await db.select({ n: sql<number>`count(*)::int` }).from(reports)
    .where(and(eq(reports.reporterId, reporter.id), gte(reports.createdAt, new Date(now - DAY_MS))));
  if (todays >= REPORT_DAILY_CAP) {
    throw new ReportError("The Maesters can hear no more from you today.", 429);
  }

  let report;
  try {
    [report] = await db.insert(reports).values({
      reporterId: reporter.id, subjectKind: input.subjectKind, subjectId: input.subjectId,
      reason: input.reason, note: input.note?.trim() || null, createdAt: new Date(now),
    }).returning();
  } catch (e) {
    const text = `${(e as { cause?: unknown })?.cause ?? ""}${e instanceof Error ? e.message : ""}`;
    if (text.includes("reports_reporter_subject_idx")) {
      throw new ReportError("You have already raised this banner.", 409);
    }
    throw e;
  }

  const [{ n: reporterCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(reports)
    .where(and(eq(reports.subjectKind, input.subjectKind), eq(reports.subjectId, input.subjectId)));
  const signal: ReviewSignal = { signal: "user_report", reason: input.reason, reporterCount };

  const existing = await db.query.reviewQueue.findFirst({
    where: and(
      eq(reviewQueue.kind, "report"),
      eq(reviewQueue.subjectId, input.subjectId),
      eq(reviewQueue.status, "pending")
    ),
  });

  if (existing) {
    await db.update(reviewQueue).set({
      signals: [...existing.signals, signal],
      severity: reporterCount >= 2 ? ESCALATE[existing.severity] : existing.severity,
    }).where(eq(reviewQueue.id, existing.id));
    return { reportId: report.id, reviewId: existing.id };
  }

  const [row] = await db.insert(reviewQueue).values({
    kind: "report", subjectId: input.subjectId, userId: authorId,
    signals: [signal], severity: SEVERITY_BY_REASON[input.reason], createdAt: new Date(now),
  }).returning();
  scheduleTriage(row.id);
  return { reportId: report.id, reviewId: row.id };
}
```

`src/app/api/report/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { AgeGateError, requireAgeGate } from "@/lib/server/ageGate";
import { ReportError, submitReport } from "@/lib/server/reports";
import { sessionInfo } from "@/lib/server/session";
import { requireGoodStanding, StandingError } from "@/lib/server/standing";

const bodySchema = z.object({
  subjectKind: z.enum(["throne", "rating"]),
  subjectId: z.string().uuid(),
  reason: z.enum(["wrong_info", "closed", "inappropriate", "not_public_restroom", "harassment", "spam"]),
  note: z.string().trim().max(280).optional(),
});

export async function POST(req: Request) {
  const info = await sessionInfo();
  if (info.kind !== "user") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  try {
    await requireAgeGate(info.user.googleSubject);
    requireGoodStanding(info.user);
    const result = await submitReport(info.user, parsed.data);
    return NextResponse.json({ ok: true, reportId: result.reportId }, { status: 201 });
  } catch (e) {
    if (e instanceof AgeGateError) return NextResponse.json({ error: e.code }, { status: e.status });
    if (e instanceof StandingError) return NextResponse.json({ error: e.code, until: e.until ?? null }, { status: e.status });
    if (e instanceof ReportError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 4 (Claude): Verify + commit**

```bash
git add src/lib/server/reports.ts src/app/api/report src/test/reports.test.ts
git commit -m "feat: user report flow — dedupe, daily cap, queue merge + escalation"
```

---

### Task 8: Moderate API + standing gates on remaining write routes

**Files:**
- Create: `src/app/api/moderate/route.ts`
- Modify: `src/app/api/thrones/route.ts`, `src/app/api/thrones/[id]/confirm/route.ts`, `src/app/api/profile/route.ts`, `src/lib/server/review.ts`
- Test: `src/test/moderate.test.ts`

- [ ] **Step 1: Failing tests** — `src/test/moderate.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { ratings, reviewQueue, thrones, users } from "@/db/schema";
import { submitBirthDate } from "@/lib/server/ageGate";
import { submitRating } from "@/lib/server/ratings";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
import { auth } from "@/auth";
import { POST as moderatePOST } from "@/app/api/moderate/route";
import { POST as thronesPOST } from "@/app/api/thrones/route";

function post(body: unknown) {
  return new Request("http://test/api/moderate", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/moderate", () => {
  beforeEach(resetDb);

  it("404s for non-moderators", async () => {
    const pleb = await makeUser();
    vi.mocked(auth).mockResolvedValue({ googleSubject: pleb.googleSubject } as never);
    const res = await moderatePOST(post({ action: "ban_user", subjectId: pleb.id }));
    expect(res.status).toBe(404);
  });

  it("hide_throne + reviewId auto-resolves the queue row with a prefixed note", async () => {
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    const [q] = await db.insert(reviewQueue).values({
      kind: "new_throne", subjectId: throne.id, userId: adder.id,
      signals: [{ signal: "new_throne" }], severity: "low",
    }).returning();
    const mod = await makeUser({ role: "moderator" });
    vi.mocked(auth).mockResolvedValue({ googleSubject: mod.googleSubject } as never);

    const res = await moderatePOST(post({ action: "hide_throne", subjectId: throne.id, reviewId: q.id, note: "private garage" }));
    expect(res.status).toBe(200);
    const [t] = await db.select().from(thrones).where(eq(thrones.id, throne.id));
    expect(t.hiddenAt).not.toBeNull();
    const [resolved] = await db.select().from(reviewQueue).where(eq(reviewQueue.id, q.id));
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolutionNote).toBe("[hide_throne] private garage");
  });

  it("suspend_user defaults to 7 days; ban_user and reinstate_user round-trip", async () => {
    const target = await makeUser();
    const mod = await makeUser({ role: "moderator" });
    vi.mocked(auth).mockResolvedValue({ googleSubject: mod.googleSubject } as never);

    await moderatePOST(post({ action: "suspend_user", subjectId: target.id }));
    let [u] = await db.select().from(users).where(eq(users.id, target.id));
    expect(u.suspendedUntil).not.toBeNull();

    await moderatePOST(post({ action: "ban_user", subjectId: target.id }));
    [u] = await db.select().from(users).where(eq(users.id, target.id));
    expect(u.bannedAt).not.toBeNull();

    await moderatePOST(post({ action: "reinstate_user", subjectId: target.id }));
    [u] = await db.select().from(users).where(eq(users.id, target.id));
    expect(u.bannedAt).toBeNull();
    expect(u.suspendedUntil).toBeNull();
  });

  it("hide_testimony via API", async () => {
    const rater = await makeUser();
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    const r = await submitRating(rater, { throneId: throne.id, verdict: 3, tags: [], verified: true, testimony: "meh" });
    const mod = await makeUser({ role: "moderator" });
    vi.mocked(auth).mockResolvedValue({ googleSubject: mod.googleSubject } as never);
    const res = await moderatePOST(post({ action: "hide_testimony", subjectId: r.ratingId }));
    expect(res.status).toBe(200);
    const [row] = await db.select().from(ratings).where(eq(ratings.id, r.ratingId));
    expect(row.testimonyHiddenAt).not.toBeNull();
  });
});

describe("standing gates on write routes", () => {
  beforeEach(resetDb);

  it("banned user gets 403 banished from add-throne", async () => {
    const user = await makeUser({ bannedAt: new Date() });
    await submitBirthDate(user.googleSubject, "1990-01-01");
    vi.mocked(auth).mockResolvedValue({ googleSubject: user.googleSubject } as never);
    const res = await thronesPOST(new Request("http://test/api/thrones", {
      method: "POST",
      body: JSON.stringify({
        name: "Banned's Privy", lat: 40.7, lng: -73.9, category: "cafe",
        amenities: { accessible: false, babyChanging: false, genderNeutral: false, freeAccess: true, open24h: false },
        publicAccessAttested: true,
      }),
    }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("banished");
  });
});
```

- [ ] **Step 2 (Claude): Verify fail.**

- [ ] **Step 3: Implement.**

`src/app/api/moderate/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { EnforcementError, hideRating, hideTestimony, hideThrone } from "@/lib/server/enforcement";
import { moderatorOrNull, resolveReview } from "@/lib/server/review";
import { banUser, reinstateUser, suspendUser } from "@/lib/server/standing";

const bodySchema = z.object({
  action: z.enum(["hide_throne", "hide_rating", "hide_testimony", "suspend_user", "ban_user", "reinstate_user"]),
  subjectId: z.string().uuid(), // throne id, rating id, or user id per action
  days: z.number().int().min(1).max(365).optional(),
  note: z.string().trim().max(500).optional(),
  reviewId: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  const mod = await moderatorOrNull();
  if (!mod) return NextResponse.json({ error: "not found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const { action, subjectId, days, note, reviewId } = parsed.data;

  try {
    switch (action) {
      case "hide_throne": await hideThrone(subjectId, mod); break;
      case "hide_rating": await hideRating(subjectId, mod); break;
      case "hide_testimony": await hideTestimony(subjectId, mod); break;
      case "suspend_user": await suspendUser(subjectId, days ?? 7); break;
      case "ban_user": await banUser(subjectId); break;
      case "reinstate_user": await reinstateUser(subjectId); break;
    }
    if (reviewId) {
      await resolveReview(reviewId, mod.id, `[${action}] ${note ?? ""}`.trim());
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof EnforcementError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
```

Standing gates — in `src/app/api/thrones/route.ts` and `src/app/api/thrones/[id]/confirm/route.ts`, after `requireAgeGate(...)`:

```ts
requireGoodStanding(info.user);
```

In `src/app/api/profile/route.ts` (existing-user branch only — new users can't be banned):

```ts
if (info.kind === "user") requireGoodStanding(info.user);
```

Each of the three catch chains gains (before the module-specific error):

```ts
if (e instanceof StandingError) return NextResponse.json({ error: e.code, until: e.until ?? null }, { status: e.status });
```

with the import `import { requireGoodStanding, StandingError } from "@/lib/server/standing";`.

`src/lib/server/review.ts` — `ReviewItemDTO` gains:

```ts
subjectKind: "throne" | "rating";
subjectId: string;
actorUserId: string;
```

and the mapping inside `listReview` gains (import `ratings` is already there):

```ts
subjectKind: (row.kind === "rating" || row.kind === "testimony"
  ? "rating"
  : row.kind === "report"
    ? ((await db.query.ratings.findFirst({ where: eq(ratings.id, row.subjectId) })) ? "rating" : "throne")
    : "throne") as "throne" | "rating",
subjectId: row.subjectId,
actorUserId: row.userId,
```

- [ ] **Step 4 (Claude): Verify** — `npx vitest run src/test/moderate.test.ts` then `npm test`.
- [ ] **Step 5 (Claude): Commit**

```bash
git add src/app/api/moderate src/app/api/thrones src/app/api/profile/route.ts src/lib/server/review.ts src/test/moderate.test.ts
git commit -m "feat: moderate API — takedowns, suspend/ban, auto-resolve; standing gates everywhere"
```

---

### Task 9: Client — testimony textarea + report modal

**Files:**
- Modify: `src/components/SittingFlow.tsx`, `src/lib/api.ts`, `src/lib/store.tsx`, `src/components/ThroneSheet.tsx`
- Create: `src/components/ReportModal.tsx`

No unit tests (client) — browser-verified at the gate. `npx.cmd tsc --noEmit` must stay clean. **Codex: read `SittingFlow.tsx` and `ThroneSheet.tsx` before editing and match their existing structure — the snippets below give exact content but placement follows the component's own rhythm.**

- [ ] **Step 1: API client** — `src/lib/api.ts`:

```ts
submitRating: (input: { throneId: string; verdict: number; tags: string[]; verified: boolean; testimony?: string }) =>
  request<{ updated: boolean; influence: number; flipped: boolean; testimonyBlocked?: boolean }>("/api/ratings", {
    method: "POST", body: JSON.stringify(input),
  }),
report: (input: { subjectKind: "throne" | "rating"; subjectId: string; reason: string; note?: string }) =>
  request<{ ok: true }>("/api/report", { method: "POST", body: JSON.stringify(input) }),
```

`src/lib/store.tsx` — pass testimony through and surface the block flag. Context type:

```ts
submitRating: (input: { throneId: string; verdict: 1 | 2 | 3 | 4 | 5; tags: string[]; testimony: string; verified: boolean }) => Promise<{ testimonyBlocked: boolean }>;
```

Implementation (replaces the current stripping one-liner):

```ts
submitRating: async (input) => {
  let blocked = false;
  await mutate(async () => {
    const res = await api.submitRating({
      throneId: input.throneId, verdict: input.verdict, tags: input.tags, verified: input.verified,
      testimony: input.testimony.trim() || undefined,
    });
    blocked = !!res.testimonyBlocked;
    return res;
  });
  return { testimonyBlocked: blocked };
},
```

(If `mutate`'s current signature returns void and discards the callback result, adapt minimally — the requirement is: testimony reaches the API, and the caller learns `testimonyBlocked`.)

- [ ] **Step 2: SittingFlow textarea.** Add state `const [testimony, setTestimony] = useState("");` and `const [blockedNote, setBlockedNote] = useState(false);`. Replace the hardcoded `testimony: ""` in the submit call with `testimony`, capture the result, and `if (result.testimonyBlocked) setBlockedNote(true);`. Insert before the submit control:

```tsx
<label className="mt-4 block font-mono text-[13px] uppercase tracking-wide text-ink-faint">
  Scroll of Testimony (optional)
</label>
<textarea
  value={testimony}
  onChange={(e) => setTestimony(e.target.value)}
  maxLength={280}
  rows={3}
  placeholder="Speak, traveler. What horrors or wonders did you find?"
  className="pixel-panel-flat mt-1.5 w-full resize-none px-3 py-2.5 font-mono text-[14px] text-ink outline-none placeholder:text-ink-faint"
/>
<p className="mt-1 text-right font-mono text-[11px] text-ink-faint">{testimony.length}/280</p>
```

And wherever the flow confirms success:

```tsx
{blockedNote && (
  <p className="mt-2 font-mono text-[13px] text-crimson">
    The Maester declines to record those words. Your verdict stands.
  </p>
)}
```

- [ ] **Step 3: ReportModal** — `src/components/ReportModal.tsx`:

```tsx
"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";

const REASONS = [
  { value: "wrong_info", label: "The details are wrong" },
  { value: "closed", label: "This throne is closed or gone" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "not_public_restroom", label: "Not a public restroom" },
  { value: "harassment", label: "Harassment" },
  { value: "spam", label: "Spam" },
] as const;

export function ReportModal({ subjectKind, subjectId, subjectLabel, onClose }: {
  subjectKind: "throne" | "rating";
  subjectId: string;
  subjectLabel: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!reason) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.report({ subjectKind, subjectId, reason, note: note.trim() || undefined });
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "the ravens were lost");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1003] flex items-end justify-center bg-black/60 sm:items-center sm:p-6">
      <div className="pixel-panel w-full max-w-md p-5">
        {sent ? (
          <>
            <p className="font-mono text-[15px] uppercase tracking-widest text-brass">▸ Raven Sent</p>
            <p className="mt-2 text-[15px] text-ink-soft">The Maesters will review {subjectLabel}.</p>
            <button type="button" onClick={onClose} className="pixel-btn mt-4 w-full py-2.5 font-display text-[10px]">Close</button>
          </>
        ) : (
          <>
            <p className="font-mono text-[15px] uppercase tracking-widest text-brass">▸ Report to the Maesters</p>
            <p className="mt-1 font-mono text-[13px] text-ink-faint">{subjectLabel}</p>
            <div className="mt-3 flex flex-col gap-2">
              {REASONS.map((r) => (
                <button key={r.value} type="button" onClick={() => setReason(r.value)}
                  className="pixel-chip px-3 py-2 text-left font-mono text-[13px]"
                  style={{
                    background: reason === r.value ? "var(--brass)" : "var(--vellum)",
                    color: reason === r.value ? "var(--on-brass)" : "var(--ink-soft)",
                  }}>
                  {r.label}
                </button>
              ))}
            </div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} rows={2}
              placeholder="Anything the Maesters should know? (optional)"
              className="pixel-panel-flat mt-3 w-full resize-none px-3 py-2 font-mono text-[13px] text-ink outline-none placeholder:text-ink-faint" />
            {error && <p className="mt-2 font-mono text-[13px] text-crimson">{error}</p>}
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={onClose} className="pixel-chip flex-1 bg-vellum py-2.5 font-mono text-[13px] uppercase text-ink-soft">Cancel</button>
              <button type="button" disabled={!reason || submitting} onClick={handleSubmit}
                className="pixel-btn flex-1 py-2.5 font-display text-[10px]">Send Raven</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: ThroneSheet report affordances.** Import `ReportModal`; add state `const [reporting, setReporting] = useState<{ kind: "throne" | "rating"; id: string; label: string } | null>(null);`. For ready users only (the sheet already knows auth state via `useStore()` — add it if absent): a small header affordance —

```tsx
<button type="button" onClick={() => setReporting({ kind: "throne", id: throne.id, label: throne.name })}
  className="font-mono text-[11px] uppercase tracking-wide text-ink-faint underline">
  Report
</button>
```

per recent-rating row:

```tsx
<button type="button" onClick={() => setReporting({ kind: "rating", id: r.id, label: `a rating at ${throne.name}` })}
  className="ml-2 font-mono text-[10px] uppercase text-ink-faint underline">
  Report
</button>
```

and at the end of the sheet:

```tsx
{reporting && (
  <ReportModal subjectKind={reporting.kind} subjectId={reporting.id} subjectLabel={reporting.label} onClose={() => setReporting(null)} />
)}
```

- [ ] **Step 5 (Codex): Typecheck** — `npx.cmd tsc --noEmit` clean.
- [ ] **Step 6 (Claude): Commit**

```bash
git add src/components/SittingFlow.tsx src/components/ReportModal.tsx src/components/ThroneSheet.tsx src/lib/api.ts src/lib/store.tsx
git commit -m "feat: testimony textarea + report buttons/modal on the throne sheet"
```

---

### Task 10: Moderation UI — actions + inline notes

**Files:**
- Modify: `src/components/ModerationQueue.tsx`

- [ ] **Step 1: Extend the item type and actions.** `ReviewItem` gains `subjectKind: "throne" | "rating"`, `subjectId: string`, `actorUserId: string` (now served by `/api/review`). Add state and handlers:

```tsx
const [notes, setNotes] = useState<Record<string, string>>({});

async function moderate(item: ReviewItem, action: string, days?: number) {
  const subjectId = action === "suspend_user" || action === "ban_user" ? item.actorUserId : item.subjectId;
  await act(item.id, "/api/moderate", { action, subjectId, days, note: notes[item.id] || undefined, reviewId: item.id });
}

async function resolveOnly(item: ReviewItem) {
  await act(item.id, `/api/review/${item.id}`, { action: "resolve", note: notes[item.id] || undefined });
}
```

Replace the pending-actions block (the old Resolve-with-window.prompt goes away):

```tsx
{item.status === "pending" ? (
  <div className="mt-3">
    <input
      value={notes[item.id] ?? ""}
      onChange={(e) => setNotes((n) => ({ ...n, [item.id]: e.target.value }))}
      maxLength={500}
      placeholder="Resolution note (optional)"
      className="pixel-panel-flat w-full px-3 py-2 font-mono text-[13px] text-ink outline-none placeholder:text-ink-faint"
    />
    <div className="mt-2 flex flex-wrap gap-2">
      {item.subjectKind === "throne" && (
        <button type="button" disabled={busy === item.id} onClick={() => void moderate(item, "hide_throne")}
          className="pixel-chip bg-vellum px-3 py-2 font-mono text-[12px] uppercase text-crimson">
          Hide throne
        </button>
      )}
      {item.subjectKind === "rating" && (
        <>
          <button type="button" disabled={busy === item.id} onClick={() => void moderate(item, "hide_rating")}
            className="pixel-chip bg-vellum px-3 py-2 font-mono text-[12px] uppercase text-crimson">
            Hide rating
          </button>
          <button type="button" disabled={busy === item.id} onClick={() => void moderate(item, "hide_testimony")}
            className="pixel-chip bg-vellum px-3 py-2 font-mono text-[12px] uppercase text-crimson">
            Strike testimony
          </button>
        </>
      )}
      <button type="button" disabled={busy === item.id} onClick={() => void moderate(item, "suspend_user", 7)}
        className="pixel-chip bg-vellum px-3 py-2 font-mono text-[12px] uppercase text-ink-soft">
        Suspend 7d
      </button>
      <button type="button" disabled={busy === item.id} onClick={() => void moderate(item, "suspend_user", 30)}
        className="pixel-chip bg-vellum px-3 py-2 font-mono text-[12px] uppercase text-ink-soft">
        Suspend 30d
      </button>
      <button type="button" disabled={busy === item.id} onClick={() => void moderate(item, "ban_user")}
        className="pixel-chip bg-vellum px-3 py-2 font-mono text-[12px] uppercase text-crimson">
        Ban
      </button>
      <button type="button" disabled={busy === item.id} onClick={() => void resolveOnly(item)}
        className="pixel-btn px-4 py-2 font-display text-[9px] tracking-wide">
        Resolve
      </button>
      {!item.aiAssessment && (
        <button type="button" disabled={busy === item.id} onClick={() => void act(item.id, `/api/review/${item.id}/triage`)}
          className="pixel-chip bg-vellum px-3 py-2 font-mono text-[12px] uppercase text-ink-soft">
          Ask the Maester again
        </button>
      )}
    </div>
  </div>
) : (
  item.resolutionNote && (
    <p className="mt-2 font-mono text-[13px] italic text-ink-faint">Resolved: {item.resolutionNote}</p>
  )
)}
```

Also make the `act` helper accept a body on any path (it already does) and extend the signals display line so report reasons show:

```tsx
signals: {item.signals.map((s) => ("reason" in s && s.reason ? `${s.signal}(${s.reason})` : s.signal)).join(", ")}
```

(with `ReviewItem["signals"]` typed as `{ signal: string; reason?: string; [k: string]: unknown }[]`).

- [ ] **Step 2 (Codex): Typecheck** — clean.
- [ ] **Step 3 (Claude): Commit**

```bash
git add src/components/ModerationQueue.tsx
git commit -m "feat: moderation actions — takedowns, suspend/ban, inline notes"
```

---

### Task 11: Docs + full verify gate + deploy

- [ ] **Step 1: Docs.** ROADMAP Phase 1: check the report-flow box (note: 24h-SLA notification tooling awaits Phase 3 infra) and the text-moderation box; check the self-serve-confirmation box with the note "shipped in Phase 0 — `confirmThrone` rejects the adder, test-covered". README: extend the Trust & safety bullet with reports, takedowns/reversals, suspend/ban, testimony screening.
- [ ] **Step 2 (Claude): Full gates.** `npm test` (everything), `npm run build`. Browser pass: submit a rating with testimony → visible on ThroneSheet; report the test throne → row on `/moderation` with reason; strike testimony → text disappears from sheet; suspend the test account → write 403s themed; reinstate. Commit docs, push (`git push origin feat/phase0-backend` — deploy pre-authorized), verify prod health.

```bash
git add README.md docs/ROADMAP.md
git commit -m "docs: cycle A — reports, takedowns, enforcement, testimony shipped"
```

---

## Self-review notes

- **Spec coverage:** schema (T1), standing (T2), enforcement + reversal math (T3), realm filtering + XP clamp + hidden-404s (T4), screen module (T5), testimony wiring incl. update path + triage prompt kinds (T6), reports + endpoint (T7), moderate API + standing sweep + DTO (T8), client testimony/report (T9), moderation UI (T10), docs/verify/deploy (T11).
- **Type consistency:** `ScreenResult`/`ScreenClient` defined T5, consumed T6; `StandingError.code` strings match route mappings and tests; `ReviewItemDTO` additions (T8) match ModerationQueue usage (T10); `submitRating` returns `ratingId` on BOTH paths (T3 adds the update-path one).
- **Ordering quirk:** T3 deliberately pulls the `testimony` input field forward from T6 so its tests compile — called out in T3's header.
