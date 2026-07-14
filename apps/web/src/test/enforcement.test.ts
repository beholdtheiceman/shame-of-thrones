import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { influenceEvents, ledgerEntries, ratings, thrones } from "@/db/schema";
import { EnforcementError, hideRating, hideTestimony, hideThrone } from "@/lib/server/enforcement";
import { submitRating } from "@/lib/server/ratings";
import { fiefControl } from "@sot/core";
import { toGameEvent } from "@/lib/server/mappers";
import { fiefIdForCoords } from "@sot/core";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

const DAY = 86_400_000;

async function fiefTotal(fiefId: string, now: number) {
  const rows = await db.select().from(influenceEvents);
  return fiefControl(fiefId, rows.map(toGameEvent), now).totalInfluence;
}

describe("hideRating reversal math", () => {
  beforeEach(resetDb);

  it("returns fief control to zero at any later time (decay cancels)", async () => {
    const user = await makeUser();
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    const fiefId = fiefIdForCoords(throne.lat, throne.lng);
    const t0 = Date.now();

    const result = await submitRating(user, { throneId: throne.id, verdict: 5, tags: [], verified: true }, t0);
    expect(await fiefTotal(fiefId, t0)).toBeGreaterThan(0);

    const mod = await makeUser({ role: "moderator" });
    await hideRating(result.ratingId, mod, t0 + DAY);

    expect(await fiefTotal(fiefId, t0 + DAY)).toBeCloseTo(0, 10);
    expect(await fiefTotal(fiefId, t0 + 10 * DAY)).toBeCloseTo(0, 10);

    const [hidden] = await db.select().from(ratings).where(eq(ratings.id, result.ratingId));
    expect(hidden.hiddenAt).not.toBeNull();
  });

  it("double-hide 409s and never double-reverses", async () => {
    const user = await makeUser();
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    const t0 = Date.now();
    const result = await submitRating(user, { throneId: throne.id, verdict: 4, tags: [], verified: true }, t0);
    const mod = await makeUser({ role: "moderator" });
    await hideRating(result.ratingId, mod);
    await expect(hideRating(result.ratingId, mod)).rejects.toMatchObject({ status: 409 });
    const reversals = (await db.select().from(influenceEvents)).filter((e) => e.reason === "reversal");
    expect(reversals).toHaveLength(2); // rating event + first-of-name bonus, once each
  });
});

describe("hideThrone", () => {
  beforeEach(resetDb);

  it("cancels ALL the throne's events, skipping already-reversed ratings", async () => {
    const rater = await makeUser();
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    const fiefId = fiefIdForCoords(throne.lat, throne.lng);
    const t0 = Date.now();
    const r1 = await submitRating(rater, { throneId: throne.id, verdict: 5, tags: [], verified: true }, t0);
    const rater2 = await makeUser({ houseId: "bidet" });
    await submitRating(rater2, { throneId: throne.id, verdict: 2, tags: [], verified: false }, t0 + 1000);

    const mod = await makeUser({ role: "moderator" });
    await hideRating(r1.ratingId, mod, t0 + 2000); // one rating already taken down
    await hideThrone(throne.id, mod, t0 + 3000);   // then the whole throne

    expect(await fiefTotal(fiefId, t0 + 5 * DAY)).toBeCloseTo(0, 10);

    const [hidden] = await db.select().from(thrones).where(eq(thrones.id, throne.id));
    expect(hidden.hiddenAt).not.toBeNull();
    const ledger = await db.select().from(ledgerEntries);
    expect(ledger.some((l) => l.text.includes("strike") && l.text.includes(throne.name))).toBe(true);
  });

  it("404s a missing throne and 409s an already-hidden one", async () => {
    const mod = await makeUser({ role: "moderator" });
    await expect(hideThrone("00000000-0000-0000-0000-000000000001", mod)).rejects.toBeInstanceOf(EnforcementError);
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    await hideThrone(throne.id, mod);
    await expect(hideThrone(throne.id, mod)).rejects.toMatchObject({ status: 409 });
  });
});

describe("hideTestimony", () => {
  beforeEach(resetDb);

  it("strikes only the text — influence and rating stand", async () => {
    const user = await makeUser();
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    const fiefId = fiefIdForCoords(throne.lat, throne.lng);
    const t0 = Date.now();
    const result = await submitRating(user, { throneId: throne.id, verdict: 5, tags: [], verified: true, testimony: "a throne most foul" }, t0);
    const before = await fiefTotal(fiefId, t0);

    const mod = await makeUser({ role: "moderator" });
    await hideTestimony(result.ratingId, mod);

    expect(await fiefTotal(fiefId, t0)).toBeCloseTo(before, 10);
    const [row] = await db.select().from(ratings).where(eq(ratings.id, result.ratingId));
    expect(row.testimonyHiddenAt).not.toBeNull();
    expect(row.hiddenAt).toBeNull();
    expect(row.testimony).toBe("a throne most foul"); // text kept for audit, masked at serve time
  });
});
