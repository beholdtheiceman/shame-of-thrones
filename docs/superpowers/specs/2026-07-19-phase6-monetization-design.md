# Phase 6 — Monetization (cosmetics + Maester's Pass) — Design

**Date:** 2026-07-19
**Status:** Approved (brainstorming). Next: implementation plan.
**Roadmap note:** Roadmap Phase 6 was scoped "design only, don't build yet." Owner
explicitly elected to **design + build with payments** this cycle. This spec covers
the whole monetization system; the build is **staged**, and Milestone 1 is the only
part with a full implementation plan to follow immediately.

---

## 1. Goal & decisions

Introduce the app's first revenue: **cosmetic** purchases and a seasonal
**Maester's Pass**, without ever selling gameplay advantage.

Locked decisions (from brainstorming):

| Decision | Choice |
|---|---|
| Scope | Design the full system; **build in stages**, starting with a real purchase flow |
| Payment rail | **RevenueCat + native IAP** (StoreKit / Play Billing); web/Stripe deferred |
| Flagship cosmetic | **Banner styles** — first category built end-to-end |
| Model | **Direct USD pricing, à la carte** — no virtual currency, no loot boxes |
| Build order | **M1** = entitlement backbone + banner styles à la carte. **M2** = Maester's Pass |

---

## 2. Guardrails (PRD §5.10 — enforced invariants)

These are brand-integrity constraints, not preferences. Each is enforced, not just documented:

1. **Utility is never paywalled; competitive advantage is never sold.** No cosmetic or
   purchase may grant Influence, rank, or any gameplay edge.
2. **No purchase UI in the crisis path** — the panic-button / Nearest-Worthy-Throne flow
   never shows a store, upsell, or ad.
3. **No virtual currency, loot boxes, or randomized rewards.** Every item has a plain USD
   price and is bought directly.
4. **Purchases grant cosmetic entitlements only** — nothing else is ever written from the
   purchase path.

**Guardrail test (M1, required):** a unit test asserts (a) no cosmetic SKU maps to any
`influence_reason`, and (b) the entitlement-granting path writes zero rows to
`influence_events`. This test is the machine-checkable form of invariants 1 & 4.

---

## 3. Architecture

Mirrors the existing three layers.

### 3.1 `@sot/core` (pure, shared, vitest-covered)

New module `packages/core/src/cosmetics.ts`:

```ts
export type CosmeticCategory =
  | "banner_style" | "map_theme" | "profile_sigil" | "rating_stamp";

export interface Cosmetic {
  sku: string;              // stable id, e.g. "banner.dragonscale"
  category: CosmeticCategory;
  name: string;             // "Dragonscale Banner"
  description: string;
  priceUsd: number;         // display price; store is source of truth for charged price
  art: string;              // render token the clients map to an asset/style
}

export const COSMETICS: Cosmetic[];          // catalog (M1: banner_style SKUs only)
export function cosmeticBySku(sku: string): Cosmetic | undefined;

// Equipped selection: one active cosmetic per category slot.
export type Equipped = Partial<Record<CosmeticCategory, string /* sku */>>;

// Pure helpers (no I/O):
export function ownedCosmetics(entitlementSkus: string[]): Cosmetic[];
export function equippedFor(equipped: Equipped, category: CosmeticCategory): Cosmetic | undefined;
export function canEquip(sku: string, ownedSkus: string[]): boolean; // owned && exists
export function normalizeEquipped(equipped: Equipped, ownedSkus: string[]): Equipped; // drop unowned/stale
```

Catalog scaffolding for `map_theme` / `profile_sigil` / `rating_stamp` may be defined as
types but **carry no purchasable SKUs in M1**.

Extend `MeDTO` (`packages/core/src/dto.ts`):

```ts
export interface MeDTO {
  // ...existing (profile, rank, streak, ageGate)...
  cosmetics?: {
    owned: string[];       // entitlement SKUs
    equipped: Equipped;    // normalized against owned
  };
}
```

