# Phase 6 · Milestone 1b (mobile) — RevenueCat purchase UI (staged) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Add the on-device cosmetics purchase flow to `apps/mobile` — a Treasury screen that buys banner styles through RevenueCat native IAP and equips owned ones — so it's ready to go live the moment the owner provisions RevenueCat. Plus the small **server** change that exposes the user's own id (RevenueCat's `appUserID` must equal `users.id`).

**Architecture:** Server-side entitlement path already exists (webhook → entitlements → mePayload). Mobile only (a) tells RevenueCat who the user is (`Purchases.logIn(users.id)`), (b) triggers a purchase (product id ↔ our sku), and (c) reads `owned`/`equipped` back from `mePayload` and equips via the existing `POST /api/cosmetics/equip`. Mirrors the web `Treasury`/store wiring.

**Tech Stack:** Expo SDK 57, React Native 0.86, React Navigation (bottom tabs), `react-native-purchases`, `@sot/core`, vitest (server only). Base branch: `main`. Work branch: `feat/phase6-m1b-mobile`.

**⚠️ Verification ceiling:** The mobile purchase flow CANNOT be run/verified in this environment (needs a RevenueCat project + App Store/Play products + an EAS dev build — Expo Go can't load the native module). Gate for mobile = TypeScript typecheck only. Only **Task 1 (server)** has a runnable test. Everything is written **fail-safe**: if the RevenueCat key is unset, purchase code no-ops so the app still runs.

**Owner deps to go live (not blocking this code):** RevenueCat project + iOS/Android public SDK keys (`EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `_ANDROID_KEY`); App Store Connect / Play Console products `sot_banner_dragonscale` / `sot_banner_gilded` / `sot_banner_obsidian`; RevenueCat webhook → `/api/revenuecat/webhook` + `REVENUECAT_WEBHOOK_AUTH`.

**Out of scope (separate later item):** rendering other users' banners on the mobile Standings/rating surfaces (mobile parity with M1b-web render). This plan is the *purchase* flow + equipping your own banner.

---

## Task 1: Server — expose the user's own id in `mePayload`

**Files:**
- Modify: `packages/core/src/dto.ts`
- Modify: `apps/web/src/lib/server/profile.ts`
- Test: `apps/web/src/test/profile.test.ts`

- [ ] **Step 1: Add the failing test case** — in `apps/web/src/test/profile.test.ts`, inside `describe("profiles", ...)`:

```ts
  it("mePayload includes the user's own id (for RevenueCat appUserID)", async () => {
    const user = await makeUser();
    const me = await mePayload(user.id);
    expect(me.profile?.id).toBe(user.id);
  });
```

- [ ] **Step 2: Run — expect FAIL** — `npm run test --workspace apps/web -- profile` (`profile.id` is undefined / type error).

- [ ] **Step 3: Extend `MeDTO.profile`** — in `packages/core/src/dto.ts`, add `id: string;` as the FIRST field of the `profile` object type:

```ts
export interface MeDTO {
  profile: {
    id: string;
    name: string; houseId: HouseId; joinedAt: number;
    badges: string[]; notifyPrefs: NotifyPrefsDTO; lastHouseSwitchAt: number | null;
  } | null;
  rank?: RankInfo;
  streak?: { weeks: number; thisWeekActive: boolean };
  ageGate?: { confirmed: boolean; locked: boolean };
  cosmetics?: { owned: string[]; equipped: Equipped };
}
```

- [ ] **Step 4: Populate it in `mePayload`** — in `apps/web/src/lib/server/profile.ts`, find where the returned `profile` object is built and add `id: user.id,` as its first field (the `user` row is already in scope; it has `.id`). Do not change other fields.

- [ ] **Step 5: Run — expect PASS** — `npm run test --workspace apps/web -- profile`. Then the full web suite: `npm run test --workspace apps/web` (the added field is optional-safe for existing assertions, but confirm nothing that deep-equals the whole profile breaks — if a test does `toEqual` on the full profile object, update it to include `id`).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/dto.ts apps/web/src/lib/server/profile.ts apps/web/src/test/profile.test.ts
git commit -m "feat(web): expose user id in mePayload profile (RevenueCat appUserID)"
```

---

## Task 2: Mobile — add `react-native-purchases` + RevenueCat config

**Files:**
- Modify: `apps/mobile/package.json` (via install)
- Modify: `apps/mobile/lib/config.ts`
- Modify: `apps/mobile/eas.json` (add env keys to all build profiles)
- Modify: `apps/mobile/.env.example` (create if absent; do NOT touch the gitignored `.env`)
- Modify: `apps/mobile/app.json` (add the RevenueCat Expo config plugin if the SDK requires one — check its install docs; `react-native-purchases` typically needs NO plugin, just autolinking, so likely leave `app.json` unchanged — confirm and note)

- [ ] **Step 1: Install the SDK** — from repo root:

```bash
npm install react-native-purchases --workspace apps/mobile
```

Confirm it lands in `apps/mobile/package.json` dependencies and the root lockfile updates. (If the install pulls a huge native toolchain or fails in this environment, STOP and report — do not force it.)

- [ ] **Step 2: Add config exports** — in `apps/mobile/lib/config.ts`, add:

```ts
export const REVENUECAT_IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? "";
export const REVENUECAT_ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? "";
```

- [ ] **Step 3: Add env keys to `eas.json`** — in each build profile's `env` block (development, preview, production) that already sets `EXPO_PUBLIC_*`, add `"EXPO_PUBLIC_REVENUECAT_IOS_KEY": ""` and `"EXPO_PUBLIC_REVENUECAT_ANDROID_KEY": ""` (empty placeholders the owner fills). Match the existing formatting.

- [ ] **Step 4: Document in `.env.example`** — add the two keys with empty values + a comment `# RevenueCat public SDK keys (owner-provisioned)`. If `.env.example` doesn't exist, create it listing all `EXPO_PUBLIC_*` keys the app reads (mirror the keys referenced in `lib/config.ts`).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/package.json apps/mobile/lib/config.ts apps/mobile/eas.json apps/mobile/.env.example package-lock.json apps/mobile/app.json
git commit -m "feat(mobile): add react-native-purchases + RevenueCat config keys"
```

---

## Task 3: Mobile — thread cosmetics + equip through the store

**Files:**
- Modify: `apps/mobile/lib/api.ts`
- Modify: `apps/mobile/lib/store.tsx`

**Context:** Mirror the web store (`apps/web/src/lib/store.tsx` `cosmetics` field + `equipCosmetic` action, and `apps/web/src/lib/api.ts` `equipCosmetic`). Read the mobile `store.tsx` and `api.ts` fully first and match their exact patterns/types.

- [ ] **Step 1: Add `equipCosmetic` to the API client** — in `apps/mobile/lib/api.ts`, next to `me:`:

```ts
  equipCosmetic: (category: string, sku: string | null) =>
    request<{ equipped: Equipped }>("/api/cosmetics/equip", {
      method: "POST",
      body: JSON.stringify({ category, sku }),
    }),
```

Import `Equipped` from `@sot/core` (add to the existing type import from `@sot/core` if there is one; else add `import type { Equipped } from "@sot/core";`).

- [ ] **Step 2: Add `cosmetics` to `StoreState`** — in `apps/mobile/lib/store.tsx`, add `cosmetics: MeDTO["cosmetics"] | null;` to the `StoreState` type (next to the existing `profile`/`rank` fields), initialise it to `null` in the initial state object, and in the `refresh()` function where `me` is mapped into state, add `cosmetics: me?.cosmetics ?? null,`.

- [ ] **Step 3: Add the `equipCosmetic` action** — mirror web `apps/web/src/lib/store.tsx:206-212`. Add to the store's context type and the returned actions:

```ts
    equipCosmetic: async (category: string, sku: string | null) => {
      const { equipped } = await api.equipCosmetic(category, sku);
      setState((s) => ({
        ...s,
        cosmetics: s.cosmetics ? { ...s.cosmetics, equipped } : { owned: [], equipped },
      }));
    },
```

(Adapt `setState`/state-update to the mobile store's actual state mechanism — match how existing mobile actions like the notification-pref or house-switch action update state.)

- [ ] **Step 4: Typecheck** — run the mobile typecheck (see Task 7 for the exact command). Expect no errors from these files.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/api.ts apps/mobile/lib/store.tsx
git commit -m "feat(mobile): thread cosmetics + equipCosmetic through the store"
```

---

## Task 4: Mobile — RevenueCat purchases service

**Files:**
- Create: `apps/mobile/lib/purchases.ts`

- [ ] **Step 1: Write the service** — `apps/mobile/lib/purchases.ts`:

```ts
import { Platform } from "react-native";
import Purchases, { type PurchasesStoreProduct } from "react-native-purchases";
import { REVENUECAT_IOS_KEY, REVENUECAT_ANDROID_KEY } from "./config";

/** RevenueCat product id -> our cosmetic sku. MUST stay in sync with the
 * server map in apps/web/src/lib/server/revenuecat.ts (PRODUCT_ID_TO_SKU). */
export const PRODUCT_ID_TO_SKU: Record<string, string> = {
  sot_banner_dragonscale: "banner.dragonscale",
  sot_banner_gilded: "banner.gilded",
  sot_banner_obsidian: "banner.obsidian",
};
const SKU_TO_PRODUCT_ID: Record<string, string> = Object.fromEntries(
  Object.entries(PRODUCT_ID_TO_SKU).map(([p, s]) => [s, p])
);

let configured = false;

/** Configure RevenueCat once. No-op (app still runs) when no key is set yet. */
export function configurePurchases(): void {
  if (configured) return;
  const apiKey = Platform.OS === "ios" ? REVENUECAT_IOS_KEY : REVENUECAT_ANDROID_KEY;
  if (!apiKey) return;
  Purchases.configure({ apiKey });
  configured = true;
}

export function purchasesReady(): boolean {
  return configured;
}

/** Associate RevenueCat's appUserID with our internal users.id (the webhook
 * matches on this). Safe to call repeatedly; non-fatal on error. */
export async function identifyUser(userId: string): Promise<void> {
  if (!configured) return;
  try {
    await Purchases.logIn(userId);
  } catch {
    // non-fatal: purchases just won't be attributed until next attempt
  }
}

/** Fetch store products for our banner skus, keyed by sku (for price display). */
export async function fetchBannerProducts(): Promise<Record<string, PurchasesStoreProduct>> {
  if (!configured) return {};
  const products = await Purchases.getProducts(Object.keys(PRODUCT_ID_TO_SKU));
  const bySku: Record<string, PurchasesStoreProduct> = {};
  for (const p of products) {
    const sku = PRODUCT_ID_TO_SKU[p.identifier];
    if (sku) bySku[sku] = p;
  }
  return bySku;
}

/** Buy the banner for `sku`. Entitlement is granted server-side by the
 * RevenueCat webhook; the caller should refresh mePayload afterwards. */
export async function purchaseSku(sku: string): Promise<void> {
  const productId = SKU_TO_PRODUCT_ID[sku];
  if (!configured || !productId) throw new Error("Purchases unavailable");
  const [product] = await Purchases.getProducts([productId]);
  if (!product) throw new Error("Product not found");
  await Purchases.purchaseStoreProduct(product);
}

export async function restorePurchases(): Promise<void> {
  if (!configured) return;
  await Purchases.restorePurchases();
}
```

(If the installed `react-native-purchases` API surface differs — e.g. `getProducts` signature or `purchaseStoreProduct` name — adjust to the SDK's actual TypeScript types, keeping the same exported function names/behaviour. Report any such adjustment.)

- [ ] **Step 2: Typecheck** — mobile typecheck passes for this file.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/lib/purchases.ts
git commit -m "feat(mobile): RevenueCat purchases service (configure/identify/buy/restore)"
```

---

## Task 5: Mobile — Treasury screen + tab

**Files:**
- Create: `apps/mobile/screens/TreasuryScreen.tsx`
- Modify: `apps/mobile/App.tsx` (register the tab)

- [ ] **Step 1: Write the screen** — port `apps/web/src/components/Treasury.tsx` to React Native, matching `apps/mobile/screens/ProfileScreen.tsx` conventions (`SafeAreaView` + `ScrollView`, `StyleSheet.create`, `COLORS`/`HOUSE_COLOR` from `apps/mobile/lib/theme.ts`, `useStore()`). Read `ProfileScreen.tsx` and `StandingsScreen.tsx` first to match styling exactly.

  Behaviour (mirror web `Treasury.tsx`):
  - `const { state, equipCosmetic, refresh } = useStore();` (pull `refresh` too — match its real name in the mobile store).
  - Guard: if `!state.profile`, render a "Swear an oath to enter the Treasury." message.
  - On mount, if `purchasesReady()`, load `fetchBannerProducts()` into local state for price strings (wrap in try/catch; empty on failure).
  - List `COSMETICS` from `@sot/core`. For each:
    - `owned = new Set(state.cosmetics?.owned ?? [])`, `equippedSku = equippedFor(state.cosmetics?.equipped ?? {}, "banner_style")?.sku`.
    - Banner visual: a small `<View>` with the house color (from the theme's `HOUSE_COLOR`/`COLORS`) as a simple native stand-in for the crest (RN has no CSS clip-path — a rounded rect swatch is fine; show the cosmetic name/art token label).
    - If owned: an "Equip"/"Equipped" button calling `equipCosmetic("banner_style", isEquipped ? null : sku)` (local busy/error state around it, like `ProfileScreen`'s handlers).
    - If not owned: a "Buy · {price}" button (price from the loaded product's `priceString`, fallback to `$${c.priceUsd.toFixed(2)}`) calling `purchaseSku(c.sku)` then `refresh()` inside try/catch; if `!purchasesReady()`, disable the button with an "Available soon" label.
  - A "Restore Purchases" button at the bottom calling `restorePurchases()` then `refresh()`.

- [ ] **Step 2: Register the tab** — in `apps/mobile/App.tsx`, import `TreasuryScreen` and add `<Tab.Screen name="Treasury" component={TreasuryScreen} />` after the `Profile` screen in the `Tab.Navigator`.

- [ ] **Step 3: Typecheck** — mobile typecheck passes.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/screens/TreasuryScreen.tsx apps/mobile/App.tsx
git commit -m "feat(mobile): Treasury screen (buy/equip/restore banners) + tab"
```

---

## Task 6: Mobile — initialise RevenueCat on app start

**Files:**
- Modify: `apps/mobile/App.tsx` (or the mobile store, wherever app-start effects + the loaded profile live)

- [ ] **Step 1: Configure on mount + identify on login.** In `App.tsx` (or a top-level effect), call `configurePurchases()` once on mount. Then, when the signed-in user's id becomes available (`state.profile?.id` from the store), call `identifyUser(state.profile.id)` in an effect keyed on that id. Match the app's existing effect patterns (how it currently triggers `refresh()` / reads the store at startup). Keep it fail-safe: both calls no-op when RevenueCat isn't configured.

- [ ] **Step 2: Typecheck** — mobile typecheck passes.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/App.tsx
git commit -m "feat(mobile): configure RevenueCat on start + identify user (appUserID)"
```

---

## Task 7: Gate

- [ ] **Step 1: Server tests** — `npm run test --workspace apps/web` and `npm run test --workspace packages/core` → all green (Task 1's change).
- [ ] **Step 2: Mobile typecheck** — determine the mobile typecheck command: check `apps/mobile/package.json` for a `typecheck`/`tsc` script; if none, run `npx tsc --noEmit -p apps/mobile/tsconfig.json` (confirm a tsconfig exists). It must pass with no errors across all new/changed mobile files. (There is no runtime test for mobile — this is the ceiling.)
- [ ] **Step 3: Web build** — `npm run build:web` → still succeeds (Task 1 touched shared `dto.ts`).
- [ ] **Step 4 (if fixups):** commit.

## Done criteria
- `mePayload` returns `profile.id` (tested green).
- Mobile typechecks with the full purchase flow present: config, purchases service, store wiring, Treasury screen + tab, RevenueCat init.
- Everything RevenueCat-related is fail-safe when keys are unset (app still runs).
- Staged for go-live once the owner provisions RevenueCat (see owner deps at top).
