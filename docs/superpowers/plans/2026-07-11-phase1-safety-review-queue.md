# Phase 1 Sub-project 1: Safety Hardening + AI-Triaged Review Queue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** COPPA age gate, private-residence attestation, non-punitive anti-gaming signals feeding a `review_queue` table, Claude-API triage annotations, and a minimal `/moderation` page — per the approved spec at `docs/superpowers/specs/2026-07-11-phase1-safety-review-queue-design.md`.

**Architecture:** One shared signals module called synchronously by the three write routes after their transaction commits; flagged actions insert a `review_queue` row; the LLM triage call runs in the background via Next's `after()` and writes its assessment back onto the row. Age attestation lives in its own `age_attestations` table keyed by `google_subject` (the gate runs before a `users` row exists). Moderator access is a `role` column checked server-side.

**Tech Stack:** Next.js 16 App Router (route handlers), Drizzle ORM + Postgres (Neon), zod v4, Vitest (tests hit the real dev DB via `DATABASE_URL`, wiped by `resetDb()`), `@anthropic-ai/sdk` (new dependency), Tailwind v4 client components.

**Division of labor (project working model):** Codex writes code and runs `npx tsc --noEmit` ONLY. Claude runs `npm install`, `npm test`, `npm run build`, `npm run db:generate` / `db:migrate`, browser verification, and every `git commit`. Codex must NOT attempt install/test/migrate/commit — its sandbox has no network and cannot take the git lock.

**File map:**

| File | Role |
|---|---|
| `src/db/schema.ts` (modify) | new enums, `users.role`, `thrones.publicAccessAttested`, `age_attestations`, `review_queue` |
| `drizzle/0002_phase1-safety.sql` (generated + hand-edited) | migration incl. `public_access_attested` backfill |
| `src/lib/game/rules.ts` (modify) | `SAFETY` thresholds + `rampedPoints()` |
| `src/lib/server/signals.ts` (create) | hard ceiling + soft signals + queue-row insertion |
| `src/lib/server/triage.ts` (create) | Claude API triage: client, prompt, `runTriage`, `scheduleTriage` |
| `src/lib/server/ageGate.ts` (create) | attestation status/submit/require helpers |
| `src/lib/server/review.ts` (create) | moderator queue list/resolve |
| `src/lib/server/ratings.ts`, `src/lib/server/thrones.ts` (modify) | influence ramp; attestation column; richer returns |
| `src/app/api/age-gate/route.ts` (create) | birthdate endpoint |
| `src/app/api/review/route.ts`, `src/app/api/review/[id]/route.ts`, `src/app/api/review/[id]/triage/route.ts` (create) | moderator API |
| `src/app/api/ratings/route.ts`, `src/app/api/thrones/route.ts`, `src/app/api/thrones/[id]/confirm/route.ts`, `src/app/api/profile/route.ts`, `src/app/api/me/route.ts` (modify) | age gate + ceiling + signals wiring |
| `src/app/moderation/page.tsx`, `src/components/ModerationQueue.tsx` (create) | moderator UI |
| `src/components/AgeGate.tsx` (create), `src/app/page.tsx`, `src/lib/store.tsx`, `src/lib/api.ts`, `src/components/AddThroneFlow.tsx` (modify) | client: gate screen + attestation checkbox |
| `src/test/{schema,rules,ramp,signals,triage,age-gate,routes-hardening,review}.test.ts` | tests (new + extended) |

---

### Task 1: Schema + migration

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/test/db.ts`
- Modify: `src/db/seed.ts` (one field)
- Test: `src/test/schema.test.ts`
- Create (generated): `drizzle/0002_phase1-safety.sql`

- [ ] **Step 1: Write the failing tests** — append to `src/test/schema.test.ts`:

```ts
import { ageAttestations, reviewQueue } from "@/db/schema";

describe("phase 1 schema", () => {
  beforeEach(resetDb);

  it("users default to role 'user'", async () => {
    const [user] = await db.insert(users).values({
      googleSubject: "sub-r", displayName: "RoleUser", houseId: "flush",
    }).returning();
    expect(user.role).toBe("user");
  });

  it("review_queue stores signals jsonb and defaults to pending", async () => {
    const [user] = await db.insert(users).values({
      googleSubject: "sub-q", displayName: "QueueUser", houseId: "flush",
    }).returning();
    const [row] = await db.insert(reviewQueue).values({
      kind: "rating",
      subjectId: "00000000-0000-0000-0000-000000000001",
      userId: user.id,
      signals: [{ signal: "impossible_travel", kmh: 840, fromThroneId: "x", minutes: 12 }],
      severity: "high",
    }).returning();
    expect(row.status).toBe("pending");
    expect(row.aiAssessment).toBeNull();
    expect(row.signals[0]).toMatchObject({ signal: "impossible_travel", kmh: 840 });
  });

  it("age_attestations keys by google_subject and stores no birthdate", async () => {
    const [att] = await db.insert(ageAttestations).values({
      googleSubject: "sub-a", over13ConfirmedAt: new Date(),
    }).returning();
    expect(att.lockedAt).toBeNull();
    expect(Object.keys(att).sort()).toEqual(["googleSubject", "lockedAt", "over13ConfirmedAt"]);
  });
});
```

Also update `src/test/db.ts` so wipes cover the new tables:

```ts
await db.execute(
  sql`TRUNCATE TABLE review_queue, age_attestations, ratings, influence_events, ledger_entries, thrones, users CASCADE`
);
```

- [ ] **Step 2 (Claude): Run tests to verify they fail**

Run: `npx vitest run src/test/schema.test.ts`
Expected: FAIL — `reviewQueue`/`ageAttestations` not exported (compile error).

- [ ] **Step 3: Implement schema changes** — in `src/db/schema.ts`:

Add enums (below the existing ones):

```ts
export const userRoleEnum = pgEnum("user_role", ["user", "moderator"]);
export const reviewKindEnum = pgEnum("review_kind", ["rating", "new_throne", "confirmation"]);
export const reviewSeverityEnum = pgEnum("review_severity", ["low", "medium", "high"]);
export const reviewStatusEnum = pgEnum("review_status", ["pending", "resolved"]);
```

Add to `users`:

```ts
role: userRoleEnum("role").notNull().default("user"),
```

Add to `thrones`:

```ts
publicAccessAttested: boolean("public_access_attested").notNull().default(false),
```

Add tables + signal type at the bottom:

```ts
export type ReviewSignal =
  | { signal: "new_account"; accountAgeDays: number }
  | { signal: "rate_soft"; writesLastHour: number }
  | { signal: "impossible_travel"; kmh: number; fromThroneId: string; minutes: number }
  | { signal: "new_throne" };

export const ageAttestations = pgTable("age_attestations", {
  googleSubject: text("google_subject").primaryKey(),
  over13ConfirmedAt: timestamp("over13_confirmed_at", { withTimezone: true }),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
});

export const reviewQueue = pgTable(
  "review_queue",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: reviewKindEnum("kind").notNull(),
    subjectId: uuid("subject_id").notNull(), // rating id or throne id — spans tables, no FK
    userId: uuid("user_id").notNull().references(() => users.id),
    signals: jsonb("signals").$type<ReviewSignal[]>().notNull(),
    severity: reviewSeverityEnum("severity").notNull(),
    aiAssessment: text("ai_assessment"),
    aiSeverity: reviewSeverityEnum("ai_severity"),
    aiTriagedAt: timestamp("ai_triaged_at", { withTimezone: true }),
    aiError: text("ai_error"),
    status: reviewStatusEnum("status").notNull().default("pending"),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("review_status_created_idx").on(t.status, t.createdAt),
    index("review_user_idx").on(t.userId),
  ]
);
```

In `src/db/seed.ts`, add `publicAccessAttested: true` to the throne insert values (seed venues are public; the migration backfill below only covers rows that exist at migration time).

- [ ] **Step 4 (Claude): Generate + edit + apply the migration**

Run: `npm run db:generate -- --name phase1-safety`
Then open the generated `drizzle/0002_phase1-safety.sql` and append (with the drizzle statement separator):

```sql
--> statement-breakpoint
UPDATE thrones SET public_access_attested = true;
```

Run: `npm run db:migrate`
Expected: applies cleanly against Neon.

- [ ] **Step 5 (Claude): Run tests to verify they pass**

Run: `npx vitest run src/test/schema.test.ts`
Expected: PASS (all, including the pre-existing append-only tests).

- [ ] **Step 6 (Claude): Commit**

```bash
git add src/db/schema.ts src/db/seed.ts src/test/db.ts src/test/schema.test.ts drizzle/
git commit -m "feat: phase-1 safety schema — role, attestations, review queue"
```

---

### Task 2: Safety rules constants + influence ramp math

**Files:**
- Modify: `src/lib/game/rules.ts`
- Test: `src/test/rules.test.ts` (create)

- [ ] **Step 1: Write the failing test** — `src/test/rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rampedPoints, SAFETY } from "@/lib/game/rules";

const DAY = 86_400_000;

