import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { ratings, reviewQueue } from "@/db/schema";
import { enforceHardCeiling, evaluateSignals, RateLimitError } from "@/lib/server/signals";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

const HOUR = 3_600_000;

async function makeRating(userId: string, throneId: string, at: number, verified = true) {
  const [row] = await db.insert(ratings).values({
    throneId, userId, verdict: 3, tags: [], verified, createdAt: new Date(at),
  }).returning();
  return row;
}

describe("enforceHardCeiling", () => {
  beforeEach(resetDb);

  it("allows the 30th write and rejects the 31st", async () => {
    const user = await makeUser();
    const adder = await makeUser(); // throne owned by someone else — charting counts as a write
    const throne = await makeThrone(adder.id);
    const now = Date.now();
    for (let i = 0; i < 29; i++) await makeRating(user.id, throne.id, now - i * 60_000);
    await expect(enforceHardCeiling(user.id, now)).resolves.toBeUndefined(); // 29 exist → 30th ok
    await makeRating(user.id, throne.id, now);
    await expect(enforceHardCeiling(user.id, now)).rejects.toBeInstanceOf(RateLimitError); // 30 exist → 31st blocked
  });

  it("ignores writes older than an hour", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const now = Date.now();
    for (let i = 0; i < 40; i++) await makeRating(user.id, throne.id, now - 2 * HOUR);
    await expect(enforceHardCeiling(user.id, now)).resolves.toBeUndefined();
  });
});

describe("evaluateSignals", () => {
  beforeEach(resetDb);

  it("returns null and writes nothing for a clean established-account rating", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const now = Date.now();
    const rating = await makeRating(user.id, throne.id, now);
    const row = await evaluateSignals(
      { kind: "rating", subjectId: rating.id, user, rating: { id: rating.id, verified: true, createdAt: now, throne } },
      now
    );
    expect(row).toBeNull();
    expect(await db.select().from(reviewQueue)).toHaveLength(0);
  });

  it("flags a new account at low severity", async () => {
    const user = await makeUser({ joinedAt: new Date() });
    const throne = await makeThrone(user.id);
    const now = Date.now();
    const rating = await makeRating(user.id, throne.id, now);
    const row = await evaluateSignals(
      { kind: "rating", subjectId: rating.id, user, rating: { id: rating.id, verified: true, createdAt: now, throne } },
      now
    );
    expect(row).toMatchObject({ kind: "rating", severity: "low" });
    expect(row!.signals.map((s) => s.signal)).toEqual(["new_account"]);
  });

  it("flags impossible travel at high severity from throne coords + timestamps", async () => {
    const user = await makeUser();
    const nyc = await makeThrone(user.id); // fixture is 40.746,-73.9895
    const la = await makeThrone(user.id, { name: "LA Throne", lat: 34.05, lng: -118.24 });
    const now = Date.now();
    await makeRating(user.id, nyc.id, now - 10 * 60_000); // verified in NYC 10 min ago
    const rating = await makeRating(user.id, la.id, now);  // now verified in LA → ~24,000 km/h
    const row = await evaluateSignals(
      { kind: "rating", subjectId: rating.id, user, rating: { id: rating.id, verified: true, createdAt: now, throne: la } },
      now
    );
    expect(row!.severity).toBe("high");
    const travel = row!.signals.find((s) => s.signal === "impossible_travel");
    expect(travel).toMatchObject({ fromThroneId: nyc.id });
    expect((travel as { kmh: number }).kmh).toBeGreaterThan(150);
  });

  it("does not check travel for hearsay ratings", async () => {
    const user = await makeUser();
    const nyc = await makeThrone(user.id);
    const la = await makeThrone(user.id, { name: "LA", lat: 34.05, lng: -118.24 });
    const now = Date.now();
    await makeRating(user.id, nyc.id, now - 10 * 60_000);
    const rating = await makeRating(user.id, la.id, now, false); // hearsay
    const row = await evaluateSignals(
      { kind: "rating", subjectId: rating.id, user, rating: { id: rating.id, verified: false, createdAt: now, throne: la } },
      now
    );
    expect(row).toBeNull();
  });

  it("always queues a new throne (low), merging with rate_soft (medium wins)", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const now = Date.now();
    for (let i = 0; i < 13; i++) await makeRating(user.id, throne.id, now - i * 60_000); // >12 writes/hr
    const row = await evaluateSignals({ kind: "new_throne", subjectId: throne.id, user }, now);
    expect(row!.severity).toBe("medium");
    expect(row!.signals.map((s) => s.signal).sort()).toEqual(["new_throne", "rate_soft"]);
  });
});
