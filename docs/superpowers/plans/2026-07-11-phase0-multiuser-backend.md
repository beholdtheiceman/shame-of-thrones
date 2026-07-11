# Phase 0 Multi-User Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Project-specific working model:** implementation subagents are **Codex CLI** dispatches; Claude reviews every task (diff review + `npm test` + `npm run build` + exercising the flow) before it lands.

**Goal:** Replace the localStorage single-user store with a real multi-user backend (Neon Postgres + Drizzle + Auth.js Google sign-in) behind Next.js API routes, per the approved spec `docs/superpowers/specs/2026-07-11-phase0-backend-design.md`.

**Architecture:** Next.js route handlers under `src/app/api/*` are the backend. Game math is *reused, not rewritten*: `src/lib/selectors.ts` and `src/lib/geo.ts` are already pure and framework-free, so the server imports them directly — parity by construction. Server-only business rules (influence awards, 24h rating window, second-user confirm, 56-day house switch) live in `src/lib/server/*` service modules; route files are thin shells. The client store keeps its exact interface but becomes an API client.

**Tech Stack:** Next.js 16 (existing), Drizzle ORM + drizzle-kit + pg, Neon Postgres (PostGIS), Auth.js v5 (next-auth@beta) with Google, zod, vitest, tsx.

---

## Task 0: Human prerequisites (Larry — nothing else is blocked locally except live Google sign-in)

- [ ] **Neon:** create a free project at console.neon.tech named `shame-of-thrones`, Postgres 17. Create two branches: `dev` (default) and `test`. Copy both connection strings (the "Connection string" with `?sslmode=require`).
- [ ] **Google OAuth:** in console.cloud.google.com → APIs & Services → Credentials → Create OAuth client ID (Web application). Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google` (add the Vercel URL later in Task 13). Copy client ID + secret.
- [ ] **Vercel:** have an account ready; project creation happens in Task 13.
- [ ] Put values in `.env.local` and `.env.test` per Task 1 Step 3. **Never commit these files.**

Tests mock auth and only need the `test` branch DATABASE_URL, so Tasks 1–10 proceed with just the Neon setup.

---

## Task 1: Tooling — dependencies, vitest, drizzle config, DB client

**Files:**
- Modify: `package.json` (deps + scripts)
- Create: `drizzle.config.ts`, `vitest.config.ts`, `.env.example`, `src/db/client.ts`, `src/test/smoke.test.ts`
- Modify: `.gitignore` (add `.env*.local`, `.env.test`)

- [ ] **Step 1: Install dependencies**

```bash
npm install drizzle-orm pg zod next-auth@beta
npm install -D drizzle-kit @types/pg vitest tsx dotenv
```

- [ ] **Step 2: Add scripts to `package.json`**

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:seed": "tsx src/db/seed.ts"
}
```

- [ ] **Step 3: Create `.env.example`** (and locally, `.env.local` + `.env.test` with real values)

```bash
# .env.example — copy to .env.local (dev) and .env.test (Neon test branch)
DATABASE_URL="postgresql://user:password@host/dbname?sslmode=require"
AUTH_SECRET="generate with: npx auth secret"
AUTH_GOOGLE_ID="xxx.apps.googleusercontent.com"
AUTH_GOOGLE_SECRET="xxx"
```

`.env.test` needs only `DATABASE_URL` (the Neon `test` branch string).

- [ ] **Step 4: Create `drizzle.config.ts`**

```ts
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });
config(); // fallback to .env (CI)

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 5: Create `src/db/client.ts`**

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const db = drizzle(pool, { schema });
export { pool };
```

(`src/db/schema.ts` arrives in Task 2; create an empty `export {}` placeholder file now so this compiles.)

- [ ] **Step 6: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { config } from "dotenv";
import path from "node:path";

config({ path: ".env.test" });

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    fileParallelism: false, // suites share one test database
  },
});
```

- [ ] **Step 7: Smoke test** — create `src/test/smoke.test.ts`

```ts
import { describe, expect, it } from "vitest";

