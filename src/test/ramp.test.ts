import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { influenceEvents } from "@/db/schema";
import { submitRating } from "@/lib/server/ratings";
import { confirmThrone } from "@/lib/server/thrones";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

describe("new-account influence ramp", () => {
  beforeEach(resetDb);

  it("halves (rounded up) a new account's first verified rating: 5 + 8 not 10 + 15", async () => {
    const newbie = await makeUser({ joinedAt: new Date() });
    const throne = await makeThrone(newbie.id);
    const result = await submitRating(newbie, { throneId: throne.id, verdict: 5, tags: [], verified: true });

    expect(result.influence).toBe(13); // 5 + 8
    const events = await db.select().from(influenceEvents);
    expect(events.map((e) => e.points).sort((a, b) => a - b)).toEqual([5, 8]); // ledger stores ramped values
  });

  it("ramps confirmation awards by each earner's own account age", async () => {
    const oldAdder = await makeUser();
    const newConfirmer = await makeUser({ houseId: "bidet", joinedAt: new Date() });
    const throne = await makeThrone(oldAdder.id, { status: "rumored" });
    await confirmThrone(newConfirmer, throne.id);

    const events = await db.select().from(influenceEvents);
    const adderAward = events.find((e) => e.reason === "new_throne");
    const confirmAward = events.find((e) => e.reason === "confirmation");
    expect(adderAward?.points).toBe(25); // established adder: full
    expect(confirmAward?.points).toBe(2); // new confirmer: ceil(3 * 0.5)
  });
});
