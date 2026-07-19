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