describe("test harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npm test` → Expected: 1 passed.
Run: `npm run build` → Expected: succeeds (placeholder schema keeps client.ts compiling).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: add drizzle, vitest, auth deps and tooling config"
```

---

## Task 2: Database schema + migrations (PostGIS, append-only ledger)

**Files:**
- Create: `src/db/schema.ts` (replacing placeholder)
- Generate: `drizzle/0000_*.sql` (via drizzle-kit)
- Create: `drizzle/0001_*.sql` (custom: PostGIS + append-only trigger)
- Create: `src/test/db.ts`, `src/test/schema.test.ts`

- [ ] **Step 1: Write `src/db/schema.ts`**

```ts
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const houseEnum = pgEnum("house_id", ["flush", "bidet", "plunger", "porcelain"]);
export const throneStatusEnum = pgEnum("throne_status", ["rumored", "verified"]);
export const throneCategoryEnum = pgEnum("throne_category", [
  "cafe", "restaurant", "park", "transit", "library", "retail", "municipal", "gas_station", "other",
]);
export const influenceReasonEnum = pgEnum("influence_reason", [
  "rating", "first_of_name", "new_throne", "confirmation", "hearsay",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  googleSubject: text("google_subject").notNull().unique(),
  displayName: text("display_name").notNull().unique(),
  houseId: houseEnum("house_id").notNull(),
  badges: jsonb("badges").$type<string[]>().notNull().default([]),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  lastHouseSwitchAt: timestamp("last_house_switch_at", { withTimezone: true }),
});

export const thrones = pgTable("thrones", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  category: throneCategoryEnum("category").notNull(),
  status: throneStatusEnum("status").notNull().default("rumored"),
  amenities: jsonb("amenities")
    .$type<{
      accessible: boolean; babyChanging: boolean; genderNeutral: boolean;
      freeAccess: boolean; open24h: boolean;
    }>()
    .notNull(),
  addedBy: uuid("added_by").notNull().references(() => users.id),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ratings = pgTable(
  "ratings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    throneId: uuid("throne_id").notNull().references(() => thrones.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    verdict: integer("verdict").notNull(),
    tags: text("tags").array().notNull().default([]),
    verified: boolean("verified").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ratings_throne_idx").on(t.throneId), index("ratings_user_idx").on(t.userId)]
);

export const influenceEvents = pgTable(
  "influence_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fiefId: text("fief_id").notNull(),
    houseId: houseEnum("house_id").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id),
    points: integer("points").notNull(),
    reason: influenceReasonEnum("reason").notNull(),
    throneId: uuid("throne_id").notNull().references(() => thrones.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("influence_fief_idx").on(t.fiefId), index("influence_user_idx").on(t.userId)]
);

export const ledgerEntries = pgTable("ledger_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Generate base migration**

Run: `npm run db:generate` → Expected: creates `drizzle/0000_<name>.sql` with the five tables and four enums.

- [ ] **Step 3: Custom migration — PostGIS + append-only trigger**

Run: `npx drizzle-kit generate --custom --name=postgis-append-only`, then fill the created `drizzle/0001_postgis-append-only.sql` with:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
ALTER TABLE "thrones" ADD COLUMN "location" geography(Point,4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) STORED;
--> statement-breakpoint
CREATE FUNCTION forbid_influence_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'influence_events is append-only';
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER influence_events_append_only
  BEFORE UPDATE OR DELETE ON "influence_events"
  FOR EACH ROW EXECUTE FUNCTION forbid_influence_mutation();
```

- [ ] **Step 4: Run migrations against dev and test branches**

Run: `npm run db:migrate` (uses `.env.local`), then against the test branch — in PowerShell: `$env:DATABASE_URL='<test-branch-url>'; npx drizzle-kit migrate; Remove-Item Env:DATABASE_URL`.
Expected: both apply 0000 + 0001 cleanly.

- [ ] **Step 5: Create test DB helper `src/test/db.ts`**

```ts
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/** Wipe all rows between tests. TRUNCATE bypasses the row-level
 * append-only trigger (it fires on UPDATE/DELETE, not TRUNCATE). */
export async function resetDb(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE ratings, influence_events, ledger_entries, thrones, users CASCADE`
  );
}
```

- [ ] **Step 6: Write schema behavior test `src/test/schema.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { influenceEvents, thrones, users } from "@/db/schema";
import { resetDb } from "./db";

describe("schema integrity", () => {
  beforeEach(resetDb);

  it("influence_events rejects UPDATE and DELETE (append-only)", async () => {
    const [user] = await db.insert(users).values({
      googleSubject: "sub-1", displayName: "TestUser", houseId: "flush",
    }).returning();
    const [throne] = await db.insert(thrones).values({
      name: "Test Throne", lat: 40.74, lng: -73.98, category: "cafe",
      amenities: { accessible: true, babyChanging: false, genderNeutral: true, freeAccess: true, open24h: false },
      addedBy: user.id,
    }).returning();
    const [ev] = await db.insert(influenceEvents).values({
      fiefId: "89aaaaaaaaaaaaa", houseId: "flush", userId: user.id,
      points: 10, reason: "rating", throneId: throne.id,
    }).returning();

    await expect(
      db.update(influenceEvents).set({ points: 999 }).where(eq(influenceEvents.id, ev.id))
    ).rejects.toThrow(/append-only/);
    await expect(
      db.delete(influenceEvents).where(eq(influenceEvents.id, ev.id))
    ).rejects.toThrow(/append-only/);
  });

  it("users.displayName is unique", async () => {
    await db.insert(users).values({ googleSubject: "a", displayName: "Dup", houseId: "flush" });
    await expect(
      db.insert(users).values({ googleSubject: "b", displayName: "Dup", houseId: "bidet" })
    ).rejects.toThrow();
  });
});
```

Run: `npm test` → Expected: schema tests pass against the Neon test branch.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: postgres schema, migrations, append-only influence ledger"
```

---

## Task 3: Characterization tests for the game math we're about to depend on

The server reuses `src/lib/selectors.ts` verbatim. Pin its behavior first so any future "optimization" that changes numbers fails loudly.

**Files:**
- Create: `src/lib/selectors.test.ts`

- [ ] **Step 1: Write the tests**

```ts
import { describe, expect, it } from "vitest";
import { fiefControl, lifetimeXp, rankForXp, throneScore } from "./selectors";
import type { InfluenceEvent, Rating } from "./types";

const DAY = 86_400_000;
const NOW = 1_750_000_000_000;

function rating(overrides: Partial<Rating>): Rating {
  return {
    id: "r1", throneId: "t1", authorName: "A", houseId: "flush",
    verdict: 3, tags: [], testimony: "", verified: true, createdAt: NOW,
    ...overrides,
  };
}

function event(overrides: Partial<InfluenceEvent>): InfluenceEvent {
  return {
    id: "i1", fiefId: "f1", houseId: "flush", points: 10,
    reason: "rating", throneId: "t1", authorName: "A", createdAt: NOW,
    ...overrides,
  };
}

describe("throneScore", () => {
  it("weights verified 3x hearsay", () => {
    const { score } = throneScore("t1", [
      rating({ id: "a", verdict: 5, verified: true }),
      rating({ id: "b", verdict: 1, verified: false }),
    ], NOW);
    // (3*5 + 1*1) / 4 = 4
    expect(score).toBeCloseTo(4.0, 5);
  });

  it("decays with a 60-day half-life", () => {
    const { score } = throneScore("t1", [
      rating({ id: "a", verdict: 5, createdAt: NOW - 60 * DAY }), // weight 1.5
      rating({ id: "b", verdict: 1, createdAt: NOW }),            // weight 3
    ], NOW);
    // (1.5*5 + 3*1) / 4.5 = 2.333...
    expect(score).toBeCloseTo(7 / 3, 5);
  });

  it("returns null with no ratings", () => {
    expect(throneScore("t1", [], NOW).score).toBeNull();
  });
});

describe("fiefControl", () => {
  it("decays influence 2%/day and picks the leader", () => {
    const control = fiefControl("f1", [
      event({ id: "a", houseId: "flush", points: 100, createdAt: NOW - 35 * DAY }),
      event({ id: "b", houseId: "bidet", points: 60, createdAt: NOW }),
    ], NOW);
    // flush: 100 * 0.98^35 ≈ 49.3 → bidet leads
    expect(control.leader?.houseId).toBe("bidet");
    expect(control.shares[0].influence).toBeCloseTo(60, 5);
    expect(control.shares[1].influence).toBeCloseTo(100 * Math.pow(0.98, 35), 5);
  });

  it("flags contested within 15%", () => {
    const control = fiefControl("f1", [
      event({ id: "a", houseId: "flush", points: 100 }),
      event({ id: "b", houseId: "bidet", points: 90 }),
    ], NOW);
    expect(control.contested).toBe(true);
  });

  it("is not contested at a 20% gap", () => {
    const control = fiefControl("f1", [
      event({ id: "a", houseId: "flush", points: 100 }),
      event({ id: "b", houseId: "bidet", points: 80 }),
    ], NOW);
    expect(control.contested).toBe(false);
  });
});

describe("ranks", () => {
  it("sums lifetime xp per author without decay", () => {
    const xp = lifetimeXp("A", [
      event({ id: "a", points: 10, createdAt: NOW - 400 * DAY }),
      event({ id: "b", points: 15 }),
      event({ id: "c", points: 99, authorName: "B" }),
    ]);
    expect(xp).toBe(25);
  });

  it("maps xp to ranks at documented floors", () => {
    expect(rankForXp(0).name).toBe("Peasant");
    expect(rankForXp(100).name).toBe("Squire");
    expect(rankForXp(299).name).toBe("Squire");
    expect(rankForXp(300).name).toBe("Knight");
    expect(rankForXp(12000).name).toBe("Grand Maester of the Privy Council");
    expect(rankForXp(12000).progress).toBe(1);
  });
});
```

- [ ] **Step 2: Run** — `npm test` → Expected: all pass (these characterize existing behavior; a failure means the test's arithmetic is wrong, not the code — fix the test).

- [ ] **Step 3: Commit**

```bash
git add src/lib/selectors.test.ts && git commit -m "test: characterize game math before server reuse"
```

---

## Task 4: Shared game rules module

Single source of truth for award amounts, tag vocabulary, and windows — used by server services and client UI.

**Files:**
- Create: `src/lib/game/rules.ts`
- Modify: `src/components/SittingFlow.tsx` (import tags from rules instead of a local list)

- [ ] **Step 1: Create `src/lib/game/rules.ts`**

First open `src/components/SittingFlow.tsx` and find its existing tag-chip list. **The strings in SittingFlow are canonical** (existing seed ratings reference them); use them verbatim in `RATING_TAGS`. The PRD §5.3 list is: Clean / Stocked / Smells like victory / Smells like defeat / Door lock broken / No soap (a war crime) / Hot water / Line too long / Needs a key / Hidden gem — SittingFlow's list should match; on any discrepancy, SittingFlow wins.

```ts
/** Server-enforced game rules. The client imports these for display only —
 * the server never trusts client-computed values. */

export const INFLUENCE = {
  verifiedRating: 10,
  hearsayRating: 2,
  firstOfNameBonus: 15,
  throneConfirmedAdderAward: 25, // to the adder, once a second user confirms (PRD §5.5)
  confirmAction: 3,              // to the confirming user (PRD §5.5 freshness check)
} as const;

export const RATING_TAGS = [
  "Clean",
  "Stocked",
  "Smells like victory",
  "Smells like defeat",
  "Door lock broken",
  "No soap (a war crime)",
  "Hot water",
  "Line too long",
  "Needs a key",
  "Hidden gem",
] as const;

export type RatingTag = (typeof RATING_TAGS)[number];

export const RATING_UPDATE_WINDOW_MS = 24 * 60 * 60 * 1000; // repeat within 24h updates, not stacks
export const HOUSE_SWITCH_WINDOW_MS = 56 * 24 * 60 * 60 * 1000; // stands in for the 8-week season
```

- [ ] **Step 2: Point `SittingFlow.tsx` at `RATING_TAGS`** — delete its local tag array, import from `@/lib/game/rules`. No behavior change.

- [ ] **Step 3: Verify** — `npm test && npm run build` → Expected: both pass. Manually confirm the tag chips still render in the dev app (`npm run dev`, open a throne, start a Sitting).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: shared game rules module (awards, tags, windows)"
```

---

## Task 5: Auth.js v5 — Google sign-in, session helper

**Files:**
- Create: `src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/types/next-auth.d.ts`, `src/lib/server/session.ts`
- Test: `src/test/session.test.ts`

- [ ] **Step 1: Create `src/auth.ts`**

```ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token, account }) {
      if (account?.providerAccountId) token.googleSubject = account.providerAccountId;
      return token;
    },
    session({ session, token }) {
      session.googleSubject = token.googleSubject as string | undefined;
      return session;
    },
  },
});
```

- [ ] **Step 2: Create `src/types/next-auth.d.ts`**

```ts
import "next-auth";

declare module "next-auth" {
  interface Session {
    googleSubject?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    googleSubject?: string;
  }
}
```

- [ ] **Step 3: Create `src/app/api/auth/[...nextauth]/route.ts`**

```ts
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 4: Create `src/lib/server/session.ts`**

```ts
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { users } from "@/db/schema";

export type SessionInfo =
  | { kind: "anonymous" }
  | { kind: "no_profile"; googleSubject: string }
  | { kind: "user"; user: typeof users.$inferSelect };

export async function sessionInfo(): Promise<SessionInfo> {
  const session = await auth();
  const sub = session?.googleSubject;
  if (!sub) return { kind: "anonymous" };
  const user = await db.query.users.findFirst({ where: eq(users.googleSubject, sub) });
  return user ? { kind: "user", user } : { kind: "no_profile", googleSubject: sub };
}
```

- [ ] **Step 5: Test `src/test/session.test.ts`** (mock `@/auth`; the same mock pattern is used by all route tests)

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/auth";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { sessionInfo } from "@/lib/server/session";
import { resetDb } from "./db";

const mockedAuth = vi.mocked(auth);

describe("sessionInfo", () => {
  beforeEach(async () => {
    await resetDb();
    mockedAuth.mockReset();
  });

  it("anonymous without a session", async () => {
    mockedAuth.mockResolvedValue(null as never);
    expect((await sessionInfo()).kind).toBe("anonymous");
  });

  it("no_profile when signed in but no user row", async () => {
    mockedAuth.mockResolvedValue({ googleSubject: "g-123" } as never);
    const info = await sessionInfo();
    expect(info).toEqual({ kind: "no_profile", googleSubject: "g-123" });
  });

  it("user when a profile exists", async () => {
    await db.insert(users).values({ googleSubject: "g-123", displayName: "Larry", houseId: "plunger" });
    mockedAuth.mockResolvedValue({ googleSubject: "g-123" } as never);
    const info = await sessionInfo();
    expect(info.kind).toBe("user");
  });
});
```

Run: `npm test` → Expected: pass. `npm run build` → Expected: pass (needs `AUTH_SECRET` in `.env.local`).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: Auth.js v5 Google sign-in with session-to-user resolution"
```

---

## Task 6: Server mappers + `GET /api/realm`

**Files:**
- Create: `src/lib/server/mappers.ts`, `src/lib/server/realm.ts`, `src/app/api/realm/route.ts`
- Test: `src/test/realm.test.ts`, plus shared fixture helper `src/test/fixtures.ts`

- [ ] **Step 1: Create `src/lib/server/mappers.ts`** — DB rows → the prototype's in-memory shapes so `selectors.ts` runs unchanged

```ts
import type { InfluenceEvent, Rating } from "@/lib/types";
import type { influenceEvents, ratings, users } from "@/db/schema";

type RatingRow = typeof ratings.$inferSelect;
type EventRow = typeof influenceEvents.$inferSelect;
type UserRow = typeof users.$inferSelect;

export function toGameRating(row: RatingRow, author: Pick<UserRow, "displayName" | "houseId">): Rating {
  return {
    id: row.id,
    throneId: row.throneId,
    authorName: author.displayName,
    houseId: author.houseId,
    verdict: row.verdict as Rating["verdict"],
    tags: row.tags,
    testimony: "",
    verified: row.verified,
    createdAt: row.createdAt.getTime(),
  };
}

/** authorName carries the user id server-side — selectors only use it as an
 * opaque grouping key (lifetimeXp), never for display. */
export function toGameEvent(row: EventRow): InfluenceEvent {
  return {
    id: row.id,
    fiefId: row.fiefId,
    houseId: row.houseId,
    points: row.points,
    reason: row.reason,
    throneId: row.throneId,
    authorName: row.userId,
    createdAt: row.createdAt.getTime(),
  };
}
```

- [ ] **Step 2: Create `src/lib/server/realm.ts`**

```ts
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { influenceEvents, ledgerEntries, ratings, thrones, users } from "@/db/schema";
import { fiefIdForCoords } from "@/lib/geo";
import { fiefControl, throneScore } from "@/lib/selectors";
import { toGameEvent, toGameRating } from "./mappers";

export async function realmPayload(now = Date.now()) {
  const [throneRows, ratingRows, eventRows, ledgerRows] = await Promise.all([
    db.select().from(thrones),
    db
      .select({ rating: ratings, displayName: users.displayName, houseId: users.houseId })
      .from(ratings)
      .innerJoin(users, eq(ratings.userId, users.id)),
    db.select().from(influenceEvents),
    db.select().from(ledgerEntries).orderBy(desc(ledgerEntries.createdAt)).limit(60),
  ]);

  const gameRatings = ratingRows.map((r) =>
    toGameRating(r.rating, { displayName: r.displayName, houseId: r.houseId })
  );
  const gameEvents = eventRows.map(toGameEvent);

  const throneDtos = throneRows.map((t) => {
    const { score, count } = throneScore(t.id, gameRatings, now);
    return {
      id: t.id,
      name: t.name,
      lat: t.lat,
      lng: t.lng,
      category: t.category,
      status: t.status,
      amenities: t.amenities,
      addedBy: t.addedBy,
      addedAt: t.addedAt.getTime(),
      lastConfirmedAt: t.lastConfirmedAt.getTime(),
      fiefId: fiefIdForCoords(t.lat, t.lng),
      score,
      ratingCount: count,
    };
  });

  const fiefIds = [...new Set(gameEvents.map((e) => e.fiefId))];
  const fiefs = fiefIds.map((id) => fiefControl(id, gameEvents, now));

  return {
    thrones: throneDtos,
    ratings: gameRatings,
    fiefs,
    ledger: ledgerRows.map((l) => ({ id: l.id, createdAt: l.createdAt.getTime(), text: l.text })),
  };
}

export type RealmPayload = Awaited<ReturnType<typeof realmPayload>>;
```

- [ ] **Step 3: Create `src/app/api/realm/route.ts`**

```ts
import { NextResponse } from "next/server";
import { realmPayload } from "@/lib/server/realm";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await realmPayload());
}
```

- [ ] **Step 4: Create `src/test/fixtures.ts`** — used by every service test from here on

```ts
import { db } from "@/db/client";
import { thrones, users } from "@/db/schema";

export async function makeUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const n = Math.random().toString(36).slice(2, 8);
  const [user] = await db.insert(users).values({
    googleSubject: `sub-${n}`,
    displayName: `User-${n}`,
    houseId: "flush",
    ...overrides,
  }).returning();
  return user;
}

