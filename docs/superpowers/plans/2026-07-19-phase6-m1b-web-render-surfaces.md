# Phase 6 · Milestone 1b (web) — Banner render surfaces + webhook hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Show a user's equipped premium **Banner style** on the remaining spec §4 web surfaces — the Small Council/Standings row, the ThroneSheet rating list, and the rating-submit moment — and harden the RevenueCat webhook auth with a constant-time compare.

**Architecture:** Reuse the existing `BannerCrest` component and `@sot/core` `cosmeticBySku`/`equippedFor`. Standings and ThroneSheet render *other* users' banners, so their server payloads must carry each user's equipped `banner_style` sku: add an optional `bannerStyle?: string` to the `CouncilRow` and `Rating` DTOs and populate it server-side from `users.equipped`. The rating-submit flourish uses the current user's own `state.cosmetics` (already client-side). The webhook fix swaps `===` for `node:crypto` `timingSafeEqual`.

**Tech Stack:** TypeScript, Drizzle, Next.js, React, vitest. Base branch: `main`. Work branch: `feat/phase6-m1b-web`.

**Scope note:** Mobile purchase UI (`react-native-purchases`) is deferred (owner-dep gated). This plan is web-only and fully verifiable now. Migration: **none** (reuses `users.equipped` from migration 0010).

**Design decision (banner threading):** `CouncilRow`/`Rating` identify authors by `displayName` (no userId). The app already treats `displayName` as the standings identity. So attach `bannerStyle` server-side keyed by the joined user row — no new identity model.

---

## Task 1: Add `bannerStyle` to the CouncilRow and Rating DTOs

**Files:**
- Modify: `packages/core/src/standings.ts`
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: Extend `CouncilRow`** — in `packages/core/src/standings.ts`, add an optional field to the interface:

```ts
export interface CouncilRow {
  name: string;
  houseId: HouseId;
  points: number;
  position: number;
  /** Equipped banner_style cosmetic sku, if any. Populated server-side (the
   * pure selector leaves it undefined). */
  bannerStyle?: string;
}
```

Do NOT change `smallCouncil`'s logic — the pure selector keeps leaving `bannerStyle` undefined.

- [ ] **Step 2: Extend `Rating`** — in `packages/core/src/types.ts`, add to the `Rating` interface (after `createdAt`):

```ts
export interface Rating {
  id: string;
  throneId: string;
  authorName: string;
  houseId: HouseId;
  verdict: 1 | 2 | 3 | 4 | 5;
  tags: string[];
  testimony: string;
  verified: boolean;
  createdAt: number;
  /** Rater's equipped banner_style cosmetic sku, if any. Populated server-side. */
  bannerStyle?: string;
}
```

- [ ] **Step 3: Verify core still builds/tests** — Run: `npm run test --workspace packages/core`
Expected: PASS (optional field, no test churn).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/standings.ts packages/core/src/types.ts
git commit -m "feat(core): add optional bannerStyle to CouncilRow + Rating DTOs"
```

---

## Task 2: Populate `bannerStyle` on Standings rows (server)

**Files:**
- Modify: `apps/web/src/lib/server/standings.ts`
- Test: `apps/web/src/test/standings.test.ts` (add a case; create file if absent — check first)

**Context:** `standingsPayload` already `innerJoin`s `influenceEvents → users` selecting `users.displayName`. Add `users.equipped`, build a `displayName → banner_style sku` map, and stamp each returned council row + viewerRow.

- [ ] **Step 1: Write/extend the test.** First check whether `apps/web/src/test/standings.test.ts` exists (`ls apps/web/src/test`). If it exists, add this case; if not, create the file with the imports it needs (mirror `profile.test.ts` style: `resetDb`, `makeUser`, `beforeEach(resetDb)`). Test:

```ts
  it("stamps each council row with the user's equipped banner_style", async () => {
    const user = await makeUser({ displayName: "Ser Banner" });
    await grantEntitlement({ userId: user.id, sku: "banner.gilded", source: "grant", platform: "admin" });
    await setEquipped(user.id, "banner_style", "banner.gilded");
    // Give the user some influence so they appear on the council.
    await db.insert(influenceEvents).values({
      userId: user.id, houseId: user.houseId, fiefId: "f1", reason: "rating", points: 10,
    });

    const payload = await standingsPayload({ window: "all", house: null, viewerName: null });
    const row = payload.council.rows.find((r) => r.name === "Ser Banner");
    expect(row?.bannerStyle).toBe("banner.gilded");
  });
