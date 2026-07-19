import { beforeEach, describe, expect, it } from "vitest";
import { createProfile, mePayload, ProfileError, switchHouse } from "@/lib/server/profile";
import { grantEntitlement, setEquipped } from "@/lib/server/entitlements";
import { resetDb } from "./db";
import { makeUser } from "./fixtures";

const DAY = 86_400_000;

describe("profiles", () => {
  beforeEach(resetDb);

  it("creates a profile and rejects duplicate display names", async () => {
    await createProfile("g-1", "Larry", "plunger");
    await expect(createProfile("g-2", "Larry", "flush")).rejects.toThrow(ProfileError);
  });

  it("allows one house switch, blocks the second within 56 days", async () => {
    const user = await makeUser({ houseId: "flush" });
    const now = Date.now();
    await switchHouse(user.id, "bidet", now);
    await expect(switchHouse(user.id, "porcelain", now + DAY)).rejects.toThrow(/season/);
    // after the window, allowed again
    await expect(switchHouse(user.id, "porcelain", now + 57 * DAY)).resolves.toBeDefined();
  });

  it("mePayload reports rank from lifetime xp", async () => {
    const user = await makeUser();
    const me = await mePayload(user.id);
    expect(me.rank.name).toBe("Peasant");
    expect(me.profile.name).toBe(user.displayName);
  });

  it("mePayload reports owned + equipped cosmetics", async () => {
    const user = await makeUser();
    let me = await mePayload(user.id);
    expect(me.cosmetics).toEqual({ owned: [], equipped: {} });

    await grantEntitlement({ userId: user.id, sku: "banner.gilded", source: "grant", platform: "admin" });
    await setEquipped(user.id, "banner_style", "banner.gilded");

    me = await mePayload(user.id);
    expect(me.cosmetics).toEqual({ owned: ["banner.gilded"], equipped: { banner_style: "banner.gilded" } });
  });

  it("mePayload includes the user's own id (for RevenueCat appUserID)", async () => {
    const user = await makeUser();
    const me = await mePayload(user.id);
    expect(me.profile?.id).toBe(user.id);
  });
});