export async function makeThrone(addedBy: string, overrides: Partial<typeof thrones.$inferInsert> = {}) {
  const [throne] = await db.insert(thrones).values({
    name: "Fixture Throne",
    lat: 40.746, lng: -73.9895,
    category: "cafe",
    status: "verified",
    amenities: { accessible: true, babyChanging: false, genderNeutral: true, freeAccess: true, open24h: false },
    addedBy,
    ...overrides,
  }).returning();
  return throne;
}
```

- [ ] **Step 5: Test `src/test/realm.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { influenceEvents, ratings } from "@/db/schema";
import { realmPayload } from "@/lib/server/realm";
import { fiefIdForCoords } from "@/lib/geo";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

describe("realmPayload", () => {
  beforeEach(resetDb);

  it("returns thrones with computed scores and fief control", async () => {
    const user = await makeUser({ houseId: "bidet" });
    const throne = await makeThrone(user.id);
    await db.insert(ratings).values({
      throneId: throne.id, userId: user.id, verdict: 4, tags: ["Clean"], verified: true,
    });
    const fiefId = fiefIdForCoords(throne.lat, throne.lng);
    await db.insert(influenceEvents).values({
      fiefId, houseId: "bidet", userId: user.id, points: 10, reason: "rating", throneId: throne.id,
    });

    const payload = await realmPayload();

    expect(payload.thrones).toHaveLength(1);
    expect(payload.thrones[0].score).toBeCloseTo(4, 5);
    expect(payload.thrones[0].fiefId).toBe(fiefId);
    expect(payload.ratings[0].authorName).toBe(user.displayName);
    expect(payload.fiefs).toHaveLength(1);
    expect(payload.fiefs[0].leader?.houseId).toBe("bidet");
  });

  it("returns empty collections on an empty realm", async () => {
    const payload = await realmPayload();
    expect(payload.thrones).toEqual([]);
    expect(payload.fiefs).toEqual([]);
  });
});
```

Run: `npm test` → Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: GET /api/realm with server-computed scores and fief control"
```

