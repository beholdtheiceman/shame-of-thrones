import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { influenceEvents } from "@/db/schema";
import { addThrone, confirmThrone, ThroneError } from "@/lib/server/thrones";
import { resetDb } from "./db";
import { makeUser } from "./fixtures";

const AMENITIES = { accessible: false, babyChanging: false, genderNeutral: false, freeAccess: true, open24h: false };

describe("thrones", () => {
  beforeEach(resetDb);

  it("addThrone creates a rumored throne and grants no influence yet", async () => {
    const user = await makeUser();
    const throne = await addThrone(user, { name: "New Privy", lat: 40.75, lng: -73.99, category: "park", amenities: AMENITIES });
    expect(throne.status).toBe("rumored");
    expect(await db.select().from(influenceEvents)).toHaveLength(0);
  });

  it("the adder cannot confirm their own throne", async () => {
    const user = await makeUser();
    const throne = await addThrone(user, { name: "Selfie Privy", lat: 40.75, lng: -73.99, category: "park", amenities: AMENITIES });
    await expect(confirmThrone(user, throne.id)).rejects.toThrow(ThroneError);
    await expect(confirmThrone(user, throne.id)).rejects.toThrow(/second traveler/);
  });

  it("a second user confirms: verified, 25 to adder's house, 3 to confirmer", async () => {
    const adder = await makeUser({ houseId: "flush" });
    const confirmer = await makeUser({ houseId: "bidet" });
    const throne = await addThrone(adder, { name: "Real Privy", lat: 40.75, lng: -73.99, category: "transit", amenities: AMENITIES });

    const updated = await confirmThrone(confirmer, throne.id);
    expect(updated.status).toBe("verified");

    const events = await db.select().from(influenceEvents);
    const byReason = Object.fromEntries(events.map((e) => [e.reason, e]));
    expect(byReason.new_throne).toMatchObject({ points: 25, houseId: "flush", userId: adder.id });
    expect(byReason.confirmation).toMatchObject({ points: 3, houseId: "bidet", userId: confirmer.id });
  });

  it("confirming twice 409s", async () => {
    const adder = await makeUser();
    const c1 = await makeUser();
    const c2 = await makeUser();
    const throne = await addThrone(adder, { name: "Popular Privy", lat: 40.75, lng: -73.99, category: "cafe", amenities: AMENITIES });
    await confirmThrone(c1, throne.id);
    await expect(confirmThrone(c2, throne.id)).rejects.toThrow(/already confirmed/);
  });
});
