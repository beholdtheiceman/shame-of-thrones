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
