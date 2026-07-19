# Phase 6 · Milestone 1a — Cosmetics Foundation (core + server + web) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the monetization backbone — a cosmetics catalog, a server-authoritative entitlement store fed by the RevenueCat webhook, an ownership-gated equip API, and a working web buy-flow surrogate (moderator grant → user equips → premium Banner renders on their Profile).

**Architecture:** Three layers mirror the existing app. `@sot/core` holds the pure cosmetics catalog + equip logic (vitest). `apps/web` owns the source of truth: an `entitlements` table (migration `0010`), a RevenueCat webhook that idempotently grants entitlements, a moderator grant route, an ownership-gated equip route, and `mePayload` extended with `{ owned, equipped }`. The web client renders the equipped Banner style and ships a Treasury store screen (gallery + equip; purchase-in-app for later).

**Tech Stack:** TypeScript, Drizzle ORM + Postgres (Neon), Next.js App Router route handlers, RevenueCat webhooks, vitest, React (web).

**Scope note:** This is Milestone **1a**. The **mobile RevenueCat SDK purchase UI** and the additional banner render surfaces (Standings row, ThroneSheet list, rating-strike) are **Milestone 1b**, gated on the owner deps in the spec §9 (RevenueCat project + store products). Spec: [`docs/superpowers/specs/2026-07-19-phase6-monetization-design.md`](../specs/2026-07-19-phase6-monetization-design.md).

**Conventions this plan follows (from the codebase):**
- Pure logic in `packages/core/src/*.ts`, exported via `packages/core/src/index.ts`, tested with vitest next to the source.
- Server route handlers under `apps/web/src/app/api/**/route.ts`, auth via `sessionInfo()`, `export const dynamic = "force-dynamic"`.
- Server-only DB helpers under `apps/web/src/lib/server/*.ts`.
- Integration tests under `apps/web/src/test/*.test.ts` using `resetDb` + `makeUser` fixtures against the `.env.test` Neon branch.
- Health gate: `npm run check` (root) = `npm run test --workspaces` + `build:web`.

---

## Part A — `@sot/core` cosmetics catalog & equip logic

### Task 1: Cosmetics catalog + pure helpers

**Files:**
- Create: `packages/core/src/cosmetics.ts`
- Test: `packages/core/src/cosmetics.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/src/cosmetics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  COSMETICS,
  cosmeticBySku,
  ownedCosmetics,
  equippedFor,
  canEquip,
  normalizeEquipped,
  type Equipped,
} from "./cosmetics";

describe("cosmetics catalog", () => {
  it("every catalog entry is a well-formed cosmetic with a unique sku", () => {
    const seen = new Set<string>();
    for (const c of COSMETICS) {
      expect(c.sku).toMatch(/^[a-z]+\.[a-z0-9]+$/);
      expect(c.priceUsd).toBeGreaterThanOrEqual(0);
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.art.length).toBeGreaterThan(0);
      expect(seen.has(c.sku)).toBe(false);
      seen.add(c.sku);
    }
  });

  it("M1 ships only banner_style SKUs", () => {
    expect(COSMETICS.length).toBeGreaterThan(0);
    for (const c of COSMETICS) expect(c.category).toBe("banner_style");
  });

  it("cosmeticBySku resolves known and unknown skus", () => {
    expect(cosmeticBySku(COSMETICS[0].sku)?.sku).toBe(COSMETICS[0].sku);
    expect(cosmeticBySku("banner.nope")).toBeUndefined();
  });
});

describe("ownership & equip helpers", () => {
  const a = COSMETICS[0].sku;

  it("ownedCosmetics maps entitlement skus to catalog entries, dropping unknowns", () => {
    const owned = ownedCosmetics([a, "banner.ghost"]);
    expect(owned.map((c) => c.sku)).toEqual([a]);
  });

  it("canEquip requires the sku to exist AND be owned", () => {
    expect(canEquip(a, [a])).toBe(true);
    expect(canEquip(a, [])).toBe(false);
    expect(canEquip("banner.ghost", ["banner.ghost"])).toBe(false);
  });

  it("equippedFor returns the equipped cosmetic for a slot", () => {
    const eq: Equipped = { banner_style: a };
    expect(equippedFor(eq, "banner_style")?.sku).toBe(a);
    expect(equippedFor({}, "banner_style")).toBeUndefined();
  });

  it("normalizeEquipped drops unowned, unknown, and category-mismatched entries", () => {
    expect(normalizeEquipped({ banner_style: a }, [a])).toEqual({ banner_style: a });
    expect(normalizeEquipped({ banner_style: a }, [])).toEqual({});
    expect(normalizeEquipped({ banner_style: "banner.ghost" }, ["banner.ghost"])).toEqual({});
    // sku belongs to banner_style but is filed under the wrong slot -> dropped
    expect(normalizeEquipped({ map_theme: a }, [a])).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace packages/core -- cosmetics`
Expected: FAIL — `Cannot find module './cosmetics'`.

- [ ] **Step 3: Write minimal implementation**

`packages/core/src/cosmetics.ts`:

```ts
export type CosmeticCategory =
  | "banner_style"
  | "map_theme"
  | "profile_sigil"
  | "rating_stamp";

export interface Cosmetic {
  /** Stable id, e.g. "banner.dragonscale". Never reused. */
  sku: string;
  category: CosmeticCategory;
  name: string;
  description: string;
  /** Display price in USD. The store is the source of truth for the charged amount. */
  priceUsd: number;
  /** Render token each client maps to a concrete banner treatment. */
  art: string;
}

/** M1 catalog: banner styles only. Other categories are scaffolded via the
 * CosmeticCategory type but ship no purchasable SKUs yet (spec §8). */
export const COSMETICS: Cosmetic[] = [
  {
    sku: "banner.dragonscale",
    category: "banner_style",
    name: "Dragonscale Banner",
    description: "Scaled hide that catches the torchlight.",
    priceUsd: 2.99,
    art: "dragonscale",
  },
  {
    sku: "banner.gilded",
    category: "banner_style",
    name: "Gilded Banner",
    description: "Threaded with gold for the newly crowned.",
    priceUsd: 2.99,
    art: "gilded",
  },
  {
    sku: "banner.obsidian",
    category: "banner_style",
    name: "Obsidian Banner",
    description: "Black glass, cut for the Long Night.",
    priceUsd: 3.99,
    art: "obsidian",
  },
];

const BY_SKU = new Map(COSMETICS.map((c) => [c.sku, c]));

export function cosmeticBySku(sku: string): Cosmetic | undefined {
  return BY_SKU.get(sku);
}

/** One active cosmetic per category slot. */
export type Equipped = Partial<Record<CosmeticCategory, string>>;

export function ownedCosmetics(entitlementSkus: string[]): Cosmetic[] {
  return entitlementSkus
    .map((s) => cosmeticBySku(s))
    .filter((c): c is Cosmetic => c !== undefined);
}

export function equippedFor(
  equipped: Equipped,
  category: CosmeticCategory
): Cosmetic | undefined {
  const sku = equipped[category];
  return sku ? cosmeticBySku(sku) : undefined;
}

/** A sku is equippable only if it exists in the catalog AND the user owns it. */
export function canEquip(sku: string, ownedSkus: string[]): boolean {
  return cosmeticBySku(sku) !== undefined && ownedSkus.includes(sku);
}

/** Drop any equipped entry that is unknown, unowned, or filed under the wrong
 * category slot. The server persists only normalized selections. */
export function normalizeEquipped(equipped: Equipped, ownedSkus: string[]): Equipped {
  const out: Equipped = {};
  for (const [category, sku] of Object.entries(equipped) as [CosmeticCategory, string][]) {
    const c = cosmeticBySku(sku);
    if (c && c.category === category && ownedSkus.includes(sku)) {
      out[category] = sku;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace packages/core -- cosmetics`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cosmetics.ts packages/core/src/cosmetics.test.ts
git commit -m "feat(core): cosmetics catalog + equip logic (banner styles)"
```

---

### Task 2: Export cosmetics + extend `MeDTO`

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/dto.ts`

- [ ] **Step 1: Add the export**

In `packages/core/src/index.ts`, add after the `./invites` line:

```ts
export * from "./cosmetics";
```

- [ ] **Step 2: Extend `MeDTO`**

In `packages/core/src/dto.ts`, add the import at the top (near the other type imports):

```ts
import type { Equipped } from "./cosmetics";
```

Then extend the `MeDTO` interface — add a `cosmetics` field after `ageGate`:

```ts
export interface MeDTO {
  profile: {
    name: string; houseId: HouseId; joinedAt: number;
    badges: string[]; notifyPrefs: NotifyPrefsDTO; lastHouseSwitchAt: number | null;
  } | null;
  rank?: RankInfo;
  streak?: { weeks: number; thisWeekActive: boolean };
  ageGate?: { confirmed: boolean; locked: boolean };
  cosmetics?: { owned: string[]; equipped: Equipped };
}
```

- [ ] **Step 3: Verify the workspace still type-checks & builds**

Run: `npm run test --workspace packages/core`
Expected: PASS (existing suites + cosmetics).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/dto.ts
git commit -m "feat(core): export cosmetics + add cosmetics to MeDTO"
```

---

### Task 3: Guardrail test — cosmetics never grant gameplay power

**Files:**
- Test: `packages/core/src/monetization-guardrails.test.ts`

- [ ] **Step 1: Write the test**

`packages/core/src/monetization-guardrails.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COSMETICS } from "./cosmetics";

// The influence_reason enum values from apps/web schema. A cosmetic sku must
// never collide with a way to earn Influence (spec §2, invariant 1 & 4).
const INFLUENCE_REASONS = [
  "rating", "first_of_name", "new_throne", "confirmation", "hearsay", "reversal",
];