describe("rampedPoints", () => {
  it("halves and rounds up for accounts under 7 days", () => {
    expect(rampedPoints(10, 3 * DAY)).toBe(5);
    expect(rampedPoints(15, 3 * DAY)).toBe(8); // ceil(7.5)
    expect(rampedPoints(3, 0)).toBe(2);        // ceil(1.5)
    expect(rampedPoints(2, 6 * DAY)).toBe(1);  // never zero
  });

  it("pays full points at exactly the window boundary and beyond", () => {
    expect(rampedPoints(10, SAFETY.newAccountWindowMs)).toBe(10);
    expect(rampedPoints(10, 30 * DAY)).toBe(10);
  });
});
```

- [ ] **Step 2 (Claude): Run test to verify it fails**

Run: `npx vitest run src/test/rules.test.ts`
Expected: FAIL — `rampedPoints`/`SAFETY` not exported.

- [ ] **Step 3: Implement** — append to `src/lib/game/rules.ts`:

```ts
/** Phase-1 anti-gaming thresholds. Heuristics are NON-PUNITIVE: when one
 * trips, the action still succeeds and a review_queue row records it.
 * Only the hard ceiling rejects. */
export const SAFETY = {
  newAccountWindowMs: 7 * 24 * 60 * 60 * 1000, // accounts younger than this earn 50% and flag
  newAccountInfluenceFactor: 0.5,
  softRateLimitPerHour: 12, // writes/hour that flag to the review queue
  hardRateLimitPerHour: 30, // writes/hour that 429 — bot scale, humans never see it
  impossibleTravelKmh: 150, // implied speed between verified ratings that flags
} as const;

/** New-account Influence ramp (PRD §5.8): <7-day accounts earn 50%, rounded
 * up so an award is never zero. The ledger stores the ramped value. */
export function rampedPoints(base: number, accountAgeMs: number): number {
  if (accountAgeMs >= SAFETY.newAccountWindowMs) return base;
  return Math.ceil(base * SAFETY.newAccountInfluenceFactor);
}
```

- [ ] **Step 4 (Claude): Run test to verify it passes**

Run: `npx vitest run src/test/rules.test.ts`
Expected: PASS.

- [ ] **Step 5 (Claude): Commit**

```bash
git add src/lib/game/rules.ts src/test/rules.test.ts
git commit -m "feat: SAFETY thresholds and new-account influence ramp math"
```

---

### Task 3: Apply the influence ramp in ratings + confirmations

The ramp applies to every earning reason. The account whose age matters is the account **earning the points** (in `confirmThrone`, the adder award ramps by the adder's age, the confirm award by the confirmer's).

**Files:**
- Modify: `src/lib/server/ratings.ts`
- Modify: `src/lib/server/thrones.ts`
- Modify: `src/test/fixtures.ts`
- Test: `src/test/ramp.test.ts` (create)

- [ ] **Step 1: Keep existing tests green** — in `src/test/fixtures.ts`, make `makeUser` default to an established account so existing award expectations (10, 15, 25…) stay valid:

```ts
export async function makeUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const n = Math.random().toString(36).slice(2, 8);
  const [user] = await db.insert(users).values({
    googleSubject: `sub-${n}`,
    displayName: `User-${n}`,
    houseId: "flush",
    joinedAt: new Date(Date.now() - 30 * 86_400_000), // established; override for ramp tests
    ...overrides,
  }).returning();
  return user;
}
```

- [ ] **Step 2: Write the failing tests** — `src/test/ramp.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { influenceEvents } from "@/db/schema";
import { submitRating } from "@/lib/server/ratings";
import { confirmThrone } from "@/lib/server/thrones";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

describe("new-account influence ramp", () => {
  beforeEach(resetDb);

  it("halves (rounded up) a new account's first verified rating: 5 + 8 not 10 + 15", async () => {
    const newbie = await makeUser({ joinedAt: new Date() });
    const throne = await makeThrone(newbie.id);
    const result = await submitRating(newbie, { throneId: throne.id, verdict: 5, tags: [], verified: true });

    expect(result.influence).toBe(13); // 5 + 8
    const events = await db.select().from(influenceEvents);
    expect(events.map((e) => e.points).sort((a, b) => a - b)).toEqual([5, 8]); // ledger stores ramped values
  });

  it("ramps confirmation awards by each earner's own account age", async () => {
    const oldAdder = await makeUser();
    const newConfirmer = await makeUser({ houseId: "bidet", joinedAt: new Date() });
    const throne = await makeThrone(oldAdder.id, { status: "rumored" });
    await confirmThrone(newConfirmer, throne.id);

    const events = await db.select().from(influenceEvents);
    const adderAward = events.find((e) => e.reason === "new_throne");
    const confirmAward = events.find((e) => e.reason === "confirmation");
    expect(adderAward?.points).toBe(25); // established adder: full
    expect(confirmAward?.points).toBe(2); // new confirmer: ceil(3 * 0.5)
  });
});
```

- [ ] **Step 3 (Claude): Run tests to verify they fail**

Run: `npx vitest run src/test/ramp.test.ts`
Expected: FAIL — influence values are unramped (25, 10+15, 3).

- [ ] **Step 4: Implement the ramp** — in `src/lib/server/ratings.ts`, import `rampedPoints` from `@/lib/game/rules` and replace the award computation:

```ts
const accountAgeMs = now - user.joinedAt.getTime();
const base = rampedPoints(
  input.verified ? INFLUENCE.verifiedRating : INFLUENCE.hearsayRating,
  accountAgeMs
);
const firstBonus = rampedPoints(INFLUENCE.firstOfNameBonus, accountAgeMs);
```

Use `base` for the rating event's `points`, `firstBonus` for the first-of-name event's `points`, and `const points = base + (isFirstRating ? firstBonus : 0);` for the response/ledger text (this line already exists — update it to use `firstBonus`).

In `src/lib/server/thrones.ts` `confirmThrone`, import `rampedPoints` and compute:

```ts
const adderAward = rampedPoints(INFLUENCE.throneConfirmedAdderAward, now - adder.joinedAt.getTime());
const confirmAward = rampedPoints(INFLUENCE.confirmAction, now - confirmer.joinedAt.getTime());
```

Use them as the two events' `points`, and use `adderAward` in the ledger text instead of `INFLUENCE.throneConfirmedAdderAward`.

- [ ] **Step 5 (Claude): Run the full suite** (fixtures changed — everything must stay green)

Run: `npm test`
Expected: PASS across the board.

- [ ] **Step 6 (Claude): Commit**

```bash
git add src/lib/server/ratings.ts src/lib/server/thrones.ts src/test/fixtures.ts src/test/ramp.test.ts
git commit -m "feat: apply 50% influence ramp to accounts under 7 days"
```

---

### Task 4: Signals module

**Files:**
- Create: `src/lib/server/signals.ts`
- Test: `src/test/signals.test.ts`

- [ ] **Step 1: Write the failing tests** — `src/test/signals.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { ratings, reviewQueue } from "@/db/schema";
import { enforceHardCeiling, evaluateSignals, RateLimitError } from "@/lib/server/signals";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

const HOUR = 3_600_000;

async function makeRating(userId: string, throneId: string, at: number, verified = true) {
  const [row] = await db.insert(ratings).values({
    throneId, userId, verdict: 3, tags: [], verified, createdAt: new Date(at),
  }).returning();
  return row;
}

describe("enforceHardCeiling", () => {
  beforeEach(resetDb);

  it("allows the 30th write and rejects the 31st", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const now = Date.now();
    for (let i = 0; i < 29; i++) await makeRating(user.id, throne.id, now - i * 60_000);
    await expect(enforceHardCeiling(user.id, now)).resolves.toBeUndefined(); // 29 exist → 30th ok
    await makeRating(user.id, throne.id, now);
    await expect(enforceHardCeiling(user.id, now)).rejects.toBeInstanceOf(RateLimitError); // 30 exist → 31st blocked
  });

  it("ignores writes older than an hour", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const now = Date.now();
    for (let i = 0; i < 40; i++) await makeRating(user.id, throne.id, now - 2 * HOUR);
    await expect(enforceHardCeiling(user.id, now)).resolves.toBeUndefined();
  });
});