### 3.2 `apps/web` (server = source of truth)

**Migration `0010`** (`db:generate`, then applied to BOTH the test Neon branch and prod —
see the test-DB memory note):

- `entitlements` table:
  - `id uuid pk`
  - `userId uuid notNull → users.id`
  - `sku text notNull`
  - `source text notNull` — `"purchase" | "grant" | "pass"` (enum `entitlement_source`)
  - `platform text` — `"ios" | "android" | "admin"` (nullable)
  - `storeTxnId text unique` — store transaction id; **nullable** (admin grants have none),
    **unique** so webhook retries are idempotent
  - `createdAt timestamptz notNull default now()`
  - `revokedAt timestamptz` — nullable (refund/chargeback revocation; item hidden when set)
  - Indexes: `entitlements_user_idx (userId)`; partial unique `entitlements_user_sku_active`
    on `(userId, sku) where revokedAt is null` (a user owns a given SKU at most once).
- `users.equipped jsonb notNull default '{}'` — the `Equipped` selection (mirrors
  `notifyPrefs` / `badges` jsonb pattern).

**RevenueCat webhook — authoritative** `POST /api/revenuecat/webhook`:
- Verify the RevenueCat `Authorization` header against a server secret env var
  (`REVENUECAT_WEBHOOK_AUTH`). Reject mismatches (401), fail-closed.
- Handle `INITIAL_PURCHASE` and `NON_RENEWING_PURCHASE` events. Map RevenueCat
  `product_id` → our `sku` via a server-side map (`productIdToSku`).
- Idempotent upsert into `entitlements` keyed on `storeTxnId` (RevenueCat
  `event.transaction_id`). Duplicate deliveries no-op.
