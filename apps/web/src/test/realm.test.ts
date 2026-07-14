import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { influenceEvents, ratings } from "@/db/schema";
import { realmPayload } from "@/lib/server/realm";
import { fiefIdForCoords } from "@sot/core";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

describe("realmPayload", () => {
  beforeEach(resetDb);

  it("returns thrones with computed scores and fief control", async () => {
    const user = await makeUser({ houseId: "bidet" });
    const throne = await makeThrone(user.id);
    await db.insert(ratings).values({
      throneId: throne.id, userId: user.id, verdict: 4, tags: ["Clean"], verified: true,
    });
    const fiefId = fiefIdForCoords(throne.lat, throne.lng);
    await db.insert(influenceEvents).values({
      fiefId, houseId: "bidet", userId: user.id, points: 10, reason: "rating", throneId: throne.id,
    });

    const payload = await realmPayload();

    expect(payload.thrones).toHaveLength(1);
    expect(payload.thrones[0].score).toBeCloseTo(4, 5);
    expect(payload.thrones[0].fiefId).toBe(fiefId);
    expect(payload.ratings[0].authorName).toBe(user.displayName);
    expect(payload.fiefs).toHaveLength(1);
    expect(payload.fiefs[0].leader?.houseId).toBe("bidet");
  });

  it("returns empty collections on an empty realm", async () => {
    const payload = await realmPayload();
    expect(payload.thrones).toEqual([]);
    expect(payload.fiefs).toEqual([]);
  });
});