---

## Task 7: Profile endpoints — `POST /api/profile`, `GET /api/me`

**Files:**
- Create: `src/lib/server/profile.ts`, `src/app/api/profile/route.ts`, `src/app/api/me/route.ts`
- Test: `src/test/profile.test.ts`

- [ ] **Step 1: Create `src/lib/server/profile.ts`**

```ts
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { influenceEvents, ledgerEntries, users } from "@/db/schema";
import { HOUSE_BY_ID } from "@/lib/data";
import { HOUSE_SWITCH_WINDOW_MS } from "@/lib/game/rules";
import { lifetimeXp, rankForXp } from "@/lib/selectors";
import type { HouseId } from "@/lib/types";
import { toGameEvent } from "./mappers";

export class ProfileError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function createProfile(googleSubject: string, displayName: string, houseId: HouseId) {
  const existing = await db.query.users.findFirst({ where: eq(users.googleSubject, googleSubject) });
  if (existing) throw new ProfileError("profile already exists", 409);
  try {
    const [user] = await db.insert(users).values({ googleSubject, displayName, houseId }).returning();
    await db.insert(ledgerEntries).values({
      text: `**${displayName}** pledges the oath to **${HOUSE_BY_ID[houseId].name}**.`,
    });
    return user;
  } catch (e) {
    if (e instanceof Error && e.message.includes("users_display_name_unique")) {
      throw new ProfileError("that name is already sworn to another", 409);
    }
    throw e;
  }
}

export async function switchHouse(userId: string, houseId: HouseId, now = Date.now()) {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new ProfileError("no profile", 404);
  if (user.houseId === houseId) throw new ProfileError("already sworn to that house", 400);
  const last = user.lastHouseSwitchAt?.getTime() ?? null;
  if (last !== null && now - last < HOUSE_SWITCH_WINDOW_MS) {
    throw new ProfileError("oath already broken once this season", 429);
  }
  const [updated] = await db.update(users)
    .set({ houseId, lastHouseSwitchAt: new Date(now) })
    .where(eq(users.id, userId))
    .returning();
  await db.insert(ledgerEntries).values({
    text: `**${user.displayName}** breaks their oath and rides for **${HOUSE_BY_ID[houseId].name}**.`,
  });
  return updated;
}

export async function mePayload(userId: string) {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new ProfileError("no profile", 404);
  const events = await db.select().from(influenceEvents).where(eq(influenceEvents.userId, userId));
  const xp = lifetimeXp(userId, events.map(toGameEvent));
  return {
    profile: {
      name: user.displayName,
      houseId: user.houseId,
      joinedAt: user.joinedAt.getTime(),
      badges: user.badges,
      lastHouseSwitchAt: user.lastHouseSwitchAt?.getTime() ?? null,
    },
    rank: rankForXp(xp),
  };
}
```

- [ ] **Step 2: Create `src/app/api/me/route.ts`**

```ts
import { NextResponse } from "next/server";
import { sessionInfo } from "@/lib/server/session";
import { mePayload } from "@/lib/server/profile";

export const dynamic = "force-dynamic";

export async function GET() {
  const info = await sessionInfo();
  if (info.kind === "anonymous") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (info.kind === "no_profile") return NextResponse.json({ profile: null });
  return NextResponse.json(await mePayload(info.user.id));
}
```

- [ ] **Step 3: Create `src/app/api/profile/route.ts`**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { HOUSES } from "@/lib/data";
import { createProfile, ProfileError, switchHouse } from "@/lib/server/profile";
import { sessionInfo } from "@/lib/server/session";
import type { HouseId } from "@/lib/types";

const houseIds = HOUSES.map((h) => h.id) as [HouseId, ...HouseId[]];

const bodySchema = z.object({
  name: z.string().trim().min(2).max(24).optional(),
  houseId: z.enum(houseIds),
});