describe("evaluateSignals", () => {
  beforeEach(resetDb);

  it("returns null and writes nothing for a clean established-account rating", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const now = Date.now();
    const rating = await makeRating(user.id, throne.id, now);
    const row = await evaluateSignals(
      { kind: "rating", subjectId: rating.id, user, rating: { id: rating.id, verified: true, createdAt: now, throne } },
      now
    );
    expect(row).toBeNull();
    expect(await db.select().from(reviewQueue)).toHaveLength(0);
  });

  it("flags a new account at low severity", async () => {
    const user = await makeUser({ joinedAt: new Date() });
    const throne = await makeThrone(user.id);
    const now = Date.now();
    const rating = await makeRating(user.id, throne.id, now);
    const row = await evaluateSignals(
      { kind: "rating", subjectId: rating.id, user, rating: { id: rating.id, verified: true, createdAt: now, throne } },
      now
    );
    expect(row).toMatchObject({ kind: "rating", severity: "low" });
    expect(row!.signals.map((s) => s.signal)).toEqual(["new_account"]);
  });

  it("flags impossible travel at high severity from throne coords + timestamps", async () => {
    const user = await makeUser();
    const nyc = await makeThrone(user.id); // fixture is 40.746,-73.9895
    const la = await makeThrone(user.id, { name: "LA Throne", lat: 34.05, lng: -118.24 });
    const now = Date.now();
    await makeRating(user.id, nyc.id, now - 10 * 60_000); // verified in NYC 10 min ago
    const rating = await makeRating(user.id, la.id, now);  // now verified in LA → ~24,000 km/h
    const row = await evaluateSignals(
      { kind: "rating", subjectId: rating.id, user, rating: { id: rating.id, verified: true, createdAt: now, throne: la } },
      now
    );
    expect(row!.severity).toBe("high");
    const travel = row!.signals.find((s) => s.signal === "impossible_travel");
    expect(travel).toMatchObject({ fromThroneId: nyc.id });
    expect((travel as { kmh: number }).kmh).toBeGreaterThan(150);
  });

  it("does not check travel for hearsay ratings", async () => {
    const user = await makeUser();
    const nyc = await makeThrone(user.id);
    const la = await makeThrone(user.id, { name: "LA", lat: 34.05, lng: -118.24 });
    const now = Date.now();
    await makeRating(user.id, nyc.id, now - 10 * 60_000);
    const rating = await makeRating(user.id, la.id, now, false); // hearsay
    const row = await evaluateSignals(
      { kind: "rating", subjectId: rating.id, user, rating: { id: rating.id, verified: false, createdAt: now, throne: la } },
      now
    );
    expect(row).toBeNull();
  });

  it("always queues a new throne (low), merging with rate_soft (medium wins)", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const now = Date.now();
    for (let i = 0; i < 13; i++) await makeRating(user.id, throne.id, now - i * 60_000); // >12 writes/hr
    const row = await evaluateSignals({ kind: "new_throne", subjectId: throne.id, user }, now);
    expect(row!.severity).toBe("medium");
    expect(row!.signals.map((s) => s.signal).sort()).toEqual(["new_throne", "rate_soft"]);
  });
});
```

- [ ] **Step 2 (Claude): Run tests to verify they fail**

Run: `npx vitest run src/test/signals.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement** — `src/lib/server/signals.ts`:

```ts
import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { influenceEvents, ratings, reviewQueue, thrones, users, type ReviewSignal } from "@/db/schema";
import { SAFETY } from "@/lib/game/rules";
import { haversineMeters } from "@/lib/geo";

type UserRow = typeof users.$inferSelect;
type ReviewRow = typeof reviewQueue.$inferSelect;
type Severity = "low" | "medium" | "high";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export class RateLimitError extends Error {
  status = 429;
}

/** All write kinds count toward the rate windows: ratings, charted thrones,
 * confirmations (counted via their influence events). */
async function writesInLastHour(userId: string, now: number): Promise<number> {
  const since = new Date(now - HOUR_MS);
  const count = sql<number>`count(*)::int`;
  const [[r], [t], [c]] = await Promise.all([
    db.select({ n: count }).from(ratings)
      .where(and(eq(ratings.userId, userId), gte(ratings.createdAt, since))),
    db.select({ n: count }).from(thrones)
      .where(and(eq(thrones.addedBy, userId), gte(thrones.addedAt, since))),
    db.select({ n: count }).from(influenceEvents)
      .where(and(
        eq(influenceEvents.userId, userId),
        eq(influenceEvents.reason, "confirmation"),
        gte(influenceEvents.createdAt, since)
      )),
  ]);
  return r.n + t.n + c.n;
}

/** Call BEFORE the write. The only hard rejection in the anti-gaming bundle. */
export async function enforceHardCeiling(userId: string, now = Date.now()): Promise<void> {
  if ((await writesInLastHour(userId, now)) >= SAFETY.hardRateLimitPerHour) {
    throw new RateLimitError("The ravens cannot carry so many messages — rest awhile.");
  }
}

export interface SignalContext {
  kind: "rating" | "new_throne" | "confirmation";
  subjectId: string; // rating id or throne id
  user: Pick<UserRow, "id" | "joinedAt">;
  /** Present only for newly-inserted ratings; travel is checked for verified
   * ones. Coordinates come from the throne, never the user. */
  rating?: {
    id: string;
    verified: boolean;
    createdAt: number;
    throne: { id: string; lat: number; lng: number };
  };
}

const SIGNAL_SEVERITY: Record<ReviewSignal["signal"], Severity> = {
  new_account: "low",
  new_throne: "low",
  rate_soft: "medium",
  impossible_travel: "high",
};

const RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2 };

/** Call AFTER the action's transaction commits — the action already succeeded
 * (Larry's rule: flag, never reject). Returns the inserted queue row, or null. */
export async function evaluateSignals(ctx: SignalContext, now = Date.now()): Promise<ReviewRow | null> {
  const signals: ReviewSignal[] = [];

  const accountAgeMs = now - ctx.user.joinedAt.getTime();
  if (accountAgeMs < SAFETY.newAccountWindowMs) {
    signals.push({ signal: "new_account", accountAgeDays: Math.floor(accountAgeMs / DAY_MS) });
  }

  const writes = await writesInLastHour(ctx.user.id, now);
  if (writes > SAFETY.softRateLimitPerHour) {
    signals.push({ signal: "rate_soft", writesLastHour: writes });
  }

  if (ctx.kind === "new_throne") signals.push({ signal: "new_throne" });

  if (ctx.rating?.verified) {
    const [prev] = await db.select({
      throneId: ratings.throneId, createdAt: ratings.createdAt,
      lat: thrones.lat, lng: thrones.lng,
    })
      .from(ratings)
      .innerJoin(thrones, eq(ratings.throneId, thrones.id))
      .where(and(
        eq(ratings.userId, ctx.user.id),
        eq(ratings.verified, true),
        ne(ratings.id, ctx.rating.id)
      ))
      .orderBy(desc(ratings.createdAt))
      .limit(1);

    if (prev) {
      const km = haversineMeters(prev, ctx.rating.throne) / 1000;
      // Floor elapsed time at one minute so same-timestamp pairs don't divide by zero.
      const hours = Math.max((ctx.rating.createdAt - prev.createdAt.getTime()) / HOUR_MS, 1 / 60);
      const kmh = km / hours;
      if (kmh > SAFETY.impossibleTravelKmh) {
        signals.push({
          signal: "impossible_travel",
          kmh: Math.round(kmh),
          fromThroneId: prev.throneId,
          minutes: Math.round((ctx.rating.createdAt - prev.createdAt.getTime()) / 60_000),
        });
      }
    }
  }

  if (signals.length === 0) return null;

  const severity = signals
    .map((s) => SIGNAL_SEVERITY[s.signal])
    .reduce((max, s) => (RANK[s] > RANK[max] ? s : max), "low" as Severity);

  const [row] = await db.insert(reviewQueue).values({
    kind: ctx.kind, subjectId: ctx.subjectId, userId: ctx.user.id,
    signals, severity, createdAt: new Date(now),
  }).returning();
  return row;
}
```

- [ ] **Step 4 (Claude): Run tests to verify they pass**

Run: `npx vitest run src/test/signals.test.ts`
Expected: PASS.

- [ ] **Step 5 (Claude): Commit**

```bash
git add src/lib/server/signals.ts src/test/signals.test.ts
git commit -m "feat: anti-gaming signals module — hard ceiling + soft flags to review queue"
```

---

### Task 5: AI triage module

Model default `claude-haiku-4-5` (verified current cheapest tier, $1/$5 per MTok — a triage call costs a fraction of a cent), overridable via `TRIAGE_MODEL`. Structured JSON via `output_config.format` on `client.messages.create` (the official `@anthropic-ai/sdk`). Tests inject a fake client — no network.

**Files:**
- Create: `src/lib/server/triage.ts`
- Modify: `package.json` (Claude installs `@anthropic-ai/sdk`)
- Test: `src/test/triage.test.ts`

- [ ] **Step 1 (Claude): Install the SDK**

Run: `npm install @anthropic-ai/sdk`
Expected: added to `dependencies`.

- [ ] **Step 2: Write the failing tests** — `src/test/triage.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { reviewQueue } from "@/db/schema";
import { runTriage, type TriageClient } from "@/lib/server/triage";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

async function makeReviewRow(userId: string, subjectId: string) {
  const [row] = await db.insert(reviewQueue).values({
    kind: "new_throne", subjectId, userId,
    signals: [{ signal: "new_throne" }], severity: "low",
  }).returning();
  return row;
}

describe("runTriage", () => {
  beforeEach(resetDb);

  it("writes the assessment and suggested severity back onto the row", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id, { name: "Steve's Apartment Bathroom" });
    const row = await makeReviewRow(user.id, throne.id);

    const prompts: string[] = [];
    const fake: TriageClient = {
      async triage(prompt) {
        prompts.push(prompt);
        return { assessment: "Name suggests a private residence.", severity: "high" };
      },
    };
    await runTriage(row.id, fake);

    const [updated] = await db.select().from(reviewQueue).where(eq(reviewQueue.id, row.id));
    expect(updated.aiAssessment).toBe("Name suggests a private residence.");
    expect(updated.aiSeverity).toBe("high");
    expect(updated.aiTriagedAt).not.toBeNull();
    expect(updated.aiError).toBeNull();
    expect(prompts[0]).toContain("Steve's Apartment Bathroom"); // subject context reaches the model
  });

  it("records the failure on aiError and leaves the row pending triage", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const row = await makeReviewRow(user.id, throne.id);

    const failing: TriageClient = {
      async triage() { throw new Error("api unreachable"); },
    };
    await runTriage(row.id, failing);

    const [updated] = await db.select().from(reviewQueue).where(eq(reviewQueue.id, row.id));
    expect(updated.aiAssessment).toBeNull();
    expect(updated.aiTriagedAt).toBeNull();
    expect(updated.aiError).toContain("api unreachable");
  });

  it("re-running after a failure clears aiError on success", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const row = await makeReviewRow(user.id, throne.id);
    await runTriage(row.id, { async triage() { throw new Error("boom"); } });
    await runTriage(row.id, { async triage() { return { assessment: "Looks fine.", severity: "low" }; } });

    const [updated] = await db.select().from(reviewQueue).where(eq(reviewQueue.id, row.id));
    expect(updated.aiError).toBeNull();
    expect(updated.aiAssessment).toBe("Looks fine.");
  });
});
```