describe("monetization guardrails", () => {
  it("no cosmetic sku collides with an influence reason", () => {
    for (const c of COSMETICS) {
      expect(INFLUENCE_REASONS).not.toContain(c.sku);
    }
  });

  it("cosmetics carry no gameplay-advantage fields", () => {
    for (const c of COSMETICS) {
      expect(c).not.toHaveProperty("points");
      expect(c).not.toHaveProperty("influence");
      expect(c).not.toHaveProperty("multiplier");
      expect(c).not.toHaveProperty("rank");
    }
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `npm run test --workspace packages/core -- monetization-guardrails`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/monetization-guardrails.test.ts
git commit -m "test(core): guardrail — cosmetics never grant gameplay power"
```

---

## Part B — Server schema & migration

### Task 4: `entitlements` table, `users.equipped`, migration `0010`

**Files:**
- Modify: `apps/web/src/db/schema.ts`
- Modify: `apps/web/src/test/db.ts` (add `entitlements` to the truncate list)
- Generate: `apps/web/drizzle/0010_*.sql` (via drizzle-kit)

- [ ] **Step 1: Add the enum**

In `apps/web/src/db/schema.ts`, after `reportReasonEnum` (near the other `pgEnum` declarations):

```ts
export const entitlementSourceEnum = pgEnum("entitlement_source", ["purchase", "grant", "pass"]);
```

- [ ] **Step 2: Add `equipped` to the `users` table**

In the `users` table definition, add a column after `cohort`:

```ts
  cohort: text("cohort"), // closed-beta launch city; NULL when open signup
  equipped: jsonb("equipped").$type<Record<string, string>>().notNull().default({}),
```

- [ ] **Step 3: Add the `entitlements` table**

Add after the `invites` table definition:

```ts
export const entitlements = pgTable(
  "entitlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    source: entitlementSourceEnum("source").notNull(),
    platform: text("platform"), // "ios" | "android" | "admin" | null
    // Store transaction id. Nullable (admin grants have none), unique so
    // duplicate webhook deliveries are idempotent.
    storeTxnId: text("store_txn_id").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("entitlements_user_idx").on(t.userId),
    // A user owns a given sku at most once while it is not revoked.
    uniqueIndex("entitlements_user_sku_active")
      .on(t.userId, t.sku)
      .where(sql`${t.revokedAt} is null`),
  ]
);
```

(`sql`, `index`, `uniqueIndex`, `jsonb`, `pgEnum`, `text`, `timestamp`, `uuid` are already imported at the top of the file.)

- [ ] **Step 4: Add `entitlements` to the test truncate list**

In `apps/web/src/test/db.ts`, extend the TRUNCATE statement to include `entitlements` (first, since it references `users`):

```ts
  await db.execute(
    sql`TRUNCATE TABLE entitlements, reports, review_queue, age_attestations, photos, ratings, influence_events, ledger_entries, thrones, users CASCADE`
  );
```

- [ ] **Step 5: Generate the migration**

Run: `npm run db:generate --workspace apps/web`
Expected: a new file `apps/web/drizzle/0010_*.sql` creating the `entitlement_source` enum, the `entitlements` table + indexes, and adding `users.equipped`. Open it and confirm it contains `CREATE TABLE "entitlements"` and `ALTER TABLE "users" ADD COLUMN "equipped"`.

- [ ] **Step 6: Apply the migration to the dev and test databases**

Dev DB (uses `.env.local`):

```bash
npm run db:migrate --workspace apps/web
```

Test DB (the `.env.test` Neon branch — dotenv does NOT override a pre-set var, so exporting `DATABASE_URL` targets the test branch; substitute the URL from `apps/web/.env.test`):

```bash
DATABASE_URL="<value of DATABASE_URL from apps/web/.env.test>" npm run db:migrate --workspace apps/web
```

Expected: both report the migration applied. (Prod application is owner-gated per spec §9 — do NOT apply to prod here.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/db/schema.ts apps/web/src/test/db.ts apps/web/drizzle
git commit -m "feat(db): entitlements table + users.equipped (migration 0010)"
```

---

## Part C — Server entitlement & RevenueCat logic

### Task 5: RevenueCat mapping & webhook auth (pure)

**Files:**
- Create: `apps/web/src/lib/server/revenuecat.ts`
- Test: `apps/web/src/test/revenuecat.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/test/revenuecat.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import {
  skuForProductId,
  platformForStore,
  verifyWebhookAuth,
  GRANT_EVENTS,
  REVOKE_EVENTS,
} from "@/lib/server/revenuecat";

describe("revenuecat mapping", () => {
  it("maps known product ids to skus and ignores unknown ones", () => {
    expect(skuForProductId("sot_banner_dragonscale")).toBe("banner.dragonscale");
    expect(skuForProductId("sot_unknown")).toBeUndefined();
  });

  it("maps store to platform", () => {
    expect(platformForStore("APP_STORE")).toBe("ios");
    expect(platformForStore("PLAY_STORE")).toBe("android");
    expect(platformForStore(undefined)).toBeNull();
  });

  it("classifies grant vs revoke event types", () => {
    expect(GRANT_EVENTS.has("INITIAL_PURCHASE")).toBe(true);
    expect(GRANT_EVENTS.has("NON_RENEWING_PURCHASE")).toBe(true);
    expect(REVOKE_EVENTS.has("REFUND")).toBe(true);
    expect(REVOKE_EVENTS.has("CANCELLATION")).toBe(true);
  });
});

describe("verifyWebhookAuth", () => {
  const prev = process.env.REVENUECAT_WEBHOOK_AUTH;
  afterEach(() => { process.env.REVENUECAT_WEBHOOK_AUTH = prev; });

  it("accepts the matching bearer token and rejects everything else", () => {
    process.env.REVENUECAT_WEBHOOK_AUTH = "s3cret";
    expect(verifyWebhookAuth("Bearer s3cret")).toBe(true);
    expect(verifyWebhookAuth("Bearer nope")).toBe(false);
    expect(verifyWebhookAuth(null)).toBe(false);
  });

  it("fails closed when the secret is unset", () => {
    delete process.env.REVENUECAT_WEBHOOK_AUTH;
    expect(verifyWebhookAuth("Bearer anything")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test --workspace apps/web -- revenuecat`
Expected: FAIL — cannot find module `@/lib/server/revenuecat`.

- [ ] **Step 3: Write the implementation**

`apps/web/src/lib/server/revenuecat.ts`:

```ts
/** RevenueCat product_id -> our internal cosmetic sku. Keys are the product
 * identifiers created in App Store Connect / Play Console (spec §9). */
export const PRODUCT_ID_TO_SKU: Record<string, string> = {
  sot_banner_dragonscale: "banner.dragonscale",
  sot_banner_gilded: "banner.gilded",
  sot_banner_obsidian: "banner.obsidian",
};

export function skuForProductId(productId: string): string | undefined {
  return PRODUCT_ID_TO_SKU[productId];
}

export function platformForStore(store: string | undefined): "ios" | "android" | null {
  if (store === "APP_STORE") return "ios";
  if (store === "PLAY_STORE") return "android";
  return null;
}

export const GRANT_EVENTS = new Set(["INITIAL_PURCHASE", "NON_RENEWING_PURCHASE"]);
export const REVOKE_EVENTS = new Set(["CANCELLATION", "REFUND", "EXPIRATION"]);

/** Bearer-token check against the shared secret configured in the RevenueCat
 * dashboard. Fails closed when the secret is unset. */
export function verifyWebhookAuth(header: string | null): boolean {
  const secret = process.env.REVENUECAT_WEBHOOK_AUTH;
  return !!secret && header === `Bearer ${secret}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test --workspace apps/web -- revenuecat`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/revenuecat.ts apps/web/src/test/revenuecat.test.ts
git commit -m "feat(web): revenuecat product->sku mapping + webhook auth"
```

---

### Task 6: Entitlement store (grant / revoke / owned / equip) + guardrail

**Files:**
- Create: `apps/web/src/lib/server/entitlements.ts`
- Test: `apps/web/src/test/entitlements.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/test/entitlements.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { influenceEvents } from "@/db/schema";
import {
  grantEntitlement,
  revokeEntitlement,
  ownedSkus,
  setEquipped,
} from "@/lib/server/entitlements";
import { resetDb } from "./db";
import { makeUser } from "./fixtures";

describe("entitlements", () => {
  beforeEach(resetDb);

  it("grants an entitlement and lists it as owned", async () => {
    const user = await makeUser();
    await grantEntitlement({ userId: user.id, sku: "banner.gilded", source: "grant", platform: "admin" });
    expect(await ownedSkus(user.id)).toEqual(["banner.gilded"]);
  });

  it("is idempotent on duplicate store transaction ids", async () => {
    const user = await makeUser();
    const args = { userId: user.id, sku: "banner.gilded", source: "purchase" as const, platform: "ios" as const, storeTxnId: "txn-1" };
    await grantEntitlement(args);
    await grantEntitlement(args); // duplicate webhook delivery
    expect(await ownedSkus(user.id)).toEqual(["banner.gilded"]);
  });

  it("revokes by store transaction id", async () => {
    const user = await makeUser();
    await grantEntitlement({ userId: user.id, sku: "banner.gilded", source: "purchase", platform: "ios", storeTxnId: "txn-2" });
    await revokeEntitlement("txn-2");
    expect(await ownedSkus(user.id)).toEqual([]);
  });

  it("equips only owned skus and rejects unowned ones", async () => {
    const user = await makeUser();
    await expect(setEquipped(user.id, "banner_style", "banner.gilded")).rejects.toThrow(/not owned/);
    await grantEntitlement({ userId: user.id, sku: "banner.gilded", source: "grant", platform: "admin" });
    expect(await setEquipped(user.id, "banner_style", "banner.gilded")).toEqual({ banner_style: "banner.gilded" });
    // null clears the slot
    expect(await setEquipped(user.id, "banner_style", null)).toEqual({});
  });

  it("granting an entitlement writes NO influence events (guardrail)", async () => {
    const user = await makeUser();
    await grantEntitlement({ userId: user.id, sku: "banner.obsidian", source: "purchase", platform: "ios", storeTxnId: "txn-3" });
    const rows = await db.select().from(influenceEvents);
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test --workspace apps/web -- entitlements`
Expected: FAIL — cannot find module `@/lib/server/entitlements`.

- [ ] **Step 3: Write the implementation**

`apps/web/src/lib/server/entitlements.ts`:

```ts
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { entitlements, users } from "@/db/schema";
import { canEquip, normalizeEquipped, type CosmeticCategory, type Equipped } from "@sot/core";

export async function ownedSkus(userId: string): Promise<string[]> {
  const rows = await db
    .select({ sku: entitlements.sku })
    .from(entitlements)
    .where(and(eq(entitlements.userId, userId), isNull(entitlements.revokedAt)));
  return rows.map((r) => r.sku);
}

export async function grantEntitlement(input: {
  userId: string;
  sku: string;
  source: "purchase" | "grant" | "pass";
  platform?: "ios" | "android" | "admin" | null;
  storeTxnId?: string | null;
}): Promise<void> {
  // ON CONFLICT DO NOTHING (no target) covers BOTH unique constraints:
  // the storeTxnId unique (duplicate webhook) and the (userId, sku) active
  // partial unique (already owned). Both make a re-grant a safe no-op.
  await db
    .insert(entitlements)
    .values({
      userId: input.userId,
      sku: input.sku,
      source: input.source,
      platform: input.platform ?? null,
      storeTxnId: input.storeTxnId ?? null,
    })
    .onConflictDoNothing();
}

export async function revokeEntitlement(storeTxnId: string): Promise<void> {
  await db
    .update(entitlements)
    .set({ revokedAt: new Date() })
    .where(and(eq(entitlements.storeTxnId, storeTxnId), isNull(entitlements.revokedAt)));
}

/** Set (or clear, with sku=null) the equipped cosmetic for a category slot.
 * Ownership is validated server-side; the persisted value is normalized. */
export async function setEquipped(
  userId: string,
  category: CosmeticCategory,
  sku: string | null
): Promise<Equipped> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error("no profile");
  const owned = await ownedSkus(userId);
  if (sku !== null && !canEquip(sku, owned)) throw new Error("not owned");

  const next: Equipped = { ...((user.equipped ?? {}) as Equipped) };
  if (sku === null) delete next[category];
  else next[category] = sku;

  const normalized = normalizeEquipped(next, owned);
  await db.update(users).set({ equipped: normalized }).where(eq(users.id, userId));
  return normalized;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test --workspace apps/web -- entitlements`
Expected: PASS (all five cases, including the guardrail).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/entitlements.ts apps/web/src/test/entitlements.test.ts
git commit -m "feat(web): entitlement store — grant/revoke/owned/equip (idempotent)"
```

---

## Part D — Server routes & `mePayload`

### Task 7: RevenueCat webhook route

**Files:**
- Create: `apps/web/src/app/api/revenuecat/webhook/route.ts`
- Test: `apps/web/src/test/revenuecat-webhook.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/test/revenuecat-webhook.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/revenuecat/webhook/route";
import { ownedSkus } from "@/lib/server/entitlements";
import { resetDb } from "./db";
import { makeUser } from "./fixtures";

const prev = process.env.REVENUECAT_WEBHOOK_AUTH;
afterEach(() => { process.env.REVENUECAT_WEBHOOK_AUTH = prev; });
beforeEach(async () => {
  await resetDb();
  process.env.REVENUECAT_WEBHOOK_AUTH = "s3cret";
});

function post(body: unknown, auth = "Bearer s3cret") {
  return POST(new Request("http://t/api/revenuecat/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: auth },
    body: JSON.stringify(body),
  }));
}

describe("POST /api/revenuecat/webhook", () => {
  it("rejects a bad auth header", async () => {
    const res = await post({ event: {} }, "Bearer wrong");
    expect(res.status).toBe(401);
  });

  it("grants an entitlement on a purchase event", async () => {
    const user = await makeUser();
    const res = await post({
      event: {
        type: "NON_RENEWING_PURCHASE",
        app_user_id: user.id,
        product_id: "sot_banner_dragonscale",
        transaction_id: "txn-web-1",
        store: "APP_STORE",
      },
    });
    expect(res.status).toBe(200);
    expect(await ownedSkus(user.id)).toEqual(["banner.dragonscale"]);
  });

  it("is idempotent across duplicate deliveries", async () => {
    const user = await makeUser();
    const event = {
      type: "INITIAL_PURCHASE",
      app_user_id: user.id,
      product_id: "sot_banner_gilded",
      transaction_id: "txn-web-2",
      store: "PLAY_STORE",
    };
    await post({ event });
    await post({ event });
    expect(await ownedSkus(user.id)).toEqual(["banner.gilded"]);
  });

  it("ignores unknown product ids without erroring", async () => {
    const user = await makeUser();
    const res = await post({
      event: { type: "INITIAL_PURCHASE", app_user_id: user.id, product_id: "sot_mystery", transaction_id: "t", store: "APP_STORE" },
    });
    expect(res.status).toBe(200);
    expect(await ownedSkus(user.id)).toEqual([]);
  });

  it("revokes on a refund event", async () => {
    const user = await makeUser();
    await post({ event: { type: "INITIAL_PURCHASE", app_user_id: user.id, product_id: "sot_banner_obsidian", transaction_id: "txn-web-3", store: "APP_STORE" } });
    await post({ event: { type: "REFUND", app_user_id: user.id, transaction_id: "txn-web-3" } });
    expect(await ownedSkus(user.id)).toEqual([]);
  });

  it("ignores non-uuid app_user_ids (RevenueCat anonymous ids)", async () => {
    const res = await post({
      event: { type: "INITIAL_PURCHASE", app_user_id: "$RCAnonymousID:abc", product_id: "sot_banner_gilded", transaction_id: "t", store: "APP_STORE" },
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test --workspace apps/web -- revenuecat-webhook`
Expected: FAIL — cannot find module `@/app/api/revenuecat/webhook/route`.

- [ ] **Step 3: Write the implementation**

`apps/web/src/app/api/revenuecat/webhook/route.ts`:

```ts
import { NextResponse } from "next/server";
import {
  GRANT_EVENTS,
  REVOKE_EVENTS,
  skuForProductId,
  platformForStore,
  verifyWebhookAuth,
} from "@/lib/server/revenuecat";
import { grantEntitlement, revokeEntitlement } from "@/lib/server/entitlements";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  if (!verifyWebhookAuth(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const event = body?.event;
  if (!event?.type || typeof event.app_user_id !== "string") {
    return NextResponse.json({ error: "bad event" }, { status: 400 });
  }

  // app_user_id is our users.id (set as the RevenueCat appUserID on the client).
  // Ignore RevenueCat anonymous ids and anything that is not one of our uuids.
  if (!UUID_RE.test(event.app_user_id)) {
    return NextResponse.json({ ok: true, ignored: "non-uuid app_user_id" });
  }

  if (GRANT_EVENTS.has(event.type)) {
    const sku = skuForProductId(event.product_id);
    if (!sku) return NextResponse.json({ ok: true, ignored: "unknown product" });
    await grantEntitlement({
      userId: event.app_user_id,
      sku,
      source: "purchase",
      platform: platformForStore(event.store),
      storeTxnId: typeof event.transaction_id === "string" ? event.transaction_id : null,
    });
  } else if (REVOKE_EVENTS.has(event.type) && typeof event.transaction_id === "string") {
    await revokeEntitlement(event.transaction_id);
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test --workspace apps/web -- revenuecat-webhook`
Expected: PASS (all six cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/revenuecat/webhook/route.ts apps/web/src/test/revenuecat-webhook.test.ts
git commit -m "feat(web): RevenueCat webhook -> idempotent entitlement grant/revoke"
```

---

### Task 8: Equip route + moderator grant route

**Files:**
- Create: `apps/web/src/app/api/cosmetics/equip/route.ts`
- Create: `apps/web/src/app/api/cosmetics/grant/route.ts`
- Test: `apps/web/src/test/cosmetics-routes.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/test/cosmetics-routes.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as equipPOST } from "@/app/api/cosmetics/equip/route";
import { POST as grantPOST } from "@/app/api/cosmetics/grant/route";
import { grantEntitlement, ownedSkus } from "@/lib/server/entitlements";
import * as session from "@/lib/server/session";
import { resetDb } from "./db";
import { makeUser } from "./fixtures";

beforeEach(resetDb);

function req(body: unknown) {
  return new Request("http://t", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function asUser(user: Awaited<ReturnType<typeof makeUser>>) {
  vi.spyOn(session, "sessionInfo").mockResolvedValue({ kind: "user", user });
}

describe("POST /api/cosmetics/equip", () => {
  it("401s when not signed in", async () => {
    vi.spyOn(session, "sessionInfo").mockResolvedValue({ kind: "anonymous" });
    expect((await equipPOST(req({ category: "banner_style", sku: "banner.gilded" }))).status).toBe(401);
  });

  it("403s when equipping an unowned sku", async () => {
    const user = await makeUser();
    asUser(user);
    expect((await equipPOST(req({ category: "banner_style", sku: "banner.gilded" }))).status).toBe(403);
  });

  it("equips an owned sku", async () => {
    const user = await makeUser();
    await grantEntitlement({ userId: user.id, sku: "banner.gilded", source: "grant", platform: "admin" });
    asUser(user);
    const res = await equipPOST(req({ category: "banner_style", sku: "banner.gilded" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ equipped: { banner_style: "banner.gilded" } });
  });

  it("rejects a bad category", async () => {
    const user = await makeUser();
    asUser(user);
    expect((await equipPOST(req({ category: "wings", sku: null }))).status).toBe(400);
  });
});

describe("POST /api/cosmetics/grant (moderator)", () => {
  it("403s for non-moderators", async () => {
    const user = await makeUser({ role: "user" });
    asUser(user);
    expect((await grantPOST(req({ userId: user.id, sku: "banner.gilded" }))).status).toBe(403);
  });

  it("grants to a target user when called by a moderator", async () => {
    const mod = await makeUser({ role: "moderator" });
    const target = await makeUser();
    asUser(mod);
    const res = await grantPOST(req({ userId: target.id, sku: "banner.gilded" }));
    expect(res.status).toBe(201);
    expect(await ownedSkus(target.id)).toEqual(["banner.gilded"]);
  });

  it("rejects an unknown sku", async () => {
    const mod = await makeUser({ role: "moderator" });
    asUser(mod);
    expect((await grantPOST(req({ userId: mod.id, sku: "banner.ghost" }))).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test --workspace apps/web -- cosmetics-routes`
Expected: FAIL — cannot find the route modules.

- [ ] **Step 3: Write the equip route**

`apps/web/src/app/api/cosmetics/equip/route.ts`:

```ts
import { NextResponse } from "next/server";
import { sessionInfo } from "@/lib/server/session";
import { setEquipped } from "@/lib/server/entitlements";
import type { CosmeticCategory } from "@sot/core";

export const dynamic = "force-dynamic";

const CATEGORIES = new Set<CosmeticCategory>([
  "banner_style", "map_theme", "profile_sigil", "rating_stamp",
]);

export async function POST(req: Request) {
  const info = await sessionInfo();
  if (info.kind !== "user") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const category = body?.category as CosmeticCategory;
  if (!CATEGORIES.has(category)) {
    return NextResponse.json({ error: "bad category" }, { status: 400 });
  }
  const sku: string | null = typeof body?.sku === "string" ? body.sku : null;

  try {
    const equipped = await setEquipped(info.user.id, category, sku);
    return NextResponse.json({ equipped });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: msg === "not owned" ? 403 : 400 });
  }
}
```

- [ ] **Step 4: Write the moderator grant route**

`apps/web/src/app/api/cosmetics/grant/route.ts`:

```ts
import { NextResponse } from "next/server";
import { sessionInfo } from "@/lib/server/session";
import { grantEntitlement } from "@/lib/server/entitlements";
import { cosmeticBySku } from "@sot/core";

export const dynamic = "force-dynamic";

/** Moderator-only comp/support grant. Mirrors the /api/invites admin pattern. */
export async function POST(req: Request) {
  const info = await sessionInfo();
  if (info.kind !== "user" || info.user.role !== "moderator") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const sku = typeof body?.sku === "string" ? body.sku : "";
  if (!userId || !cosmeticBySku(sku)) {
    return NextResponse.json({ error: "userId and a known sku are required" }, { status: 400 });
  }

  await grantEntitlement({ userId, sku, source: "grant", platform: "admin" });
  return NextResponse.json({ ok: true }, { status: 201 });
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test --workspace apps/web -- cosmetics-routes`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/cosmetics apps/web/src/test/cosmetics-routes.test.ts
git commit -m "feat(web): cosmetics equip route + moderator grant route"
```

---

### Task 9: Extend `mePayload` with cosmetics

**Files:**
- Modify: `apps/web/src/lib/server/profile.ts`
- Test: `apps/web/src/test/profile.test.ts` (add a case)

- [ ] **Step 1: Add the failing test case**

In `apps/web/src/test/profile.test.ts`, add imports at the top:

```ts
import { grantEntitlement, setEquipped } from "@/lib/server/entitlements";
```

Add this case inside `describe("profiles", ...)`:

```ts
  it("mePayload reports owned + equipped cosmetics", async () => {
    const user = await makeUser();
    let me = await mePayload(user.id);
    expect(me.cosmetics).toEqual({ owned: [], equipped: {} });

    await grantEntitlement({ userId: user.id, sku: "banner.gilded", source: "grant", platform: "admin" });
    await setEquipped(user.id, "banner_style", "banner.gilded");

    me = await mePayload(user.id);
    expect(me.cosmetics).toEqual({ owned: ["banner.gilded"], equipped: { banner_style: "banner.gilded" } });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test --workspace apps/web -- profile`
Expected: FAIL — `me.cosmetics` is `undefined`.

- [ ] **Step 3: Implement the extension**

In `apps/web/src/lib/server/profile.ts`:

Add imports near the other `@sot/core` imports:

```ts
import { normalizeEquipped, type Equipped } from "@sot/core";
import { ownedSkus } from "./entitlements";
```

In `mePayload`, after the `xp` line and before the `return`, compute cosmetics:

```ts
  const owned = await ownedSkus(userId);
  const equipped = normalizeEquipped((user.equipped ?? {}) as Equipped, owned);
```

Add `cosmetics` to the returned object (after `streak`):

```ts
    rank: rankForXp(xp),
    streak,
    cosmetics: { owned, equipped },
  };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test --workspace apps/web -- profile`
Expected: PASS (existing cases + the new cosmetics case).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/profile.ts apps/web/src/test/profile.test.ts
git commit -m "feat(web): mePayload returns owned + equipped cosmetics"
```

---

## Part E — Web client: banner render + Treasury store

### Task 10: `BannerCrest` component + banner-style CSS

**Files:**
- Create: `apps/web/src/components/BannerCrest.tsx`
- Modify: `apps/web/src/app/globals.css` (append banner-style classes)

- [ ] **Step 1: Add the banner-style CSS**

Append to `apps/web/src/app/globals.css`:

```css
/* Premium Banner styles (Phase 6). The base chevron is the House colorVar;
   an equipped style layers a texture/overlay on top via .banner-art-<token>. */
.banner-art-dragonscale {
  background-image: radial-gradient(circle at 30% 20%, rgba(255,255,255,0.28) 0 2px, transparent 3px),
                    radial-gradient(circle at 70% 60%, rgba(0,0,0,0.22) 0 2px, transparent 3px);
  background-size: 8px 8px;
}
.banner-art-gilded {
  background-image: linear-gradient(135deg, rgba(255,214,102,0.55), rgba(255,255,255,0.1) 40%, rgba(184,134,11,0.55));
}
.banner-art-obsidian {
  background-image: linear-gradient(160deg, rgba(20,20,28,0.85), rgba(80,80,110,0.35));
}
```

- [ ] **Step 2: Write the component**

`apps/web/src/components/BannerCrest.tsx`:

```tsx
import type { Cosmetic } from "@sot/core";

const CHEVRON = "polygon(0 0,100% 0,100% 70%,50% 100%,0 70%)";

/** The heraldic banner chevron. `colorVar` is the House colour; `style`, when
 * present, is the user's equipped premium Banner cosmetic overlaid on top. */
export function BannerCrest({
  colorVar,
  style,
  className = "h-4 w-7",
}: {
  colorVar: string;
  style?: Cosmetic;
  className?: string;
}) {
  return (
    <span className={`relative inline-block shrink-0 ${className}`}>
      <span
        className="absolute inset-0"
        style={{ background: colorVar, clipPath: CHEVRON }}
      />
      {style && (
        <span
          className={`absolute inset-0 banner-art-${style.art}`}
          style={{ clipPath: CHEVRON }}
          aria-hidden
        />
      )}
    </span>
  );
}
```

- [ ] **Step 3: Verify the web build compiles**

Run: `npm run build:web`
Expected: build succeeds (component is not yet imported anywhere; this confirms it type-checks).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/BannerCrest.tsx apps/web/src/app/globals.css
git commit -m "feat(web): BannerCrest component + premium banner-style CSS"
```

---

### Task 11: Wire cosmetics into client store + equip action

**Files:**
- Modify: `apps/web/src/lib/store.tsx`
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Add the equip API method**

In `apps/web/src/lib/api.ts`, add to the `api` object (near `me:`):

```ts
  equipCosmetic: (category: string, sku: string | null) =>
    request<{ equipped: Record<string, string> }>("/api/cosmetics/equip", {
      method: "POST",
      body: JSON.stringify({ category, sku }),
    }),
```

- [ ] **Step 2: Add cosmetics to `StoreState`**

In `apps/web/src/lib/store.tsx`, add to the `StoreState` type (right after the `streak` field):

```ts
  streak: MeDTO["streak"] | null;
  cosmetics: MeDTO["cosmetics"] | null;
```

- [ ] **Step 3: Initialise it**

In the `useState<StoreState>({ ... })` initial value, add `cosmetics: null` alongside `streak: null`:

```ts
    authStatus: "loading", profile: null, rank: null, streak: null, cosmetics: null, ageGate: null, realm: null, error: null,
```

- [ ] **Step 4: Populate it on refresh**

In the `refresh` `setState` block that maps the `me` payload (where `streak: me?.streak ?? null` is set), add the cosmetics line directly below it:

```ts
        streak: me?.streak ?? null,
        cosmetics: me?.cosmetics ?? null,
```

- [ ] **Step 5: Add the `equipCosmetic` action + context type**

Add `equipCosmetic` to the store context interface (the one listing `switchHouse`, `updateNotifyPrefs`, `addThrone`, etc.):

```ts
  equipCosmetic: (category: string, sku: string | null) => Promise<void>;
```

Add the action implementation to the object returned by the provider (near `updateNotifyPrefs`):

```ts
    equipCosmetic: async (category: string, sku: string | null) => {
      const { equipped } = await api.equipCosmetic(category, sku);
      setState((s) => ({
        ...s,
        cosmetics: s.cosmetics ? { ...s.cosmetics, equipped } : { owned: [], equipped },
      }));
    },
```

- [ ] **Step 6: Verify the build compiles**

Run: `npm run build:web`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/store.tsx apps/web/src/lib/api.ts
git commit -m "feat(web): thread cosmetics through client store + equip action"
```

---

### Task 12: Render the equipped Banner on the Profile

**Files:**
- Modify: `apps/web/src/components/ProfilePanel.tsx`

- [ ] **Step 1: Add imports**

In `apps/web/src/components/ProfilePanel.tsx`, add:

```ts
import { BannerCrest } from "@/components/BannerCrest";
import { equippedFor } from "@sot/core";
```

- [ ] **Step 2: Compute the equipped banner**

After the line `const house = HOUSE_BY_ID[profile.houseId];`, add:

```ts
  const bannerStyle = state.cosmetics
    ? equippedFor(state.cosmetics.equipped, "banner_style")
    : undefined;
```

- [ ] **Step 3: Use `BannerCrest` in the "Sworn to" block**

In the "Sworn to" block, replace the inline chevron span:

```tsx
          <span
            className="h-4 w-7"
            style={{
              background: house.colorVar,
              clipPath: "polygon(0 0,100% 0,100% 70%,50% 100%,0 70%)",
            }}
          />
```

with:

```tsx
          <BannerCrest colorVar={house.colorVar} style={bannerStyle} />
```

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build:web`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ProfilePanel.tsx
git commit -m "feat(web): render equipped Banner style on Profile"
```

---

### Task 13: Treasury store screen (gallery + equip)

**Files:**
- Create: `apps/web/src/components/Treasury.tsx`
- Create: `apps/web/src/app/treasury/page.tsx`

- [ ] **Step 1: Write the Treasury component**

`apps/web/src/components/Treasury.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { COSMETICS, HOUSE_BY_ID, equippedFor } from "@sot/core";
import { useStore } from "@/lib/store";

const CHEVRON = "polygon(0 0,100% 0,100% 70%,50% 100%,0 70%)";

export function Treasury() {
  const { state, equipCosmetic } = useStore();
  const { profile, cosmetics } = state;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const owned = useMemo(() => new Set(cosmetics?.owned ?? []), [cosmetics]);
  const equippedSku = cosmetics ? equippedFor(cosmetics.equipped, "banner_style")?.sku : undefined;
  const colorVar = profile ? HOUSE_BY_ID[profile.houseId].colorVar : "var(--house-flush)";

  async function onEquip(sku: string | null) {
    setBusy(sku ?? "clear");
    setError(null);
    try {
      await equipCosmetic("banner_style", sku);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  if (!profile) {
    return (
      <p className="mx-auto max-w-2xl px-4 py-6 font-mono text-[14px] text-ink-faint">
        Swear an oath to enter the Treasury.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      <p className="font-mono text-[15px] uppercase tracking-widest text-brass">▸ The Treasury</p>
      <h1 className="mt-2 font-display text-[17px] leading-relaxed text-ink">Banners of the Realm</h1>
      <p className="mt-2 font-mono text-[13px] text-ink-faint">
        Cosmetic banners only — they change how your crest looks, never your standing.
      </p>
      {error && <p className="mt-3 font-mono text-[13px] text-crimson">{error}</p>}

      <div className="mt-4 space-y-3">
        {COSMETICS.map((c) => {
          const isOwned = owned.has(c.sku);
          const isEquipped = equippedSku === c.sku;
          return (
            <div key={c.sku} className="pixel-panel flex items-center gap-3 p-4">
              <span className="relative inline-block h-8 w-14 shrink-0">
                <span className="absolute inset-0" style={{ background: colorVar, clipPath: CHEVRON }} />
                <span className={`absolute inset-0 banner-art-${c.art}`} style={{ clipPath: CHEVRON }} aria-hidden />
              </span>
              <div className="flex-1">
                <p className="font-mono text-[14px] text-ink">{c.name}</p>
                <p className="font-mono text-[13px] text-ink-faint">{c.description}</p>
              </div>
              {isOwned ? (
                <button
                  type="button"
                  disabled={busy !== null || isEquipped}
                  onClick={() => void onEquip(isEquipped ? null : c.sku)}
                  className="pixel-chip bg-brass px-3 py-1.5 font-mono text-[13px] text-on-brass transition disabled:opacity-40"
                >
                  {isEquipped ? "Equipped" : "Equip"}
                </button>
              ) : (
                <span className="pixel-chip bg-vellum px-3 py-1.5 font-mono text-[13px] text-ink-soft">
                  ${c.priceUsd.toFixed(2)} · in app
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-4 font-mono text-[13px] text-ink-faint">
        Banners are purchased in the mobile app. Owned banners can be equipped here.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Write the route page**

`apps/web/src/app/treasury/page.tsx`:

```tsx
import { Treasury } from "@/components/Treasury";

export default function TreasuryPage() {
  return <Treasury />;
}
```

- [ ] **Step 3: Verify the web build compiles**

Run: `npm run build:web`
Expected: build succeeds and `/treasury` is listed as a route.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/Treasury.tsx apps/web/src/app/treasury/page.tsx
git commit -m "feat(web): Treasury store screen — banner gallery + equip"
```

---

## Part F — Full gate & live verification

### Task 14: Green health gate + live web verification

- [ ] **Step 1: Run the full health gate**

Run: `npm run check`
Expected: all workspace tests pass (core + web) and `build:web` succeeds.

- [ ] **Step 2: Live-verify the buy→equip→render loop on the web preview**

Start the dev server (via the Browser-pane preview tooling, not a raw shell) and, signed in as a **moderator** account:
1. Grant yourself a banner: `POST /api/cosmetics/grant` with `{ "userId": "<your user id>", "sku": "banner.gilded" }` (or grant to a test user).
2. Open `/treasury` → the granted banner shows an **Equip** button; unowned ones show the price + "in app".
3. Click **Equip** → button reads **Equipped**.
4. Open the Profile panel → the "Sworn to" crest now shows the gilded overlay.
5. Confirm no console errors and that `/api/me` returns `cosmetics: { owned: [...], equipped: { banner_style: "banner.gilded" } }` (check via read_network_requests).

Capture a screenshot of the equipped banner on the Profile as proof.

- [ ] **Step 3: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore(phase6): M1a green gate + web buy/equip/render verified"
```

---

## Done criteria for M1a

- `npm run check` green.
- Server-authoritative entitlement path: RevenueCat webhook (idempotent grant/revoke), moderator grant, ownership-gated equip, all tested.
- Guardrail tests prove cosmetics grant zero gameplay power and write zero influence events.
- Web loop demonstrated: grant → `/treasury` equip → Banner renders on Profile.

## Handoff to M1b (owner-dep gated — spec §9)

Not in this plan; queue for when the owner has provisioned RevenueCat + store products:
1. Mobile Treasury screen + `react-native-purchases` SDK wiring (offerings, purchase, `restorePurchases`), appUserID = our user id.
2. RevenueCat dashboard: products for each banner sku, webhook pointed at `/api/revenuecat/webhook` with `REVENUECAT_WEBHOOK_AUTH`.
3. Banner render on the remaining spec §4 surfaces: Small Council row, ThroneSheet rating list, rating-strike animation (web + mobile).
4. Apply migration `0010` to the **prod** Neon DB during the owner-gated deploy.
