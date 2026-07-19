import { beforeEach, describe, expect, it } from "vitest";
import { hideRating, hideTestimony, hideThrone } from "@/lib/server/enforcement";
import { grantEntitlement, setEquipped } from "@/lib/server/entitlements";
import { mePayload } from "@/lib/server/profile";
import { realmPayload } from "@/lib/server/realm";
import { RatingError, submitRating } from "@/lib/server/ratings";
import { confirmThrone, ThroneError } from "@/lib/server/thrones";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

describe("realm filtering of hidden content", () => {
  beforeEach(resetDb);

  it("hidden thrones and their ratings vanish; writes against them 404", async () => {
    const adder = await makeUser();
    const rater = await makeUser({ houseId: "bidet" });
    const throne = await makeThrone(adder.id);
    await submitRating(rater, { throneId: throne.id, verdict: 4, tags: [], verified: true });

    const mod = await makeUser({ role: "moderator" });
    await hideThrone(throne.id, mod);

    const realm = await realmPayload();
    expect(realm.thrones.find((t) => t.id === throne.id)).toBeUndefined();
    expect(realm.ratings.filter((r) => r.throneId === throne.id)).toHaveLength(0);

    await expect(
      submitRating(rater, { throneId: throne.id, verdict: 3, tags: [], verified: false })
    ).rejects.toThrow(RatingError);
    const confirmer = await makeUser({ houseId: "plunger" });
    await expect(confirmThrone(confirmer, throne.id)).rejects.toThrow(ThroneError);
  });

  it("hidden ratings drop out of the score; stricken testimony masks to empty", async () => {
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    const r1 = await makeUser({ houseId: "bidet" });
    const r2 = await makeUser({ houseId: "plunger" });
    const bad = await submitRating(r1, { throneId: throne.id, verdict: 1, tags: [], verified: true, testimony: "vile" });
    await submitRating(r2, { throneId: throne.id, verdict: 5, tags: [], verified: true, testimony: "splendid" });

    const mod = await makeUser({ role: "moderator" });
    await hideRating(bad.ratingId, mod);

    const realm = await realmPayload();
    const dto = realm.thrones.find((t) => t.id === throne.id)!;
    expect(dto.ratingCount).toBe(1);
    expect(dto.score).toBe(5);

    const visible = realm.ratings.filter((r) => r.throneId === throne.id);
    expect(visible).toHaveLength(1);
    expect(visible[0].testimony).toBe("splendid");

    await hideTestimony(visible[0].id, mod);
    const realm2 = await realmPayload();
    expect(realm2.ratings.find((r) => r.id === visible[0].id)!.testimony).toBe("");
  });

  it("rank XP clamps at zero after reversals", async () => {
    const rater = await makeUser({ joinedAt: new Date() }); // ramped newbie
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    const res = await submitRating(rater, { throneId: throne.id, verdict: 5, tags: [], verified: true });
    const mod = await makeUser({ role: "moderator" });
    await hideRating(res.ratingId, mod);
    const me = await mePayload(rater.id);
    expect(me.rank.xp).toBe(0);
    expect(me.rank.name).toBe("Peasant");
  });

  it("stamps a rating with the rater's equipped banner_style", async () => {
    const rater = await makeUser();
    await grantEntitlement({ userId: rater.id, sku: "banner.gilded", source: "grant", platform: "admin" });
    await setEquipped(rater.id, "banner_style", "banner.gilded");
    const throne = await makeThrone(rater.id);
    await submitRating(rater, { throneId: throne.id, verdict: 4, tags: [], verified: true });

    const realm = await realmPayload();
    const dto = realm.ratings.find((r) => r.throneId === throne.id)!;
    expect(dto.bannerStyle).toBe("banner.gilded");
  });
});