- [ ] **Step 3 (Claude): Run tests to verify they fail**

Run: `npx vitest run src/test/triage.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement** — `src/lib/server/triage.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, gte, sql } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/db/client";
import { ratings, reviewQueue, thrones, users } from "@/db/schema";

type Severity = "low" | "medium" | "high";
const SEVERITIES: readonly Severity[] = ["low", "medium", "high"];

export interface TriageClient {
  triage(prompt: string): Promise<{ assessment: string; severity: Severity }>;
}

const SYSTEM = `You are the Maester of Records for "Shame of Thrones", a playful
restroom-rating game with a territory mechanic. You triage flagged user actions
for a human moderator. You see the tripped heuristic signals and the action's
context. Write a short plain-English read of what is probably happening (benign
enthusiasm vs. gaming vs. policy problem like a private residence being charted),
and suggest a severity. Be concrete and calm; the moderator decides, not you.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    assessment: { type: "string", description: "2-4 sentences for the moderator" },
    severity: { type: "string", enum: ["low", "medium", "high"] },
  },
  required: ["assessment", "severity"],
  additionalProperties: false,
} as const;

export function anthropicTriageClient(): TriageClient {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  const model = process.env.TRIAGE_MODEL ?? "claude-haiku-4-5";
  return {
    async triage(prompt) {
      const response = await client.messages.create({
        model,
        max_tokens: 1024,
        system: SYSTEM,
        output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.content.find((b) => b.type === "text")?.text ?? "";
      const parsed = JSON.parse(text) as { assessment: string; severity: string };
      const severity = SEVERITIES.includes(parsed.severity as Severity)
        ? (parsed.severity as Severity)
        : "medium";
      return { assessment: parsed.assessment, severity };
    },
  };
}

/** Builds the moderator-context prompt: signals + subject + a compact activity
 * summary (counts and timestamps — display name is the only PII sent). */
async function buildPrompt(row: typeof reviewQueue.$inferSelect): Promise<string> {
  const user = await db.query.users.findFirst({ where: eq(users.id, row.userId) });
  const count = sql<number>`count(*)::int`;
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [[ratingCount], [recentRatings], [throneCount]] = await Promise.all([
    db.select({ n: count }).from(ratings).where(eq(ratings.userId, row.userId)),
    db.select({ n: count }).from(ratings)
      .where(and(eq(ratings.userId, row.userId), gte(ratings.createdAt, weekAgo))),
    db.select({ n: count }).from(thrones).where(eq(thrones.addedBy, row.userId)),
  ]);

  let subject = "";
  if (row.kind === "rating") {
    const rating = await db.query.ratings.findFirst({ where: eq(ratings.id, row.subjectId) });
    const throne = rating
      ? await db.query.thrones.findFirst({ where: eq(thrones.id, rating.throneId) })
      : undefined;
    subject = `A ${rating?.verified ? "verified" : "hearsay"} rating (verdict ${rating?.verdict}/5, tags: ${rating?.tags.join(", ") || "none"}) at throne "${throne?.name}" (category ${throne?.category}, at ${throne?.lat}, ${throne?.lng}).`;
  } else {
    const throne = await db.query.thrones.findFirst({ where: eq(thrones.id, row.subjectId) });
    subject = `${row.kind === "new_throne" ? "A newly charted throne" : "A confirmation of throne"}: "${throne?.name}" (category ${throne?.category}, at ${throne?.lat}, ${throne?.lng}, status ${throne?.status}).`;
  }

  return [
    `Flagged action kind: ${row.kind}`,
    `Tripped signals: ${JSON.stringify(row.signals)}`,
    `Rule-assigned severity: ${row.severity}`,
    `Subject: ${subject}`,
    `Actor: "${user?.displayName}", account created ${user?.joinedAt.toISOString()}, ` +
      `${ratingCount.n} lifetime ratings (${recentRatings.n} in the last 7 days), ${throneCount.n} thrones charted.`,
    `What is probably going on here, and what severity would you assign?`,
  ].join("\n");
}

export async function runTriage(
  reviewId: string,
  client: TriageClient = anthropicTriageClient()
): Promise<void> {
  const row = await db.query.reviewQueue.findFirst({ where: eq(reviewQueue.id, reviewId) });
  if (!row || row.status !== "pending") return;
  try {
    const prompt = await buildPrompt(row);
    const result = await client.triage(prompt);
    await db.update(reviewQueue).set({
      aiAssessment: result.assessment,
      aiSeverity: result.severity,
      aiTriagedAt: new Date(),
      aiError: null,
    }).where(eq(reviewQueue.id, reviewId));
  } catch (e) {
    await db.update(reviewQueue).set({
      aiError: e instanceof Error ? e.message : String(e),
    }).where(eq(reviewQueue.id, reviewId));
  }
}

/** Fire triage in the background after the response is sent. Falls back to
 * fire-and-forget outside a Next request scope (tests never hit this — they
 * call runTriage directly with a fake client). */
export function scheduleTriage(reviewId: string): void {
  try {
    after(() => runTriage(reviewId));
  } catch {
    void runTriage(reviewId);
  }
}
```

Note for the implementer: a missing `ANTHROPIC_API_KEY` surfaces as the SDK throwing inside `client.triage(...)`, and the catch writes it to `aiError`. Keep it that simple; do not add retry logic.

- [ ] **Step 5 (Claude): Run tests to verify they pass**

Run: `npx vitest run src/test/triage.test.ts`
Expected: PASS.

- [ ] **Step 6 (Claude): Commit**

```bash
git add package.json package-lock.json src/lib/server/triage.ts src/test/triage.test.ts
git commit -m "feat: Claude API triage module for review-queue annotations"
```

---

### Task 6: Age gate — server lib, endpoint, /api/me flags

**Files:**
- Create: `src/lib/server/ageGate.ts`
- Create: `src/app/api/age-gate/route.ts`
- Modify: `src/app/api/me/route.ts`
- Test: `src/test/age-gate.test.ts`

- [ ] **Step 1: Write the failing tests** — `src/test/age-gate.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { ageAttestations } from "@/db/schema";
import { AgeGateError, ageGateStatus, requireAgeGate, submitBirthDate } from "@/lib/server/ageGate";
import { resetDb } from "./db";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
import { auth } from "@/auth";
import { POST as ageGatePOST } from "@/app/api/age-gate/route";

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("submitBirthDate", () => {
  beforeEach(resetDb);

  it("confirms someone who turns 13 exactly today, discards the date", async () => {
    const now = new Date("2026-07-11T12:00:00Z");
    const result = await submitBirthDate("sub-x", "2013-07-11", now);
    expect(result).toEqual({ confirmed: true, locked: false });
    const rows = await db.select().from(ageAttestations);
    expect(rows).toHaveLength(1);
    expect(rows[0].over13ConfirmedAt).not.toBeNull(); // only a timestamp — no birthdate column exists
  });

  it("locks someone who turns 13 tomorrow, and the lock survives retries", async () => {
    const now = new Date("2026-07-11T12:00:00Z");
    expect(await submitBirthDate("sub-y", "2013-07-12", now)).toEqual({ confirmed: false, locked: true });
    // retry with an adult birthdate — still locked
    expect(await submitBirthDate("sub-y", "1990-01-01", now)).toEqual({ confirmed: false, locked: true });
  });

  it("is idempotent once confirmed", async () => {
    const now = new Date();
    await submitBirthDate("sub-z", iso(new Date(now.getTime() - 20 * 365 * DAY)), now);
    expect(await ageGateStatus("sub-z")).toEqual({ confirmed: true, locked: false });
  });
});

describe("requireAgeGate", () => {
  beforeEach(resetDb);

  it("throws age_gate_required with 403 when unattested", async () => {
    await expect(requireAgeGate("sub-none")).rejects.toMatchObject({ code: "age_gate_required", status: 403 });
  });

  it("throws age_gate_locked when locked", async () => {
    await submitBirthDate("sub-kid", "2020-01-01", new Date());
    await expect(requireAgeGate("sub-kid")).rejects.toBeInstanceOf(AgeGateError);
    await expect(requireAgeGate("sub-kid")).rejects.toMatchObject({ code: "age_gate_locked" });
  });

  it("passes when confirmed", async () => {
    await submitBirthDate("sub-ok", "1990-01-01", new Date());
    await expect(requireAgeGate("sub-ok")).resolves.toBeUndefined();
  });
});

describe("POST /api/age-gate", () => {
  beforeEach(resetDb);

  it("401s without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const res = await ageGatePOST(new Request("http://test/api/age-gate", {
      method: "POST", body: JSON.stringify({ birthDate: "1990-01-01" }),
    }));
    expect(res.status).toBe(401);
  });

  it("confirms an adult birthdate for a signed-in session without a profile", async () => {
    vi.mocked(auth).mockResolvedValue({ googleSubject: "sub-api" } as never);
    const res = await ageGatePOST(new Request("http://test/api/age-gate", {
      method: "POST", body: JSON.stringify({ birthDate: "1990-01-01" }),
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ confirmed: true, locked: false });
  });

  it("400s a malformed date", async () => {
    vi.mocked(auth).mockResolvedValue({ googleSubject: "sub-api" } as never);
    const res = await ageGatePOST(new Request("http://test/api/age-gate", {
      method: "POST", body: JSON.stringify({ birthDate: "not-a-date" }),
    }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2 (Claude): Run tests to verify they fail**

Run: `npx vitest run src/test/age-gate.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement the lib** — `src/lib/server/ageGate.ts`:

```ts
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { ageAttestations } from "@/db/schema";

export interface AgeGateStatus {
  confirmed: boolean;
  locked: boolean;
}

export class AgeGateError extends Error {
  status = 403;
  constructor(public code: "age_gate_required" | "age_gate_locked") {
    super(code);
  }
}

export async function ageGateStatus(googleSubject: string): Promise<AgeGateStatus> {
  const row = await db.query.ageAttestations.findFirst({
    where: eq(ageAttestations.googleSubject, googleSubject),
  });
  return { confirmed: !!row?.over13ConfirmedAt, locked: !!row?.lockedAt };
}

/** Calendar-correct: you turn 13 ON your 13th birthday (UTC). */
function isAtLeast13(birthDate: string, now: Date): boolean {
  const [y, m, d] = birthDate.split("-").map(Number);
  const thirteenthBirthday = Date.UTC(y + 13, m - 1, d);
  return now.getTime() >= thirteenthBirthday;
}

/** COPPA neutral gate. The birthdate is computed against and discarded —
 * only the outcome timestamp is stored. A lock is permanent. */
export async function submitBirthDate(
  googleSubject: string,
  birthDate: string,
  now = new Date()
): Promise<AgeGateStatus> {
  const existing = await ageGateStatus(googleSubject);
  if (existing.locked || existing.confirmed) return existing;

  if (isAtLeast13(birthDate, now)) {
    await db.insert(ageAttestations)
      .values({ googleSubject, over13ConfirmedAt: now })
      .onConflictDoUpdate({
        target: ageAttestations.googleSubject,
        set: { over13ConfirmedAt: now },
      });
    return { confirmed: true, locked: false };
  }

  await db.insert(ageAttestations)
    .values({ googleSubject, lockedAt: now })
    .onConflictDoUpdate({
      target: ageAttestations.googleSubject,
      set: { lockedAt: now },
    });
  return { confirmed: false, locked: true };
}

export async function requireAgeGate(googleSubject: string): Promise<void> {
  const status = await ageGateStatus(googleSubject);
  if (status.locked) throw new AgeGateError("age_gate_locked");
  if (!status.confirmed) throw new AgeGateError("age_gate_required");
}
```

- [ ] **Step 4: Implement the endpoint** — `src/app/api/age-gate/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { submitBirthDate } from "@/lib/server/ageGate";

const bodySchema = z.object({
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(req: Request) {
  const session = await auth();
  const sub = session?.googleSubject;
  if (!sub) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const [y, m, d] = parsed.data.birthDate.split("-").map(Number);
  const asDate = new Date(Date.UTC(y, m - 1, d));
  const valid = y >= 1900 && asDate.getTime() <= Date.now() &&
    asDate.getUTCMonth() === m - 1 && asDate.getUTCDate() === d;
  if (!valid) return NextResponse.json({ error: "invalid date" }, { status: 400 });

  return NextResponse.json(await submitBirthDate(sub, parsed.data.birthDate));
}
```

- [ ] **Step 5: Surface flags on /api/me** — replace `src/app/api/me/route.ts`:

```ts
import { NextResponse } from "next/server";
import { sessionInfo } from "@/lib/server/session";
import { ageGateStatus } from "@/lib/server/ageGate";
import { mePayload } from "@/lib/server/profile";

export const dynamic = "force-dynamic";

export async function GET() {
  const info = await sessionInfo();
  if (info.kind === "anonymous") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sub = info.kind === "user" ? info.user.googleSubject : info.googleSubject;
  const ageGate = await ageGateStatus(sub);

  if (info.kind === "no_profile") return NextResponse.json({ profile: null, ageGate });
  return NextResponse.json({ ...(await mePayload(info.user.id)), ageGate });
}
```

- [ ] **Step 6 (Claude): Run tests to verify they pass**

Run: `npx vitest run src/test/age-gate.test.ts`
Expected: PASS.

- [ ] **Step 7 (Claude): Commit**

```bash
git add src/lib/server/ageGate.ts src/app/api/age-gate src/app/api/me/route.ts src/test/age-gate.test.ts
git commit -m "feat: COPPA age gate — attestation table, endpoint, me flags"
```

---

### Task 7: Harden the write routes

Every authenticated write gets: age-gate check → hard ceiling → action → signals → background triage. Add-a-Throne additionally requires the attestation flag and always queues.

**Files:**
- Modify: `src/lib/server/ratings.ts` (return `ratingId` + throne coords)
- Modify: `src/lib/server/thrones.ts` (accept `publicAccessAttested`)
- Modify: `src/app/api/ratings/route.ts`, `src/app/api/thrones/route.ts`, `src/app/api/thrones/[id]/confirm/route.ts`, `src/app/api/profile/route.ts`
- Test: `src/test/routes-hardening.test.ts`

- [ ] **Step 1: Write the failing tests** — `src/test/routes-hardening.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { ratings, reviewQueue } from "@/db/schema";
import { submitBirthDate } from "@/lib/server/ageGate";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
import { auth } from "@/auth";
import { POST as ratingsPOST } from "@/app/api/ratings/route";
import { POST as thronesPOST } from "@/app/api/thrones/route";

const AMENITIES = { accessible: false, babyChanging: false, genderNeutral: false, freeAccess: true, open24h: false };

function post(path: string, body: unknown) {
  return new Request(`http://test${path}`, { method: "POST", body: JSON.stringify(body) });
}

describe("write-route hardening", () => {
  beforeEach(resetDb);

  it("403s a rating with age_gate_required when unattested", async () => {
    const user = await makeUser();
    vi.mocked(auth).mockResolvedValue({ googleSubject: user.googleSubject } as never);
    const throne = await makeThrone(user.id);
    const res = await ratingsPOST(post("/api/ratings", { throneId: throne.id, verdict: 4, tags: [], verified: true }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("age_gate_required");
  });

  it("accepts an attested user's rating and queues nothing for a clean write", async () => {
    const user = await makeUser();
    await submitBirthDate(user.googleSubject, "1990-01-01");
    vi.mocked(auth).mockResolvedValue({ googleSubject: user.googleSubject } as never);
    const throne = await makeThrone(user.id);
    const res = await ratingsPOST(post("/api/ratings", { throneId: throne.id, verdict: 4, tags: [], verified: true }));
    expect(res.status).toBe(201);
    expect(await db.select().from(reviewQueue)).toHaveLength(0);
  });

  it("flags but does not reject a new account's rating", async () => {
    const newbie = await makeUser({ joinedAt: new Date() });
    await submitBirthDate(newbie.googleSubject, "1990-01-01");
    vi.mocked(auth).mockResolvedValue({ googleSubject: newbie.googleSubject } as never);
    const throne = await makeThrone(newbie.id);
    const res = await ratingsPOST(post("/api/ratings", { throneId: throne.id, verdict: 4, tags: [], verified: true }));
    expect(res.status).toBe(201); // action went through — Larry's rule
    const queue = await db.select().from(reviewQueue);
    expect(queue).toHaveLength(1);
    expect(queue[0].signals.map((s) => s.signal)).toContain("new_account");
  });

  it("429s the 31st write in an hour", async () => {
    const user = await makeUser();
    await submitBirthDate(user.googleSubject, "1990-01-01");
    vi.mocked(auth).mockResolvedValue({ googleSubject: user.googleSubject } as never);
    const throne = await makeThrone(user.id);
    const now = Date.now();
    const rows = Array.from({ length: 30 }, (_, i) => ({
      throneId: throne.id, userId: user.id, verdict: 3, tags: [] as string[], verified: true,
      createdAt: new Date(now - i * 60_000),
    }));
    await db.insert(ratings).values(rows);
    const res = await ratingsPOST(post("/api/ratings", { throneId: throne.id, verdict: 4, tags: [], verified: true }));
    expect(res.status).toBe(429);
  });

  it("400s Add-a-Throne without the public-access attestation", async () => {
    const user = await makeUser();
    await submitBirthDate(user.googleSubject, "1990-01-01");
    vi.mocked(auth).mockResolvedValue({ googleSubject: user.googleSubject } as never);
    const res = await thronesPOST(post("/api/thrones", {
      name: "Somewhere", lat: 40.7, lng: -73.9, category: "cafe", amenities: AMENITIES,
    }));
    expect(res.status).toBe(400);
  });

  it("queues every attested new throne at low severity", async () => {
    const user = await makeUser();
    await submitBirthDate(user.googleSubject, "1990-01-01");
    vi.mocked(auth).mockResolvedValue({ googleSubject: user.googleSubject } as never);
    const res = await thronesPOST(post("/api/thrones", {
      name: "Corner Cafe Restroom", lat: 40.7, lng: -73.9, category: "cafe",
      amenities: AMENITIES, publicAccessAttested: true,
    }));
    expect(res.status).toBe(201);
    const queue = await db.select().from(reviewQueue);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ kind: "new_throne", severity: "low" });
  });
});
```

- [ ] **Step 2 (Claude): Run tests to verify they fail**

Run: `npx vitest run src/test/routes-hardening.test.ts`
Expected: FAIL — 403/429/attestation behavior absent.

- [ ] **Step 3: Enrich `submitRating`'s return** — in `src/lib/server/ratings.ts`, capture the inserted rating and include what signals needs:

```ts
const [insertedRating] = await tx.insert(ratings).values({
  throneId: throne.id, userId: user.id,
  verdict: input.verdict, tags: input.tags, verified: input.verified,
  createdAt: new Date(now),
}).returning();
```

and extend the final return:

```ts
return {
  updated: false as const, influence: points, flipped, firstOfName: isFirstRating, fief: after,
  ratingId: insertedRating.id,
  throne: { id: throne.id, lat: throne.lat, lng: throne.lng },
};
```

(The early `updated: true` return stays as-is — a 24h verdict update is not a new write and is never signaled.)

- [ ] **Step 4: Accept the attestation in `addThrone`** — in `src/lib/server/thrones.ts`, extend the input type with `publicAccessAttested: boolean` and pass it through to the insert values.

- [ ] **Step 5: Rewrite the three write routes + profile.**

`src/app/api/ratings/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { RATING_TAGS } from "@/lib/game/rules";
import { AgeGateError, requireAgeGate } from "@/lib/server/ageGate";
import { RatingError, submitRating } from "@/lib/server/ratings";
import { sessionInfo } from "@/lib/server/session";
import { enforceHardCeiling, evaluateSignals, RateLimitError } from "@/lib/server/signals";
import { scheduleTriage } from "@/lib/server/triage";