export async function POST(req: Request) {
  const info = await sessionInfo();
  if (info.kind === "anonymous") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  try {
    if (info.kind === "no_profile") {
      if (!parsed.data.name) return NextResponse.json({ error: "name required" }, { status: 400 });
      const user = await createProfile(info.googleSubject, parsed.data.name, parsed.data.houseId);
      return NextResponse.json({ ok: true, userId: user.id }, { status: 201 });
    }
    await switchHouse(info.user.id, parsed.data.houseId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ProfileError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 4: Test `src/test/profile.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createProfile, mePayload, ProfileError, switchHouse } from "@/lib/server/profile";
import { resetDb } from "./db";
import { makeUser } from "./fixtures";

const DAY = 86_400_000;

describe("profiles", () => {
  beforeEach(resetDb);

  it("creates a profile and rejects duplicate display names", async () => {
    await createProfile("g-1", "Larry", "plunger");
    await expect(createProfile("g-2", "Larry", "flush")).rejects.toThrow(ProfileError);
  });

  it("allows one house switch, blocks the second within 56 days", async () => {
    const user = await makeUser({ houseId: "flush" });
    const now = Date.now();
    await switchHouse(user.id, "bidet", now);
    await expect(switchHouse(user.id, "porcelain", now + DAY)).rejects.toThrow(/season/);
    // after the window, allowed again
    await expect(switchHouse(user.id, "porcelain", now + 57 * DAY)).resolves.toBeDefined();
  });

  it("mePayload reports rank from lifetime xp", async () => {
    const user = await makeUser();
    const me = await mePayload(user.id);
    expect(me.rank.name).toBe("Peasant");
    expect(me.profile.name).toBe(user.displayName);
  });
});
```

Run: `npm test` → Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: profile creation, house switching, GET /api/me"
```

---

## Task 8: `POST /api/ratings` — the Sitting

**Files:**
- Create: `src/lib/server/ratings.ts`, `src/app/api/ratings/route.ts`
- Test: `src/test/ratings.test.ts`

- [ ] **Step 1: Create `src/lib/server/ratings.ts`**

```ts
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { influenceEvents, ledgerEntries, ratings, thrones, users } from "@/db/schema";
import { HOUSE_BY_ID } from "@/lib/data";
import { fiefIdForCoords } from "@/lib/geo";
import { INFLUENCE, RATING_UPDATE_WINDOW_MS } from "@/lib/game/rules";
import { fiefControl } from "@/lib/selectors";
import { toGameEvent } from "./mappers";

export interface SubmitRatingInput {
  throneId: string;
  verdict: 1 | 2 | 3 | 4 | 5;
  tags: string[];
  verified: boolean;
}

type UserRow = typeof users.$inferSelect;

export class RatingError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function submitRating(user: UserRow, input: SubmitRatingInput, now = Date.now()) {
  return db.transaction(async (tx) => {
    const throne = await tx.query.thrones.findFirst({ where: eq(thrones.id, input.throneId) });
    if (!throne) throw new RatingError("no such throne", 404);

    const fiefId = fiefIdForCoords(throne.lat, throne.lng);

    // 24h window: a repeat visit updates the verdict, awards nothing.
    const [latest] = await tx.select().from(ratings)
      .where(and(eq(ratings.throneId, throne.id), eq(ratings.userId, user.id)))
      .orderBy(desc(ratings.createdAt)).limit(1);

    if (latest && now - latest.createdAt.getTime() < RATING_UPDATE_WINDOW_MS) {
      await tx.update(ratings)
        .set({ verdict: input.verdict, tags: input.tags, verified: input.verified })
        .where(eq(ratings.id, latest.id));
      return { updated: true as const, influence: 0, flipped: false, firstOfName: false };
    }

    const isFirstRating =
      (await tx.select({ id: ratings.id }).from(ratings).where(eq(ratings.throneId, throne.id)).limit(1))
        .length === 0;

    await tx.insert(ratings).values({
      throneId: throne.id, userId: user.id,
      verdict: input.verdict, tags: input.tags, verified: input.verified,
      createdAt: new Date(now),
    });

    const fiefEventRows = await tx.select().from(influenceEvents).where(eq(influenceEvents.fiefId, fiefId));
    const before = fiefControl(fiefId, fiefEventRows.map(toGameEvent), now);

    const base = input.verified ? INFLUENCE.verifiedRating : INFLUENCE.hearsayRating;
    const newEvents = [
      {
        fiefId, houseId: user.houseId, userId: user.id, points: base,
        reason: input.verified ? ("rating" as const) : ("hearsay" as const),
        throneId: throne.id, createdAt: new Date(now),
      },
      ...(isFirstRating
        ? [{
            fiefId, houseId: user.houseId, userId: user.id, points: INFLUENCE.firstOfNameBonus,
            reason: "first_of_name" as const, throneId: throne.id, createdAt: new Date(now),
          }]
        : []),
    ];
    const inserted = await tx.insert(influenceEvents).values(newEvents).returning();

    const after = fiefControl(fiefId, [...fiefEventRows, ...inserted].map(toGameEvent), now);
    const flipped = !!after.leader && (!before.leader || before.leader.houseId !== after.leader.houseId);
    const points = base + (isFirstRating ? INFLUENCE.firstOfNameBonus : 0);
    const houseName = HOUSE_BY_ID[user.houseId].name;

    const ledgerTexts: string[] = [];
    if (flipped && after.leader) {
      ledgerTexts.push(`🏰 **${HOUSE_BY_ID[after.leader.houseId].name}** has seized the Fief around **${throne.name}**!`);
    } else {
      ledgerTexts.push(`**${user.displayName}** struck a banner for **${houseName}** at **${throne.name}** (+${points} Influence).`);
    }

    let badges = user.badges;
    if (isFirstRating && !badges.includes("first_of_their_name")) {
      badges = [...badges, "first_of_their_name"];
      await tx.update(users).set({ badges }).where(eq(users.id, user.id));
      ledgerTexts.push(`🏅 **${user.displayName}** earns "First of Their Name" — first rating at **${throne.name}**.`);
    }

    await tx.insert(ledgerEntries).values(ledgerTexts.map((text) => ({ text, createdAt: new Date(now) })));
    await tx.update(thrones).set({ lastConfirmedAt: new Date(now) }).where(eq(thrones.id, throne.id));

    return { updated: false as const, influence: points, flipped, firstOfName: isFirstRating, fief: after };
  });
}
```

- [ ] **Step 2: Create `src/app/api/ratings/route.ts`**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { RATING_TAGS } from "@/lib/game/rules";
import { RatingError, submitRating } from "@/lib/server/ratings";
import { sessionInfo } from "@/lib/server/session";

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
    const result = await submitRating(info.user, {
      ...parsed.data,
      verdict: parsed.data.verdict as 1 | 2 | 3 | 4 | 5,
    });
    return NextResponse.json(result, { status: result.updated ? 200 : 201 });
  } catch (e) {
    if (e instanceof RatingError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 3: Test `src/test/ratings.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { influenceEvents, ratings, users } from "@/db/schema";
import { submitRating } from "@/lib/server/ratings";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

const HOUR = 3_600_000;

describe("submitRating", () => {
  beforeEach(resetDb);

  it("awards 10+15 for a first verified rating and grants the badge", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const result = await submitRating(user, { throneId: throne.id, verdict: 5, tags: ["Clean"], verified: true });

    expect(result).toMatchObject({ influence: 25, firstOfName: true, updated: false });
    const events = await db.select().from(influenceEvents);
    expect(events.map((e) => e.points).sort()).toEqual([10, 15]);
    const [refreshed] = await db.select().from(users).where(eq(users.id, user.id));
    expect(refreshed.badges).toContain("first_of_their_name");
  });

  it("awards 2 for hearsay, no first bonus after someone else rated", async () => {
    const alice = await makeUser();
    const bob = await makeUser({ houseId: "bidet" });
    const throne = await makeThrone(alice.id);
    await submitRating(alice, { throneId: throne.id, verdict: 4, tags: [], verified: true });
    const result = await submitRating(bob, { throneId: throne.id, verdict: 2, tags: [], verified: false });
    expect(result.influence).toBe(2);
    expect(result.firstOfName).toBe(false);
  });

  it("a repeat within 24h updates the rating and awards nothing", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const t0 = Date.now();
    await submitRating(user, { throneId: throne.id, verdict: 5, tags: [], verified: true }, t0);
    const result = await submitRating(user, { throneId: throne.id, verdict: 1, tags: [], verified: true }, t0 + HOUR);

    expect(result.updated).toBe(true);
    expect(result.influence).toBe(0);
    const rows = await db.select().from(ratings);
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe(1);
  });

  it("a repeat after 24h stacks a new rating with influence", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const t0 = Date.now();
    await submitRating(user, { throneId: throne.id, verdict: 5, tags: [], verified: true }, t0);
    const result = await submitRating(user, { throneId: throne.id, verdict: 4, tags: [], verified: true }, t0 + 25 * HOUR);

    expect(result.updated).toBe(false);
    expect(result.influence).toBe(10);
    expect(await db.select().from(ratings)).toHaveLength(2);
  });

  it("detects a fief flip", async () => {
    const alice = await makeUser({ houseId: "flush" });
    const bob = await makeUser({ houseId: "bidet" });
    const throne = await makeThrone(alice.id);
    const t0 = Date.now();
    await submitRating(alice, { throneId: throne.id, verdict: 3, tags: [], verified: false }, t0); // 2+15=17 flush
    const result = await submitRating(bob, { throneId: throne.id, verdict: 3, tags: [], verified: true }, t0 + HOUR); // 10 bidet — no flip
    expect(result.flipped).toBe(false);

    const carol = await makeUser({ houseId: "bidet", displayName: `Carol-${Math.random().toString(36).slice(2, 8)}` });
    const flip = await submitRating(carol, { throneId: throne.id, verdict: 3, tags: [], verified: true }, t0 + 2 * HOUR); // bidet 20 > 17
    expect(flip.flipped).toBe(true);
  });

  it("404s on an unknown throne", async () => {
    const user = await makeUser();
    await expect(
      submitRating(user, { throneId: "00000000-0000-0000-0000-000000000000", verdict: 3, tags: [], verified: true })
    ).rejects.toThrow(/no such throne/);
  });
});
```

Run: `npm test` → Expected: pass.

- [ ] **Step 4: Route-level authz test** — append to `src/test/ratings.test.ts`:

```ts
import { vi } from "vitest";
vi.mock("@/auth", () => ({ auth: vi.fn() }));
import { auth } from "@/auth";
import { POST as ratingsPOST } from "@/app/api/ratings/route";