```

Imports to ensure at the top of the test file: `grantEntitlement, setEquipped` from `@/lib/server/entitlements`, `db` from `@/db/client`, `influenceEvents` from `@/db/schema`, `standingsPayload` from `@/lib/server/standings`, `resetDb` from `./db`, `makeUser` from `./fixtures`. (Confirm the `influenceEvents` insert column names against `apps/web/src/db/schema.ts` — adjust `reason`/`fiefId` field names if the schema differs; the goal is one influence row for the user.)

- [ ] **Step 2: Run to verify it fails** — `npm run test --workspace apps/web -- standings` → FAIL (`bannerStyle` undefined).

- [ ] **Step 3: Implement.** In `apps/web/src/lib/server/standings.ts`:

Add `Equipped` import: `import type { Equipped } from "@sot/core";`

In the query, also select equipped:
```ts
  const eventRows = await db
    .select({ event: influenceEvents, displayName: users.displayName, equipped: users.equipped })
    .from(influenceEvents)
    .innerJoin(users, eq(influenceEvents.userId, users.id));
```

After building `events` (still `authorName: row.displayName`), build the banner map:
```ts
  const bannerByName = new Map<string, string>();
  for (const row of eventRows) {
    const sku = (row.equipped as Equipped | null)?.banner_style;
    if (sku) bannerByName.set(row.displayName, sku);
  }
```

After `smallCouncil(...)` returns `council`, stamp rows + viewerRow:
```ts
  const stamp = (r: typeof council.rows[number]) => ({ ...r, bannerStyle: bannerByName.get(r.name) });
  const stampedCouncil = {
    rows: council.rows.map(stamp),
    viewerRow: council.viewerRow ? stamp(council.viewerRow) : null,
  };
```

Return `council: stampedCouncil` instead of `council`.

- [ ] **Step 4: Run to verify it passes** — `npm run test --workspace apps/web -- standings` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/standings.ts apps/web/src/test/standings.test.ts
git commit -m "feat(web): stamp Standings rows with each user's equipped banner"
```

---

## Task 3: Populate `bannerStyle` on ratings (server)

**Files:**
- Modify: `apps/web/src/lib/server/realm.ts`
- Modify: `apps/web/src/lib/server/mappers.ts`
- Test: `apps/web/src/test/realm-filtering.test.ts` or `ratings.test.ts` (add a case to whichever already exercises `realmPayload`/ratings; check both)

**Context:** `realm.ts` does `select({ rating: ratings, displayName: users.displayName, houseId: users.houseId }).innerJoin(users, ...)`. `mappers.ts` `toGameRating(row, { displayName, houseId })` builds the DTO. Thread `equipped` through.

- [ ] **Step 1: Write the failing test.** Find the existing test that asserts on `realmPayload().ratings` (check `apps/web/src/test/ratings.test.ts` and `realm-filtering.test.ts`). Add a case that: makes a user, grants+equips `banner.gilded`, inserts a rating by that user, calls `realmPayload()`, and asserts the returned rating for that user has `bannerStyle === "banner.gilded"`. Reuse the file's existing helpers/fixtures for creating a rating (follow the existing pattern in that file — do not invent a new rating-insert path).

- [ ] **Step 2: Run to verify it fails** — `npm run test --workspace apps/web -- <that file>` → FAIL.

- [ ] **Step 3: Implement.**

