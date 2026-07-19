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