describe("POST /api/ratings authz", () => {
  it("401s without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const res = await ratingsPOST(new Request("http://test/api/ratings", {
      method: "POST",
      body: JSON.stringify({ throneId: "00000000-0000-0000-0000-000000000000", verdict: 3, tags: [], verified: true }),
    }));
    expect(res.status).toBe(401);
  });
});
```

Run: `npm test` → Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: POST /api/ratings with influence, badges, flip detection"
```

---

## Task 9: Thrones — `POST /api/thrones`, `POST /api/thrones/[id]/confirm`

**Files:**
- Create: `src/lib/server/thrones.ts`, `src/app/api/thrones/route.ts`, `src/app/api/thrones/[id]/confirm/route.ts`
- Test: `src/test/thrones.test.ts`

- [ ] **Step 1: Create `src/lib/server/thrones.ts`**

```ts
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { influenceEvents, ledgerEntries, thrones, users } from "@/db/schema";
import { HOUSE_BY_ID } from "@/lib/data";
import { fiefIdForCoords } from "@/lib/geo";
import { INFLUENCE } from "@/lib/game/rules";
import type { Amenities, ThroneCategory } from "@/lib/types";

type UserRow = typeof users.$inferSelect;

export class ThroneError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function addThrone(
  user: UserRow,
  input: { name: string; lat: number; lng: number; category: ThroneCategory; amenities: Amenities },
  now = Date.now()
) {
  return db.transaction(async (tx) => {
    const [throne] = await tx.insert(thrones).values({
      name: input.name, lat: input.lat, lng: input.lng,
      category: input.category, amenities: input.amenities,
      status: "rumored", addedBy: user.id,
      addedAt: new Date(now), lastConfirmedAt: new Date(now),
    }).returning();

    if (!user.badges.includes("cartographer")) {
      await tx.update(users).set({ badges: [...user.badges, "cartographer"] }).where(eq(users.id, user.id));
    }
    await tx.insert(ledgerEntries).values({
      text: `📜 **${user.displayName}** charts a new throne — **${throne.name}** enters the Realm as *Rumored*.`,
      createdAt: new Date(now),
    });
    return throne;
  });
}

export async function confirmThrone(confirmer: UserRow, throneId: string, now = Date.now()) {
  return db.transaction(async (tx) => {
    const throne = await tx.query.thrones.findFirst({ where: eq(thrones.id, throneId) });
    if (!throne) throw new ThroneError("no such throne", 404);
    if (throne.status === "verified") throw new ThroneError("already confirmed", 409);
    if (throne.addedBy === confirmer.id) {
      throw new ThroneError("a throne cannot vouch for itself — a second traveler must confirm it", 403);
    }

    const adder = await tx.query.users.findFirst({ where: eq(users.id, throne.addedBy) });
    if (!adder) throw new ThroneError("adder no longer exists", 500);

    const fiefId = fiefIdForCoords(throne.lat, throne.lng);
    await tx.insert(influenceEvents).values([
      { // PRD §5.5: adding a throne pays out once confirmed — to the adder
        fiefId, houseId: adder.houseId, userId: adder.id,
        points: INFLUENCE.throneConfirmedAdderAward, reason: "new_throne",
        throneId: throne.id, createdAt: new Date(now),
      },
      { // PRD §5.5: the confirmation itself is a freshness check — to the confirmer
        fiefId, houseId: confirmer.houseId, userId: confirmer.id,
        points: INFLUENCE.confirmAction, reason: "confirmation",
        throneId: throne.id, createdAt: new Date(now),
      },
    ]);

    const [updated] = await tx.update(thrones)
      .set({ status: "verified", lastConfirmedAt: new Date(now) })
      .where(eq(thrones.id, throne.id)).returning();

    await tx.insert(ledgerEntries).values({
      text: `✅ **${confirmer.displayName}** confirms **${throne.name}** is real — it enters the Realm's official record (+${INFLUENCE.throneConfirmedAdderAward} Influence to **${HOUSE_BY_ID[adder.houseId].name}**).`,
      createdAt: new Date(now),
    });
    return updated;
  });
}
```

- [ ] **Step 2: Create `src/app/api/thrones/route.ts`**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { addThrone } from "@/lib/server/thrones";
import { sessionInfo } from "@/lib/server/session";

const bodySchema = z.object({
  name: z.string().trim().min(2).max(80),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  category: z.enum(["cafe", "restaurant", "park", "transit", "library", "retail", "municipal", "gas_station", "other"]),
  amenities: z.object({
    accessible: z.boolean(), babyChanging: z.boolean(), genderNeutral: z.boolean(),
    freeAccess: z.boolean(), open24h: z.boolean(),
  }),
});

export async function POST(req: Request) {
  const info = await sessionInfo();
  if (info.kind !== "user") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const throne = await addThrone(info.user, parsed.data);
  return NextResponse.json({ ok: true, throneId: throne.id }, { status: 201 });
}
```

- [ ] **Step 3: Create `src/app/api/thrones/[id]/confirm/route.ts`**

```ts
import { NextResponse } from "next/server";
import { confirmThrone, ThroneError } from "@/lib/server/thrones";
import { sessionInfo } from "@/lib/server/session";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const info = await sessionInfo();
  if (info.kind !== "user") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const throne = await confirmThrone(info.user, id);
    return NextResponse.json({ ok: true, status: throne.status });
  } catch (e) {
    if (e instanceof ThroneError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 4: Test `src/test/thrones.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { influenceEvents } from "@/db/schema";
import { addThrone, confirmThrone, ThroneError } from "@/lib/server/thrones";
import { resetDb } from "./db";
import { makeUser } from "./fixtures";

const AMENITIES = { accessible: false, babyChanging: false, genderNeutral: false, freeAccess: true, open24h: false };

describe("thrones", () => {
  beforeEach(resetDb);

  it("addThrone creates a rumored throne and grants no influence yet", async () => {
    const user = await makeUser();
    const throne = await addThrone(user, { name: "New Privy", lat: 40.75, lng: -73.99, category: "park", amenities: AMENITIES });
    expect(throne.status).toBe("rumored");
    expect(await db.select().from(influenceEvents)).toHaveLength(0);
  });

  it("the adder cannot confirm their own throne", async () => {
    const user = await makeUser();
    const throne = await addThrone(user, { name: "Selfie Privy", lat: 40.75, lng: -73.99, category: "park", amenities: AMENITIES });
    await expect(confirmThrone(user, throne.id)).rejects.toThrow(ThroneError);
    await expect(confirmThrone(user, throne.id)).rejects.toThrow(/second traveler/);
  });

  it("a second user confirms: verified, 25 to adder's house, 3 to confirmer", async () => {
    const adder = await makeUser({ houseId: "flush" });
    const confirmer = await makeUser({ houseId: "bidet" });
    const throne = await addThrone(adder, { name: "Real Privy", lat: 40.75, lng: -73.99, category: "transit", amenities: AMENITIES });

    const updated = await confirmThrone(confirmer, throne.id);
    expect(updated.status).toBe("verified");

    const events = await db.select().from(influenceEvents);
    const byReason = Object.fromEntries(events.map((e) => [e.reason, e]));
    expect(byReason.new_throne).toMatchObject({ points: 25, houseId: "flush", userId: adder.id });
    expect(byReason.confirmation).toMatchObject({ points: 3, houseId: "bidet", userId: confirmer.id });
  });

  it("confirming twice 409s", async () => {
    const adder = await makeUser();
    const c1 = await makeUser();
    const c2 = await makeUser();
    const throne = await addThrone(adder, { name: "Popular Privy", lat: 40.75, lng: -73.99, category: "cafe", amenities: AMENITIES });
    await confirmThrone(c1, throne.id);
    await expect(confirmThrone(c2, throne.id)).rejects.toThrow(/already confirmed/);
  });
});
```

Run: `npm test` → Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add-a-throne and second-user confirmation endpoints"
```