const bodySchema = z.object({
  throneId: z.string().uuid(),
  verdict: z.number().int().min(1).max(5),
  tags: z.array(z.string().refine((t) => (RATING_TAGS as readonly string[]).includes(t), "unknown tag")).default([]),
  verified: z.boolean(),
});

export async function POST(req: Request) {
  const info = await sessionInfo();
  if (info.kind !== "user") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  try {
    await requireAgeGate(info.user.googleSubject);
    await enforceHardCeiling(info.user.id);

    const now = Date.now();
    const result = await submitRating(info.user, {
      ...parsed.data,
      verdict: parsed.data.verdict as 1 | 2 | 3 | 4 | 5,
    }, now);

    if (!result.updated) {
      const row = await evaluateSignals({
        kind: "rating", subjectId: result.ratingId, user: info.user,
        rating: { id: result.ratingId, verified: parsed.data.verified, createdAt: now, throne: result.throne },
      }, now);
      if (row) scheduleTriage(row.id);
    }

    return NextResponse.json(result, { status: result.updated ? 200 : 201 });
  } catch (e) {
    if (e instanceof AgeGateError) return NextResponse.json({ error: e.code }, { status: e.status });
    if (e instanceof RateLimitError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof RatingError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
```

`src/app/api/thrones/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { AgeGateError, requireAgeGate } from "@/lib/server/ageGate";
import { addThrone } from "@/lib/server/thrones";
import { sessionInfo } from "@/lib/server/session";
import { enforceHardCeiling, evaluateSignals, RateLimitError } from "@/lib/server/signals";
import { scheduleTriage } from "@/lib/server/triage";

const bodySchema = z.object({
  name: z.string().trim().min(2).max(80),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  category: z.enum(["cafe", "restaurant", "park", "transit", "library", "retail", "municipal", "gas_station", "other"]),
  amenities: z.object({
    accessible: z.boolean(), babyChanging: z.boolean(), genderNeutral: z.boolean(),
    freeAccess: z.boolean(), open24h: z.boolean(),
  }),
  publicAccessAttested: z.literal(true), // private residences may not be charted
});

export async function POST(req: Request) {
  const info = await sessionInfo();
  if (info.kind !== "user") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  try {
    await requireAgeGate(info.user.googleSubject);
    await enforceHardCeiling(info.user.id);

    const now = Date.now();
    const throne = await addThrone(info.user, parsed.data, now);

    // Every new throne is queued (low severity) so a human reviews for
    // residence-style entries; the throne still appears immediately as Rumored.
    const row = await evaluateSignals({ kind: "new_throne", subjectId: throne.id, user: info.user }, now);
    if (row) scheduleTriage(row.id);

    return NextResponse.json({ ok: true, throneId: throne.id }, { status: 201 });
  } catch (e) {
    if (e instanceof AgeGateError) return NextResponse.json({ error: e.code }, { status: e.status });
    if (e instanceof RateLimitError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
```

`src/app/api/thrones/[id]/confirm/route.ts`:

```ts
import { NextResponse } from "next/server";
import { AgeGateError, requireAgeGate } from "@/lib/server/ageGate";
import { confirmThrone, ThroneError } from "@/lib/server/thrones";
import { sessionInfo } from "@/lib/server/session";
import { enforceHardCeiling, evaluateSignals, RateLimitError } from "@/lib/server/signals";
import { scheduleTriage } from "@/lib/server/triage";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const info = await sessionInfo();
  if (info.kind !== "user") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    await requireAgeGate(info.user.googleSubject);
    await enforceHardCeiling(info.user.id);

    const now = Date.now();
    const throne = await confirmThrone(info.user, id, now);

    const row = await evaluateSignals({ kind: "confirmation", subjectId: throne.id, user: info.user }, now);
    if (row) scheduleTriage(row.id);

    return NextResponse.json({ ok: true, status: throne.status });
  } catch (e) {
    if (e instanceof AgeGateError) return NextResponse.json({ error: e.code }, { status: e.status });
    if (e instanceof RateLimitError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof ThroneError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
```

`src/app/api/profile/route.ts` — add the gate for both branches (no ceiling/signals; profile writes aren't influence-earning). After the body parse, add at the top of the existing try block:

```ts
await requireAgeGate(info.kind === "user" ? info.user.googleSubject : info.googleSubject);
```

and add to its catch chain:

```ts
if (e instanceof AgeGateError) return NextResponse.json({ error: e.code }, { status: e.status });
```

(plus the two imports).

- [ ] **Step 6 (Claude): Run the full suite** (existing route tests must stay green — `src/test/ratings.test.ts`'s authz test mocks `auth` to null and still expects 401)

Run: `npm test`
Expected: PASS. If `src/test/thrones.test.ts` calls `addThrone` directly, add `publicAccessAttested: true` to those inputs — update them as part of this task.

- [ ] **Step 7 (Claude): Commit**

```bash
git add src/lib/server/ratings.ts src/lib/server/thrones.ts src/app/api src/test/routes-hardening.test.ts src/test/thrones.test.ts
git commit -m "feat: harden write routes — age gate, rate ceiling, signals, attestation"
```

---

### Task 8: Moderator review API

**Files:**
- Create: `src/lib/server/review.ts`
- Create: `src/app/api/review/route.ts`
- Create: `src/app/api/review/[id]/route.ts`
- Create: `src/app/api/review/[id]/triage/route.ts`
- Test: `src/test/review.test.ts`

- [ ] **Step 1: Write the failing tests** — `src/test/review.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { reviewQueue } from "@/db/schema";
import { listReview, resolveReview } from "@/lib/server/review";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
import { auth } from "@/auth";
import { GET as reviewGET } from "@/app/api/review/route";

async function makeItem(userId: string, subjectId: string, overrides: Partial<typeof reviewQueue.$inferInsert> = {}) {
  const [row] = await db.insert(reviewQueue).values({
    kind: "new_throne", subjectId, userId,
    signals: [{ signal: "new_throne" }], severity: "low", ...overrides,
  }).returning();
  return row;
}

describe("review queue server lib", () => {
  beforeEach(resetDb);

  it("lists pending items with actor name and subject summary", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id, { name: "Sketchy Cellar" });
    await makeItem(user.id, throne.id);
    const items = await listReview();
    expect(items).toHaveLength(1);
    expect(items[0].actor).toBe(user.displayName);
    expect(items[0].subject).toContain("Sketchy Cellar");
    expect(items[0].status).toBe("pending");
  });

  it("resolveReview stamps moderator, time, and note", async () => {
    const user = await makeUser();
    const mod = await makeUser({ role: "moderator" });
    const throne = await makeThrone(user.id);
    const item = await makeItem(user.id, throne.id);
    await resolveReview(item.id, mod.id, "benign — verified venue on street view");

    const [row] = await db.select().from(reviewQueue).where(eq(reviewQueue.id, item.id));
    expect(row.status).toBe("resolved");
    expect(row.resolvedBy).toBe(mod.id);
    expect(row.resolutionNote).toContain("street view");
    expect(row.resolvedAt).not.toBeNull();
  });
});

describe("GET /api/review authz", () => {
  beforeEach(resetDb);

  it("404s for anonymous and for non-moderators", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await reviewGET()).status).toBe(404);

    const pleb = await makeUser();
    vi.mocked(auth).mockResolvedValue({ googleSubject: pleb.googleSubject } as never);
    expect((await reviewGET()).status).toBe(404);
  });

  it("200s for a moderator", async () => {
    const mod = await makeUser({ role: "moderator" });
    vi.mocked(auth).mockResolvedValue({ googleSubject: mod.googleSubject } as never);
    const res = await reviewGET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });
});
```

- [ ] **Step 2 (Claude): Run tests to verify they fail**

Run: `npx vitest run src/test/review.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement the lib** — `src/lib/server/review.ts`:

```ts
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { ratings, reviewQueue, thrones, users } from "@/db/schema";
import { sessionInfo } from "./session";

export interface ReviewItemDTO {
  id: string;
  kind: "rating" | "new_throne" | "confirmation";
  severity: "low" | "medium" | "high";
  status: "pending" | "resolved";
  signals: unknown[];
  actor: string;
  subject: string;
  aiAssessment: string | null;
  aiSeverity: "low" | "medium" | "high" | null;
  aiTriagedAt: number | null;
  aiError: string | null;
  createdAt: number;
  resolvedAt: number | null;
  resolutionNote: string | null;
}

/** Moderator gate: null → the route responds 404 (not 403), so the surface
 * doesn't advertise itself. */
export async function moderatorOrNull() {
  const info = await sessionInfo();
  if (info.kind !== "user" || info.user.role !== "moderator") return null;
  return info.user;
}

async function subjectSummary(row: typeof reviewQueue.$inferSelect): Promise<string> {
  if (row.kind === "rating") {
    const rating = await db.query.ratings.findFirst({ where: eq(ratings.id, row.subjectId) });
    if (!rating) return "Rating (missing)";
    const throne = await db.query.thrones.findFirst({ where: eq(thrones.id, rating.throneId) });
    return `${rating.verified ? "Verified" : "Hearsay"} ${rating.verdict}/5 rating at "${throne?.name ?? "?"}"`;
  }
  const throne = await db.query.thrones.findFirst({ where: eq(thrones.id, row.subjectId) });
  const label = row.kind === "new_throne" ? "New throne" : "Confirmation of";
  return `${label} "${throne?.name ?? "?"}"`;
}

/** Pending first (newest first), then a short tail of recently resolved. */
export async function listReview(): Promise<ReviewItemDTO[]> {
  const pending = await db.select().from(reviewQueue)
    .where(eq(reviewQueue.status, "pending"))
    .orderBy(desc(reviewQueue.createdAt)).limit(100);
  const resolved = await db.select().from(reviewQueue)
    .where(eq(reviewQueue.status, "resolved"))
    .orderBy(desc(reviewQueue.resolvedAt)).limit(10);
  const rows = [...pending, ...resolved];
  if (rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.userId))];
  const actorRows = await db.select({ id: users.id, name: users.displayName })
    .from(users).where(inArray(users.id, userIds));
  const nameById = new Map(actorRows.map((u) => [u.id, u.name]));

  return Promise.all(rows.map(async (row) => ({
    id: row.id, kind: row.kind, severity: row.severity, status: row.status,
    signals: row.signals,
    actor: nameById.get(row.userId) ?? "?",
    subject: await subjectSummary(row),
    aiAssessment: row.aiAssessment, aiSeverity: row.aiSeverity,
    aiTriagedAt: row.aiTriagedAt?.getTime() ?? null,
    aiError: row.aiError,
    createdAt: row.createdAt.getTime(),
    resolvedAt: row.resolvedAt?.getTime() ?? null,
    resolutionNote: row.resolutionNote,
  })));
}

export async function resolveReview(reviewId: string, moderatorId: string, note?: string): Promise<void> {
  await db.update(reviewQueue).set({
    status: "resolved", resolvedBy: moderatorId, resolvedAt: new Date(),
    resolutionNote: note?.trim() || null,
  }).where(eq(reviewQueue.id, reviewId));
}
```

- [ ] **Step 4: Implement the routes.**

`src/app/api/review/route.ts`:

```ts
import { NextResponse } from "next/server";
import { listReview, moderatorOrNull } from "@/lib/server/review";

export const dynamic = "force-dynamic";

export async function GET() {
  const mod = await moderatorOrNull();
  if (!mod) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ items: await listReview() });
}
```

`src/app/api/review/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { moderatorOrNull, resolveReview } from "@/lib/server/review";

const bodySchema = z.object({
  action: z.literal("resolve"),
  note: z.string().max(500).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const mod = await moderatorOrNull();
  if (!mod) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  await resolveReview(id, mod.id, parsed.data.note);
  return NextResponse.json({ ok: true });
}
```

`src/app/api/review/[id]/triage/route.ts` (synchronous re-run — the moderator is watching):

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { reviewQueue } from "@/db/schema";
import { moderatorOrNull } from "@/lib/server/review";
import { runTriage } from "@/lib/server/triage";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const mod = await moderatorOrNull();
  if (!mod) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { id } = await params;
  await runTriage(id);
  const row = await db.query.reviewQueue.findFirst({ where: eq(reviewQueue.id, id) });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: !row.aiError, aiError: row.aiError });
}
```

- [ ] **Step 5 (Claude): Run tests to verify they pass**

Run: `npx vitest run src/test/review.test.ts`
Expected: PASS.

- [ ] **Step 6 (Claude): Commit**

```bash
git add src/lib/server/review.ts src/app/api/review src/test/review.test.ts
git commit -m "feat: moderator review API — list, resolve, re-run triage"
```

---

### Task 9: Client — age gate screen and store wiring

**Files:**
- Modify: `src/lib/api.ts`
- Modify: `src/lib/store.tsx`
- Create: `src/components/AgeGate.tsx`
- Modify: `src/app/page.tsx`

No unit tests (client wiring) — verified in the browser gate at the end. Keep `npx tsc --noEmit` green.

- [ ] **Step 1: Extend the API client** — in `src/lib/api.ts`:

Add to `MeDTO`:

```ts
ageGate?: { confirmed: boolean; locked: boolean };
```

Add to the `api` object:

```ts
ageGate: (birthDate: string) =>
  request<{ confirmed: boolean; locked: boolean }>("/api/age-gate", {
    method: "POST", body: JSON.stringify({ birthDate }),
  }),
