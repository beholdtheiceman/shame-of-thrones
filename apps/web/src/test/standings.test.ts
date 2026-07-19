import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { influenceEvents } from "@/db/schema";
import { grantEntitlement, setEquipped } from "@/lib/server/entitlements";
import { standingsPayload } from "@/lib/server/standings";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

describe("standingsPayload", () => {
  beforeEach(resetDb);

  it("stamps each council row with the user's equipped banner_style", async () => {
    const user = await makeUser({ displayName: "Ser Banner" });
    await grantEntitlement({ userId: user.id, sku: "banner.gilded", source: "grant", platform: "admin" });
    await setEquipped(user.id, "banner_style", "banner.gilded");
    const throne = await makeThrone(user.id);
    // Give the user some influence so they appear on the council.
    await db.insert(influenceEvents).values({
      userId: user.id, houseId: user.houseId, fiefId: "f1", reason: "rating", points: 10, throneId: throne.id,
    });

    const payload = await standingsPayload({ window: "all", house: null, viewerName: null });
    const row = payload.council.rows.find((r) => r.name === "Ser Banner");
    expect(row?.bannerStyle).toBe("banner.gilded");
  });
});