- Handle `REFUND` / `CANCELLATION` events by setting `revokedAt` (item disappears from
  the user's owned set; equipped selection re-normalizes on next read).
- Writes only to `entitlements` — **never** `influence_events`.

**Equip route** `POST /api/cosmetics/equip { category, sku | null }`:
- Auth required. Validates `canEquip(sku, ownedSkus)` server-side (ownership is not
  client-trusted). `sku: null` clears the slot. Persists to `users.equipped`.

**`mePayload`** extended to attach `cosmetics: { owned, equipped }`, where `owned` =
active (non-revoked) entitlement SKUs and `equipped` = `normalizeEquipped(...)`.

> **Client sync note:** the mobile client, after a successful RevenueCat purchase, may
> optimistically show the item and call `mePayload` to refresh — but the **webhook** is
> the source of truth. If the webhook hasn't landed yet, ownership simply appears on the
> next refresh. No client-asserted ownership is ever persisted.

### 3.3 `apps/mobile` + `apps/web` (UI)

- **Treasury** store screen (both apps): lists `banner_style` cosmetics with name,
  price, and owned/equip state.
  - **Mobile:** purchase via RevenueCat SDK (`react-native-purchases`) → StoreKit / Play
    sheet. Includes a **Restore Purchases** action (RevenueCat `restorePurchases`).
  - **Web (M1):** gallery + **equip only** for already-owned items; purchase CTA says the
    item is bought in the app. (Web/Stripe purchasing is deferred.)
- **Banner rendering (see §4).**
- The Treasury entry point lives in Profile/settings, **never** in the rating or
  crisis/NWT flow (guardrail 2).

---

## 4. Where a premium Banner style renders

Fiefs fly the **House** banner (shared territory) — a *personal* banner style cannot
"win" a fief without ambiguous ownership. So a purchased banner style personalizes the
user's **own** heraldic banner wherever they appear **as an individual**:

- **Profile** (their banner motif)
- Their **Small Council / Standings row**
- Their entries in the **ThroneSheet** rating list ("recent ratings")
- Their **rating-submitted strike** animation (the dopamine moment)

Fief territory banners stay House-plain. This keeps banner styles socially visible
(Standings and throne detail are public) with zero ownership conflict.

**Deferred enhancement (not built):** skinning a fief's banner with the top seasonal
contributor's style. Noted for a future pass; out of scope here.

Rendering mechanics: a banner style resolves from the user's `equipped.banner_style` SKU
to an `art` token; each client maps the token to a concrete banner treatment (a styled
SVG/overlay on web, a styled component on mobile) layered over the House `colorVar`. No
custom Mapbox style work (that's the deferred `map_theme` category).

---

## 5. Purchase data flow (M1)

```
mobile Treasury
  → RevenueCat SDK purchase(offering)
    → Apple / Google processes payment
      → RevenueCat server → POST /api/revenuecat/webhook  (AUTHORITATIVE)
          verify auth → productId→sku → idempotent upsert entitlements(storeTxnId)
  → client refreshes mePayload → item shows as owned
  → user equips (POST /api/cosmetics/equip, ownership-gated)
  → banner renders on Profile / Standings / ThroneSheet / strike
```

Restore path: `restorePurchases()` → RevenueCat customerInfo → entitlements reconciled
(already present in our DB from the original webhook; RevenueCat remains the backstop).

---

## 6. Milestone 2 — Maester's Pass (designed now, built after M1)

Built on the same entitlement backbone; **no schema churn expected** beyond a
season-progress read model.

- **Structure:** free track + paid track, `$4.99`/season, over the existing
  `seasonWindow(now)` (56-day epochs). One **non-renewing** purchase per season.
- **Progression signal:** cosmetic-only — Pass levels derive from **verified ratings +
  confirmations in the current season** (already tracked in `influence_events` /
  `ratings`). Because rewards are purely cosmetic, this creates no data-integrity
  pressure (consistent with §2).
- **Unlock semantics:** buying the Pass grants the paid-track cosmetics for every level
  the user has already reached (retroactive) and every level reached afterward, for that
  season. Entitlements written with `source='pass'`.
- **Reward pool:** draws from all cosmetic categories (banner styles, sigils, map themes,
  rating stamps) as those categories come online.
- **UI:** a Pass track screen showing free vs paid tiers and current level; entry point
  in Profile, never in the crisis path.

Full M2 design details (tier count, per-tier rewards, exact level thresholds) are
finalized in M2's own plan; this section fixes the shape and the invariants.

---

## 7. Testing

- **`@sot/core` (vitest):** catalog integrity, `ownedCosmetics`, `equippedFor`,
  `canEquip`, `normalizeEquipped` (including dropping unowned/stale equips).
- **`apps/web`:** webhook idempotency (duplicate `storeTxnId` no-ops), auth rejection,
  refund → `revokedAt`, ownership-gated equip (equip of an unowned SKU rejected).
- **Guardrail test (§2):** no SKU maps to an influence reason; entitlement path writes no
  `influence_events`.

---

## 8. Out of scope this cycle (YAGNI)

- Web / Stripe purchasing (native IAP only for M1).
- Purchasable SKUs for `map_theme`, `profile_sigil`, `rating_stamp` (catalog scaffolding
  only; no art, no store listings).
- Virtual currency, gifting, bundles, discounts/sales.
- Fief-banner skinning by top contributor (deferred enhancement, §4).

---

## 9. Owner / ops dependencies (before M1 can go live)

These are external, owner-gated, and do **not** block writing code or tests:

1. **RevenueCat project** + API keys; App Store Connect & Play Console products created
   for each banner SKU (`productIdToSku` map depends on these ids).
2. **Env vars:** `REVENUECAT_WEBHOOK_AUTH` (server), RevenueCat public SDK keys (clients).
3. **Migration `0010`** applied to the test Neon branch **and** prod (see test-DB memory).
4. Banner-style **art tokens** finalized (names/assets for the initial SKUs).
