import { timingSafeEqual } from "node:crypto";

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
 * dashboard. Constant-time compare; fails closed when the secret is unset. */
export function verifyWebhookAuth(header: string | null): boolean {
  const secret = process.env.REVENUECAT_WEBHOOK_AUTH;
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  // timingSafeEqual throws on length mismatch — guard first (length is not secret).
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