---

## Task 10: Seed script

**Files:**
- Create: `src/db/seed.ts`

- [ ] **Step 1: Write `src/db/seed.ts`** — ports `src/lib/data.ts` seed content. Seed authors become users with `googleSubject = "seed:<name>"` (they can never sign in — Google subjects are numeric). Old string ids are remapped to generated uuids via lookup maps.

```ts
import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  // Imports deferred until after env is loaded, because db/client reads DATABASE_URL at import time.
  const { db, pool } = await import("./client");
  const { influenceEvents, ledgerEntries, ratings, thrones, users } = await import("./schema");
  const { SEED_INFLUENCE, SEED_LEDGER, SEED_RATINGS, SEED_THRONES } = await import("../lib/data");
  const { fiefIdForCoords } = await import("../lib/geo");

  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) {
    console.log("Database not empty — refusing to seed. Truncate manually if you really mean it.");
    return;
  }

  // 1. Users from every distinct authorName in the seed data
  const authorHouse = new Map<string, string>();
  for (const r of SEED_RATINGS) authorHouse.set(r.authorName, r.houseId);
  for (const e of SEED_INFLUENCE) if (!authorHouse.has(e.authorName)) authorHouse.set(e.authorName, e.houseId);
  for (const t of SEED_THRONES) if (!authorHouse.has(t.addedBy)) authorHouse.set(t.addedBy, "flush");

  const userIdByName = new Map<string, string>();
  for (const [name, houseId] of authorHouse) {
    const [u] = await db.insert(users).values({
      googleSubject: `seed:${name}`,
      displayName: name,
      houseId: houseId as "flush" | "bidet" | "plunger" | "porcelain",
    }).returning();
    userIdByName.set(name, u.id);
  }

  // 2. Thrones (old string id → new uuid)
  const throneIdByOldId = new Map<string, string>();
  for (const t of SEED_THRONES) {
    const [row] = await db.insert(thrones).values({
      name: t.name, lat: t.lat, lng: t.lng, category: t.category, status: t.status,
      amenities: t.amenities, addedBy: userIdByName.get(t.addedBy)!,
      addedAt: new Date(t.addedAt), lastConfirmedAt: new Date(t.lastConfirmedAt),
    }).returning();
    throneIdByOldId.set(t.id, row.id);
  }

  // 3. Ratings
  for (const r of SEED_RATINGS) {
    await db.insert(ratings).values({
      throneId: throneIdByOldId.get(r.throneId)!,
      userId: userIdByName.get(r.authorName)!,
      verdict: r.verdict, tags: r.tags, verified: r.verified,
      createdAt: new Date(r.createdAt),
    });
  }

  // 4. Influence events (recompute fiefId from the throne so geo stays consistent)
  for (const e of SEED_INFLUENCE) {
    const seedThrone = SEED_THRONES.find((t) => t.id === e.throneId)!;
    await db.insert(influenceEvents).values({
      fiefId: fiefIdForCoords(seedThrone.lat, seedThrone.lng),
      houseId: e.houseId,
      userId: userIdByName.get(e.authorName)!,
      points: e.points, reason: e.reason,
      throneId: throneIdByOldId.get(e.throneId)!,
      createdAt: new Date(e.createdAt),
    });
  }

  // 5. Ledger
  for (const l of SEED_LEDGER) {
    await db.insert(ledgerEntries).values({ text: l.text, createdAt: new Date(l.createdAt) });
  }

  console.log(
    `Seeded ${userIdByName.size} users, ${throneIdByOldId.size} thrones, ${SEED_RATINGS.length} ratings, ${SEED_INFLUENCE.length} influence events.`
  );
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Note: if `SEED_THRONES`/`SEED_RATINGS` field names differ from the above (check `src/lib/data.ts` first), adapt the property accesses — the shapes in `src/lib/types.ts` are the contract.

- [ ] **Step 2: Run against dev branch** — `npm run db:seed` → Expected: "Seeded N users, M thrones, …". Run again → Expected: refuses (idempotence guard).

- [ ] **Step 3: Verify via API** — `npm run dev`, then `curl http://localhost:3000/api/realm` → Expected: JSON with the seeded thrones, non-null scores, and fiefs with a leader.

- [ ] **Step 4: Commit**

```bash
git add src/db/seed.ts && git commit -m "feat: seed script porting prototype demo data to postgres"
```

---

## Task 11: Client — API-backed store (same interface)

**Files:**
- Create: `src/lib/api.ts` (fetch wrapper + payload types)
- Rewrite: `src/lib/store.tsx` (same exported interface, API-backed)

- [ ] **Step 1: Create `src/lib/api.ts`**

```ts
import type { FiefControl, RankInfo } from "./selectors";
import type { Amenities, HouseId, LedgerEntry, Rating, ThroneCategory } from "./types";

export interface ThroneDTO {
  id: string; name: string; lat: number; lng: number;
  category: ThroneCategory; status: "rumored" | "verified";
  amenities: Amenities; addedBy: string; addedAt: number; lastConfirmedAt: number;
  fiefId: string; score: number | null; ratingCount: number;
}

export interface RealmDTO {
  thrones: ThroneDTO[];
  ratings: Rating[];
  fiefs: FiefControl[];
  ledger: LedgerEntry[];
}

export interface MeDTO {
  profile: {
    name: string; houseId: HouseId; joinedAt: number;
    badges: string[]; lastHouseSwitchAt: number | null;
  } | null;
  rank?: RankInfo;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `request failed (${res.status})`, res.status);
  }
  return res.json();
}

export const api = {
  realm: () => request<RealmDTO>("/api/realm"),
  me: () => request<MeDTO>("/api/me"),
  createProfile: (name: string, houseId: HouseId) =>
    request<{ ok: true }>("/api/profile", { method: "POST", body: JSON.stringify({ name, houseId }) }),
  switchHouse: (houseId: HouseId) =>
    request<{ ok: true }>("/api/profile", { method: "POST", body: JSON.stringify({ houseId }) }),
  submitRating: (input: { throneId: string; verdict: number; tags: string[]; verified: boolean }) =>
    request<{ updated: boolean; influence: number; flipped: boolean }>("/api/ratings", {
      method: "POST", body: JSON.stringify(input),
    }),
  addThrone: (input: { name: string; lat: number; lng: number; category: ThroneCategory; amenities: Amenities }) =>
    request<{ ok: true; throneId: string }>("/api/thrones", { method: "POST", body: JSON.stringify(input) }),
  confirmThrone: (throneId: string) =>
    request<{ ok: true }>(`/api/thrones/${throneId}/confirm`, { method: "POST" }),
};
```

`/api/me` returning 401 means anonymous — the store treats `ApiError` with status 401 as "not signed in", not a failure.

- [ ] **Step 2: Rewrite `src/lib/store.tsx`**

Keep the exported names exactly: `StoreProvider`, `useStore`, and the context value shape `{ state, setProfile, switchHouse, submitRating, addThrone, confirmThrone }`. New internals:

```tsx
"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { api, ApiError, type MeDTO, type RealmDTO } from "./api";
import type { Amenities, HouseId, ThroneCategory } from "./types";

export type AuthStatus = "loading" | "anonymous" | "needs_profile" | "ready";

export interface StoreState {
  authStatus: AuthStatus;
  profile: MeDTO["profile"];
  rank: MeDTO["rank"] | null;
  realm: RealmDTO | null;
  error: string | null;
}

const POLL_MS = 30_000;

interface StoreContextValue {
  state: StoreState;
  refresh: () => Promise<void>;
  setProfile: (name: string, houseId: HouseId) => Promise<void>;
  switchHouse: (houseId: HouseId) => Promise<void>;
  submitRating: (input: { throneId: string; verdict: 1 | 2 | 3 | 4 | 5; tags: string[]; testimony: string; verified: boolean }) => Promise<void>;
  addThrone: (input: { name: string; lat: number; lng: number; category: ThroneCategory; amenities: Amenities }) => Promise<void>;
  confirmThrone: (throneId: string) => Promise<void>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<StoreState>({
    authStatus: "loading", profile: null, rank: null, realm: null, error: null,
  });
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const [realm, me] = await Promise.all([
        api.realm(),
        api.me().catch((e) => {
          if (e instanceof ApiError && e.status === 401) return null;
          throw e;
        }),
      ]);
      setState({
        realm,
        profile: me?.profile ?? null,
        rank: me?.rank ?? null,
        authStatus: me === null ? "anonymous" : me.profile === null ? "needs_profile" : "ready",
        error: null,
      });
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : "the ravens were lost" }));
    } finally {
      refreshing.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
    };
  }, [refresh]);

  const mutate = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } finally {
        await refresh();
      }
    },
    [refresh]
  );

  const value = useMemo<StoreContextValue>(
    () => ({
      state,
      refresh,
      setProfile: (name, houseId) => mutate(() => api.createProfile(name, houseId)),
      switchHouse: (houseId) => mutate(() => api.switchHouse(houseId)),
      submitRating: ({ testimony: _ignored, ...input }) => mutate(() => api.submitRating(input)),
      addThrone: (input) => mutate(() => api.addThrone(input)),
      confirmThrone: (throneId) => mutate(() => api.confirmThrone(throneId)),
    }),
    [state, refresh, mutate]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
```

Notes for the executor:
- `StoreState` changed shape (`realm.thrones` instead of `thrones` etc.) — Task 12 updates the components. Do Task 11 + 12 in one working session; commit only when the build is green again.
- The old localStorage persistence is deleted entirely.
- Optimistic influence animation: `SittingFlow` shows its animation from the `submitRating` promise resolution; the API responds in ~100–300 ms which preserves the dopamine moment without local math. (True optimistic local state can come later if the delay feels bad — keep this phase simple.)

- [ ] **Step 3: Typecheck to enumerate breakage** — Run: `npx tsc --noEmit` → Expected: errors ONLY in `src/components/*` (the Task 12 worklist). No commit yet.

---

## Task 12: Client — components consume the API store; auth UI; testimony removed

**Files:**
- Modify: every component `npx tsc --noEmit` flagged in Task 11 Step 3 — expected: `RealmMap.tsx`, `ThroneSheet.tsx`, `SittingFlow.tsx`, `AddThroneFlow.tsx`, `NearestWorthyButton.tsx`, `Onboarding.tsx`, `ProfilePanel.tsx`, `Ledger.tsx`, `TabBar.tsx`, `page.tsx`
- Create: `src/components/SignInGate.tsx`

Read each component before editing; the transformations are mechanical:

- [ ] **Step 1: Data-source swaps in all components**

| Old (computed client-side) | New (from store) |
|---|---|
| `state.thrones` | `state.realm?.thrones ?? []` |
| `state.ratings` | `state.realm?.ratings ?? []` |
| `state.ledger` | `state.realm?.ledger ?? []` |
| `throneScore(t.id, state.ratings, now)` | `throne.score` / `throne.ratingCount` (already on the DTO) |
| `fiefControl(fiefId, state.influenceEvents, now)` | `state.realm?.fiefs.find((f) => f.fiefId === fiefId)` |
| `fiefIdForCoords(t.lat, t.lng)` | `throne.fiefId` (already on the DTO) |
| `lifetimeXp(...)` + `rankForXp(...)` | `state.rank` (from `/api/me`) |
| `state.profile.name/houseId/badges` | same fields, now from `MeDTO["profile"]` |

`scoreBand()` and `fiefBoundary()` are presentation helpers — they stay client-side and unchanged.

- [ ] **Step 2: Create `src/components/SignInGate.tsx`** and wire into `Onboarding.tsx`

```tsx
"use client";

import { signIn } from "next-auth/react";

/** Shown when authStatus === "anonymous" and the user tries to act. */
export function SignInGate() {
  return (
    <div className="sign-in-gate">
      <p>Only sworn subjects may act in the Realm.</p>
      <button type="button" onClick={() => signIn("google")}>
        Pledge your oath — Sign in with Google
      </button>
    </div>
  );
}
```

Onboarding flow becomes: `authStatus === "anonymous"` → SignInGate; `"needs_profile"` → existing name + house selection screens (submit now awaits `setProfile` and surfaces `ApiError` 409 as "that name is already sworn to another"); `"ready"` → app. Anonymous users can still browse the map (PRD: Wandering Peasant) — the gate appears only on write actions (rate, add, confirm) and in the profile tab. Match the existing Onboarding styling patterns.

- [ ] **Step 3: `SittingFlow.tsx`** — remove the testimony textarea step entirely (structured-only phase); keep passing `testimony: ""` to `submitRating` (the store strips it). The influence animation now triggers after the `submitRating` promise resolves; on `ApiError` show its message in the flow's existing error/status styling.

- [ ] **Step 4: Anonymous read check** — with `authStatus === "anonymous"`, map/thrones/ledger render fine; rate/add/confirm surfaces SignInGate instead of the flow.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` → Expected: clean.
Run: `npm test && npm run build` → Expected: pass.
Manual (requires Google OAuth env vars): `npm run dev` — browse anonymously, sign in, create profile, rate a seeded throne, watch influence + ledger update, confirm a rumored throne added by a *different* account fails/succeeds per the rule.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: client runs against the API — auth gate, server-computed realm"
```

---

## Task 13: Deployment — retire GitHub Pages, deploy to Vercel

**Files:**
- Modify: `next.config.ts`, `README.md`
- Delete: `.github/workflows/deploy-pages.yml`

- [ ] **Step 1: Rewrite `next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```

(Drops `output: "export"`, `basePath`, and `images.unoptimized` — the app now needs a server. Check for hardcoded `/shame-of-thrones` basePath references: `grep -r "shame-of-thrones" src/` → Expected: no path-related hits.)

- [ ] **Step 2: Delete the Pages workflow**

```bash
git rm .github/workflows/deploy-pages.yml
```

- [ ] **Step 3: Update `README.md`** — replace the GitHub Pages live-URL section with the Vercel URL (placeholder until Step 5 provides it), and add a "Running locally" section: copy `.env.example` → `.env.local`, `npm run db:migrate`, `npm run db:seed`, `npm run dev`.

- [ ] **Step 4: Verify locally** — `npm run build && npm test` → Expected: pass.

- [ ] **Step 5 (HUMAN — Larry):** create the Vercel project (import the GitHub repo), set env vars `DATABASE_URL` (Neon dev branch — or a dedicated `production` branch), `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and add `https://<project>.vercel.app/api/auth/callback/google` to the Google OAuth client's redirect URIs. Deploy. **Per Larry's global rules: no production deploy without his explicit confirmation in-conversation.**

- [ ] **Step 6: Post-deploy smoke test** — on the Vercel URL: anonymous map loads seeded thrones; Google sign-in round-trips; a rating lands and appears for a second signed-in account (or an incognito anonymous view of the updated score/ledger).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: retire GitHub Pages export; app now deploys to Vercel"
```

---

## Post-plan cleanup checklist (same PR, after Task 13)

- [ ] Delete now-unused client code paths: localStorage constants, `SEED_*` imports in `store.tsx` (seed data itself stays — `src/db/seed.ts` uses it), and the old `StoreState` interface in `src/lib/types.ts` (Task 11 defines the new one in `store.tsx`).
- [ ] `ROADMAP.md`: check off completed Phase 0 items; note Redis and season rollover were deliberately deferred (spec).
- [ ] Confirm `selectors.ts` client imports are limited to types + `scoreBand` (game math now server-only at runtime).
