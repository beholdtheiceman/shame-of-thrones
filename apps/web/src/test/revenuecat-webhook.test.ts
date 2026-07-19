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