```

And extend `addThrone`'s input type with `publicAccessAttested: boolean` (used in Task 10).

- [ ] **Step 2: Extend the store** — in `src/lib/store.tsx`:

Add to `StoreState`:

```ts
ageGate: { confirmed: boolean; locked: boolean } | null;
```

Initialize it as `null`; in `refresh()`'s `setState`, add `ageGate: me?.ageGate ?? null`. Add to `StoreContextValue` and the memoized value:

```ts
submitAgeGate: (birthDate: string) => Promise<void>;
// ...
submitAgeGate: (birthDate) => mutate(() => api.ageGate(birthDate)),
```

Also extend the `addThrone` input type on `StoreContextValue` with `publicAccessAttested: boolean` (pass-through; Task 10 supplies it).

- [ ] **Step 3: The gate screen** — `src/components/AgeGate.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";

/** Neutral COPPA age screen: no mention of a cutoff. The server computes and
 * discards the date; the client never learns why a lock happened. */
export function AgeGate() {
  const { state, submitAgeGate } = useStore();
  const [birthDate, setBirthDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.ageGate?.locked) {
    return (
      <div className="stone-wall fixed inset-0 z-[1002] flex items-center justify-center px-4">
        <div className="pixel-panel w-full max-w-md p-5 text-center">
          <p className="font-mono text-[15px] uppercase tracking-widest text-brass">▸ The Gates Are Closed</p>
          <p className="mt-3 text-[15px] leading-snug text-ink-soft">
            The Realm cannot admit you at this time. Travel well, and return another day.
          </p>
        </div>
      </div>
    );
  }

  async function handleSubmit() {
    if (!birthDate) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitAgeGate(birthDate);
    } catch (e) {
      setError(e instanceof Error ? e.message : "the ravens were lost");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="stone-wall fixed inset-0 z-[1002] flex items-center justify-center px-4">
      <div className="pixel-panel w-full max-w-md p-5">
        <p className="font-mono text-[15px] uppercase tracking-widest text-brass">▸ The Maester&rsquo;s Ledger</p>
        <p className="mt-2 text-[15px] leading-snug text-ink-soft">
          Before you enter the Realm, the Maester must record your date of birth.
        </p>
        <input
          type="date"
          value={birthDate}
          onChange={(e) => setBirthDate(e.target.value)}
          className="pixel-panel-flat mt-4 w-full px-3 py-2.5 font-mono text-[16px] text-ink outline-none"
        />
        <button
          type="button"
          disabled={!birthDate || submitting}
          onClick={handleSubmit}
          className="pixel-btn mt-4 w-full py-3 text-center font-display text-[10px] tracking-wider"
        >
          ▸ Enter It Into the Record
        </button>
        {error && <p className="mt-3 text-center font-mono text-[13px] text-crimson">{error}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Gate the app** — in `src/app/page.tsx`, import `AgeGate` and insert before the `needs_profile` check:

```tsx
const signedIn = state.authStatus === "needs_profile" || state.authStatus === "ready";
if (signedIn && state.ageGate !== null && (!state.ageGate.confirmed || state.ageGate.locked)) {
  return <AgeGate />;
}
if (state.authStatus === "needs_profile") return <Onboarding />;
```

(When `ageGate` is still `null` mid-load we fall through rather than flashing the gate; `/api/me` always includes it for signed-in users after Task 6.)

- [ ] **Step 5 (Codex): Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6 (Claude): Commit**

```bash
git add src/lib/api.ts src/lib/store.tsx src/components/AgeGate.tsx src/app/page.tsx
git commit -m "feat: client age gate — neutral birthdate screen before profile creation"
```

---

### Task 10: Client — public-access attestation on Add-a-Throne

**Files:**
- Modify: `src/components/AddThroneFlow.tsx`

- [ ] **Step 1: Add the attestation checkbox.** In `AddThroneForm`, add state `const [attested, setAttested] = useState(false);`. Below the amenities block (before the "New thrones enter the Realm…" note), add:

```tsx
<button
  type="button"
  onClick={() => setAttested((v) => !v)}
  className="pixel-chip mt-4 flex w-full items-start gap-2 px-3 py-2.5 text-left"
  style={{
    background: attested ? "var(--brass)" : "var(--vellum)",
    color: attested ? "var(--on-brass)" : "var(--ink-soft)",
  }}
>
  <span className="font-mono text-[15px] leading-none">{attested ? "☑" : "☐"}</span>
  <span className="font-mono text-[13px] leading-snug">
    I attest this throne is in a publicly accessible place — not a private residence.
  </span>
</button>
```

Change the submit call to include the flag and the disabled condition to require it:

```tsx
await addThrone({ name: name.trim(), lat: coords.lat, lng: coords.lng, category, amenities, publicAccessAttested: true });
// ...
disabled={name.trim().length < 2 || !attested || submitting}
```

- [ ] **Step 2 (Codex): Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3 (Claude): Commit**

```bash
git add src/components/AddThroneFlow.tsx
git commit -m "feat: public-access attestation checkbox on Add-a-Throne"
```

---

### Task 11: Moderation page

**Files:**
- Create: `src/app/moderation/page.tsx`
- Create: `src/components/ModerationQueue.tsx`

- [ ] **Step 1: Server component with role check** — `src/app/moderation/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { ModerationQueue } from "@/components/ModerationQueue";
import { sessionInfo } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function ModerationPage() {
  const info = await sessionInfo();
  if (info.kind !== "user" || info.user.role !== "moderator") notFound();

  return (
    <div className="stone-wall min-h-dvh px-4 py-6">
      <div className="mx-auto max-w-2xl">
        <p className="font-mono text-[15px] uppercase tracking-widest text-brass">▸ The Small Council</p>
        <h1 className="mt-2 font-display text-[13px] leading-relaxed text-ink">Review Queue</h1>
        <ModerationQueue />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: The queue list** — `src/components/ModerationQueue.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";

interface ReviewItem {
  id: string;
  kind: string;
  severity: "low" | "medium" | "high";
  status: "pending" | "resolved";
  signals: { signal: string; [k: string]: unknown }[];
  actor: string;
  subject: string;
  aiAssessment: string | null;
  aiSeverity: "low" | "medium" | "high" | null;
  aiError: string | null;
  createdAt: number;
  resolutionNote: string | null;
}

const SEVERITY_BG: Record<string, string> = {
  low: "var(--vellum)", medium: "var(--brass)", high: "var(--crimson)",
};

export function ModerationQueue() {
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/review");
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      setItems((await res.json()).items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "the ravens were lost");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function act(id: string, path: string, body?: unknown) {
    setBusy(id);
    try {
      await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p className="mt-4 font-mono text-[13px] text-crimson">{error}</p>;
  if (items === null) return <p className="mt-4 font-mono text-[13px] text-ink-faint">Consulting the ledgers…</p>;
  if (items.length === 0) return <p className="mt-4 font-mono text-[13px] text-ink-faint">The queue is empty. The Realm is at peace.</p>;

  return (
    <div className="mt-4 flex flex-col gap-3">
      {items.map((item) => (
        <div key={item.id} className="pixel-panel p-4" style={{ opacity: item.status === "resolved" ? 0.6 : 1 }}>
          <div className="flex items-center gap-2">
            <span
              className="pixel-chip px-2 py-0.5 font-mono text-[12px] uppercase"
              style={{ background: SEVERITY_BG[item.severity], color: item.severity === "low" ? "var(--ink-soft)" : "var(--on-brass)" }}
            >
              {item.severity}
            </span>
            <span className="font-mono text-[12px] uppercase tracking-wide text-ink-faint">{item.kind}</span>
            <span className="ml-auto font-mono text-[12px] text-ink-faint">
              {new Date(item.createdAt).toLocaleString()}
            </span>
          </div>

          <p className="mt-2 font-mono text-[14px] text-ink">{item.subject}</p>
          <p className="mt-1 font-mono text-[13px] text-ink-soft">
            by <b>{item.actor}</b> · signals: {item.signals.map((s) => s.signal).join(", ")}
          </p>

          {item.aiAssessment ? (
            <div className="pixel-panel-flat mt-3 p-3">
              <p className="font-mono text-[12px] uppercase tracking-wide text-brass">
                Maester&rsquo;s note{item.aiSeverity ? ` · suggests ${item.aiSeverity}` : ""}
              </p>
              <p className="mt-1 text-[14px] leading-snug text-ink-soft">{item.aiAssessment}</p>
            </div>
          ) : (
            <p className="mt-3 font-mono text-[13px] text-ink-faint">
              {item.aiError ? `Triage failed: ${item.aiError}` : "Triage pending…"}
            </p>
          )}

          {item.status === "pending" ? (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busy === item.id}
                onClick={() => {
                  const note = window.prompt("Resolution note (optional):") ?? undefined;
                  void act(item.id, `/api/review/${item.id}`, { action: "resolve", note });
                }}
                className="pixel-btn flex-1 py-2 font-display text-[9px] tracking-wide"
              >
                Resolve
              </button>
              {!item.aiAssessment && (
                <button
                  type="button"
                  disabled={busy === item.id}
                  onClick={() => void act(item.id, `/api/review/${item.id}/triage`)}
                  className="pixel-chip flex-1 bg-vellum py-2 font-mono text-[13px] uppercase tracking-wide text-ink-soft"
                >
                  Ask the Maester again
                </button>
              )}
            </div>
          ) : (
            item.resolutionNote && (
              <p className="mt-2 font-mono text-[13px] italic text-ink-faint">Resolved: {item.resolutionNote}</p>
            )
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3 (Codex): Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4 (Claude): Commit**

```bash
git add src/app/moderation src/components/ModerationQueue.tsx
git commit -m "feat: minimal moderation queue page"
```

---

### Task 12: Env, docs, and the verify gate

**Files:**
- Modify: `README.md` (env var section), `docs/ROADMAP.md` (checkboxes)
- Env: `.env.local` + Vercel project settings

- [ ] **Step 1 (Claude): Environment.** Add to `.env.local`:

```
ANTHROPIC_API_KEY=<Larry's key>
TRIAGE_MODEL=claude-haiku-4-5
```

Vercel: add the same two env vars in the dashboard (Settings → Environment Variables) — flag this to Larry; the Vercel CLI is not installed. Without the key, triage rows show a clean `aiError` and the re-run button — nothing breaks.

- [ ] **Step 2: Docs.** README: document the two new env vars and the `/moderation` page (promote a moderator with `UPDATE users SET role = 'moderator' WHERE display_name = '...';` in the Neon console). ROADMAP Phase 1: check off the age-gate item; check the anti-gaming item with a note that device/IP-level limits and mock-location flags await native clients; check the private-residence item with a note that parcel-proximity review is out of scope pending a data source; leave the report-flow/moderator-tooling box unchecked (this queue is its seed — subsystem #4 grows it).

- [ ] **Step 3 (Claude): Full verify gate.**

Run: `npm test` → all green.
Run: `npm run build` → clean production build.
Browser pass (dev server against Neon):
1. Sign in with a Google account whose subject has no attestation → neutral birthdate screen appears before anything else; enter an adult date → app loads.
2. Promote your user to moderator in Neon; visit `/moderation` → queue renders (404 for a non-moderator account or signed out).
3. Chart a new throne — the attestation checkbox is required; after submit the throne appears as Rumored AND a low-severity `new_throne` row shows on `/moderation` with a Maester's note (or "triage pending" + re-run if the key is absent).
4. Submit a rating from a fresh account (or temporarily set your `joined_at` to now in Neon) → rating succeeds, `new_account` row appears in the queue.
5. Resolve an item with a note → it drops to the resolved tail.

- [ ] **Step 4 (Claude): Commit + report.**

```bash
git add README.md docs/ROADMAP.md
git commit -m "docs: phase-1 safety env vars, moderator promotion, roadmap checkboxes"
```

Report the verify results to Larry, including anything that failed. Deploy to production only with Larry's explicit confirmation.

---

## Self-review notes

- **Spec coverage:** schema (T1), thresholds + ramp (T2–3), signals (T4), triage (T5), age gate (T6), attestation + route wiring + non-punitive flag-through (T7), moderator API (T8), client gate (T9), attestation UI (T10), moderation page (T11), env/docs/verify (T12). The spec's original "attestation columns on users" was amended (spec updated 2026-07-11) to the `age_attestations` table because the gate runs before the users row exists.
- **Type consistency:** `ReviewSignal` defined once in `schema.ts` and imported by signals; `TriageClient` defined in `triage.ts` and imported by tests; `submitRating`'s return gains `ratingId`/`throne` consumed by the ratings route; `AgeGateError.code` values match the strings tested and surfaced to the client.
- **Known simplification vs spec:** signal evaluation runs synchronously in the route (three count queries — negligible at this scale); only the LLM call is backgrounded via `after()`. The spec's intent — the user's action is never delayed by triage — is preserved.