In `apps/web/src/lib/server/realm.ts`, add `equipped: users.equipped` to the ratings select, and pass it into `toGameRating`:
```ts
    .select({ rating: ratings, displayName: users.displayName, houseId: users.houseId, equipped: users.equipped })
```
```ts
    .map((r) => toGameRating(r.rating, { displayName: r.displayName, houseId: r.houseId, equipped: r.equipped }));
```

In `apps/web/src/lib/server/mappers.ts`, update `toGameRating`'s signature + body:
```ts
import type { Equipped } from "@sot/core";
// ...
export function toGameRating(
  row: RatingRow,
  author: { displayName: string; houseId: UserRow["houseId"]; equipped?: unknown }
): Rating {
  return {
    id: row.id,
    throneId: row.throneId,
    authorName: author.displayName,
    houseId: author.houseId,
    verdict: row.verdict as Rating["verdict"],
    tags: row.tags,
    testimony: row.testimonyHiddenAt ? "" : (row.testimony ?? ""),
    verified: row.verified,
    createdAt: row.createdAt.getTime(),
    bannerStyle: (author.equipped as Equipped | null | undefined)?.banner_style,
  };
}
```
(Keep the existing `Pick<UserRow, ...>` typing style if the file uses it — the key change is adding the optional `equipped` param and the `bannerStyle` field. Adjust the param type to match the file's conventions; do not break other `toGameRating` callers — update any other call site to pass `equipped` or leave it undefined.)

- [ ] **Step 4: Verify** — `npm run test --workspace apps/web -- <that file>` → PASS. Also run `npm run test --workspace apps/web` to catch any other `toGameRating` caller.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/realm.ts apps/web/src/lib/server/mappers.ts apps/web/src/test
git commit -m "feat(web): stamp ratings with the rater's equipped banner"
```

---

## Task 4: Render banners on Standings, ThroneSheet, and the rating-submit moment (web UI)

**Files:**
- Modify: `apps/web/src/components/Standings.tsx`
- Modify: `apps/web/src/components/ThroneSheet.tsx`
- Modify: `apps/web/src/components/SittingFlow.tsx`

Use the existing `BannerCrest` (`apps/web/src/components/BannerCrest.tsx`, props `{ colorVar, style?, className? }`) and `@sot/core` `cosmeticBySku`.

- [ ] **Step 1: Standings row.** In `apps/web/src/components/Standings.tsx`:
  - Import: `import { BannerCrest } from "@/components/BannerCrest";` and add `cosmeticBySku` to the existing `@sot/core` import.
  - The `Row` component receives `name/houseId/points/pos/me`. Add a `bannerStyle?: string` prop, and where `CouncilList` maps `data.council.rows` to `<Row .../>` (and the `viewerRow`), pass `bannerStyle={r.bannerStyle}`.
  - Inside `Row`, between `<Chip houseId={houseId} />` and the name span, render:
    ```tsx
    <BannerCrest colorVar={HOUSE_BY_ID[houseId as keyof typeof HOUSE_BY_ID]?.colorVar ?? "var(--house-flush)"} style={bannerStyle ? cosmeticBySku(bannerStyle) : undefined} className="h-4 w-6" />
    ```
    (`HOUSE_BY_ID` is already imported in this file per the `Chip` component.)

- [ ] **Step 2: ThroneSheet rater.** In `apps/web/src/components/ThroneSheet.tsx`:
  - Import `BannerCrest` and add `cosmeticBySku` to the `@sot/core` import (which already provides `HOUSE_BY_ID`).
  - In the recent-ratings `<li>` (around the `{r.authorName} ·` span), render a small crest before the author name:
    ```tsx
    <span className="inline-flex items-center gap-1.5">
      <BannerCrest colorVar={HOUSE_BY_ID[r.houseId].colorVar} style={r.bannerStyle ? cosmeticBySku(r.bannerStyle) : undefined} className="h-3.5 w-5" />
      {r.authorName}
    </span>{" "}·{" "}
    ```
    Keep the existing house-name span that follows.

- [ ] **Step 3: Rating-submit flourish.** In `apps/web/src/components/SittingFlow.tsx`:
  - Import `BannerCrest`, and `cosmeticBySku`, `equippedFor`, `HOUSE_BY_ID` from `@sot/core`.
  - The component already has `const { state, submitRating } = useStore();`. Compute (guarding for missing profile):
    ```tsx
    const myHouse = state.profile ? HOUSE_BY_ID[state.profile.houseId] : undefined;
    const myBanner = state.cosmetics ? equippedFor(state.cosmetics.equipped, "banner_style") : undefined;
    ```
  - In the `{influenceClaimed && (...)}` block, above the "Influence claimed!" chip, render the striking banner (only when `myHouse`):
    ```tsx
    {myHouse && (
      <div className="mt-4 flex justify-center">
        <BannerCrest colorVar={myHouse.colorVar} style={myBanner} className="h-10 w-16 animate-bounce" />
      </div>
    )}
    ```

- [ ] **Step 4: Build + verify** — Run: `npm run build:web` → succeeds. Then start the dev server and confirm `/` (map → tap a throne → ThroneSheet), the Standings tab, and the rating flow render without console errors. (Full authenticated visual states need a signed-in user; at minimum confirm no build/type errors and the components mount.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Standings.tsx apps/web/src/components/ThroneSheet.tsx apps/web/src/components/SittingFlow.tsx
git commit -m "feat(web): render equipped banners on Standings, ThroneSheet, and rating-submit"
```

---

## Task 5: Constant-time webhook-auth compare

**Files:**
- Modify: `apps/web/src/lib/server/revenuecat.ts`
- Test: `apps/web/src/test/revenuecat.test.ts` (existing — should still pass; add one case)

- [ ] **Step 1: Add a test case** for defense-in-depth in `apps/web/src/test/revenuecat.test.ts` inside the `verifyWebhookAuth` describe:

```ts
  it("rejects a token of a different length without throwing", () => {
    process.env.REVENUECAT_WEBHOOK_AUTH = "s3cret";
    expect(verifyWebhookAuth("Bearer s3")).toBe(false);
    expect(verifyWebhookAuth("Bearer s3cret-extra")).toBe(false);
  });
```

- [ ] **Step 2: Implement constant-time compare.** Replace `verifyWebhookAuth` in `apps/web/src/lib/server/revenuecat.ts`:

```ts
import { timingSafeEqual } from "node:crypto";

/** Bearer-token check against the shared secret configured in the RevenueCat
 * dashboard. Constant-time compare; fails closed when the secret is unset. */
export function verifyWebhookAuth(header: string | null): boolean {
  const secret = process.env.REVENUECAT_WEBHOOK_AUTH;
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  // timingSafeEqual throws on length mismatch — guard first (length is not secret).
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
```

(The `PRODUCT_ID_TO_SKU`, `skuForProductId`, `platformForStore`, `GRANT_EVENTS`, `REVOKE_EVENTS` exports in this file are unchanged.)

- [ ] **Step 3: Verify** — `npm run test --workspace apps/web -- revenuecat` → PASS (existing 5 cases + the new one). The webhook route test must also still pass: `npm run test --workspace apps/web -- revenuecat-webhook`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/server/revenuecat.ts apps/web/src/test/revenuecat.test.ts
git commit -m "feat(web): constant-time RevenueCat webhook auth compare"
```

---

## Task 6: Full gate

- [ ] **Step 1:** `npm run check` → all workspace tests pass + `build:web` succeeds.
- [ ] **Step 2:** Live-check the dev server: Standings tab, a ThroneSheet, and the rating flow render with no console errors (screenshot the Standings/ThroneSheet if a signed-in state is available).
- [ ] **Step 3 (if fixups needed):** commit.

## Done criteria
- `npm run check` green.
- Standings rows and ThroneSheet raters show each user's equipped banner; the rating-submit moment shows the current user's banner striking.
- Webhook auth is constant-time.
- No changes to mobile (deferred) and no migration (reuses `users.equipped`).
