import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { influenceEvents, notifications, ratings, users } from "@/db/schema";
import { fiefIdForCoords } from "@sot/core";
import { mePayload } from "@/lib/server/profile";
import { submitRating } from "@/lib/server/ratings";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

const HOUR = 3_600_000;

describe("submitRating", () => {
  beforeEach(resetDb);

  it("awards 10+15 for a first verified rating and grants the badge (no blessing on an empty Realm)", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const result = await submitRating(user, { throneId: throne.id, verdict: 5, tags: ["Clean"], verified: true });

    expect(result).toMatchObject({ influence: 25, firstOfName: true, updated: false, blessed: false });
    const events = await db.select().from(influenceEvents);
    expect(events.map((e) => e.points).sort((a, b) => a - b)).toEqual([10, 15]);
    const me = await mePayload(user.id);
    expect(me.profile.badges).toContain("first_of_their_name");
  });

  it("awards blessed 3 for hearsay, no first bonus after someone else rated", async () => {
    const alice = await makeUser();
    const bob = await makeUser({ houseId: "bidet" });
    const throne = await makeThrone(alice.id);
    await submitRating(alice, { throneId: throne.id, verdict: 4, tags: [], verified: true });
    const result = await submitRating(bob, { throneId: throne.id, verdict: 2, tags: [], verified: false });
    expect(result.influence).toBe(3);
    expect(result.blessed).toBe(true);
    expect(result.firstOfName).toBe(false);
  });

  it("a repeat within 24h updates the rating and awards nothing", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const t0 = Date.now();
    await submitRating(user, { throneId: throne.id, verdict: 5, tags: [], verified: true }, t0);
    const result = await submitRating(user, { throneId: throne.id, verdict: 1, tags: [], verified: true }, t0 + HOUR);

    expect(result.updated).toBe(true);
    expect(result.influence).toBe(0);
    const rows = await db.select().from(ratings);
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe(1);
  });

  it("a repeat after 24h stacks a new rating with influence", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const t0 = Date.now();
    await submitRating(user, { throneId: throne.id, verdict: 5, tags: [], verified: true }, t0);
    const result = await submitRating(user, { throneId: throne.id, verdict: 4, tags: [], verified: true }, t0 + 25 * HOUR);

    expect(result.updated).toBe(false);
    expect(result.influence).toBe(10);
    expect(await db.select().from(ratings)).toHaveLength(2);
  });

  it("detects a fief flip", async () => {
    const alice = await makeUser({ houseId: "flush" });
    const bob = await makeUser({ houseId: "bidet" });
    const throne = await makeThrone(alice.id);
    const t0 = Date.now();
    await submitRating(alice, { throneId: throne.id, verdict: 3, tags: [], verified: false }, t0); // 2+15=17 flush (empty Realm → unblessed)
    const result = await submitRating(bob, { throneId: throne.id, verdict: 3, tags: [], verified: true }, t0 + HOUR); // bidet 0% → blessed 13 — no flip (17>13)
    expect(result.flipped).toBe(false);

    const carol = await makeUser({ houseId: "bidet", displayName: `Carol-${Math.random().toString(36).slice(2, 8)}` });
    const flip = await submitRating(carol, { throneId: throne.id, verdict: 3, tags: [], verified: true }, t0 + 2 * HOUR); // bidet ~43% → unblessed 10 → bidet 23 > 17
    expect(flip.flipped).toBe(true);
  });

  it("notifies losing-House contributors on a flip, honors prefs, and dedupes within 24h", async () => {
    const alice = await makeUser({ houseId: "flush" });
    const optedOut = await makeUser({
      houseId: "flush",
      notifyPrefs: { contested: true, banner_fallen: false, season_start: true },
    });
    const bob = await makeUser({ houseId: "bidet" });
    const carol = await makeUser({ houseId: "bidet" });
    const throne = await makeThrone(alice.id);
    const fiefId = fiefIdForCoords(throne.lat, throne.lng);
    const t0 = Date.now();

    await db.insert(influenceEvents).values({
      fiefId, houseId: "flush", userId: optedOut.id, points: 1,
      reason: "rating", throneId: throne.id, createdAt: new Date(t0),
    });
    await submitRating(alice, { throneId: throne.id, verdict: 3, tags: [], verified: false }, t0);
    await submitRating(bob, { throneId: throne.id, verdict: 3, tags: [], verified: true }, t0 + HOUR);
    const firstFlip = await submitRating(
      carol,
      { throneId: throne.id, verdict: 3, tags: [], verified: true },
      t0 + 2 * HOUR
    );
    expect(firstFlip.flipped).toBe(true);

    let rows = await db.select().from(notifications);
    expect(rows.filter((row) => row.category === "banner_fallen").map((row) => row.userId)).toEqual([alice.id]);

    // Put flush narrowly back in front without a rating trigger, then let bidet
    // flip the fief again. Alice's same category/fief row is still inside 24h.
    await db.insert(influenceEvents).values({
      fiefId, houseId: "flush", userId: alice.id, points: 10,
      reason: "rating", throneId: throne.id, createdAt: new Date(t0 + 2.5 * HOUR),
    });
    const dan = await makeUser({ houseId: "bidet" });
    const secondFlip = await submitRating(
      dan,
      { throneId: throne.id, verdict: 3, tags: [], verified: true },
      t0 + 3 * HOUR
    );
    expect(secondFlip.flipped).toBe(true);

    rows = await db.select().from(notifications);
    expect(rows.filter((row) => row.category === "banner_fallen").map((row) => row.userId)).toEqual([alice.id]);
    const [outUser] = await db.select().from(users).where(eq(users.id, optedOut.id));
    expect(outUser.notifyPrefs.banner_fallen).toBe(false);
  });

  it("404s on an unknown throne", async () => {
    const user = await makeUser();
    await expect(
      submitRating(user, { throneId: "00000000-0000-0000-0000-000000000000", verdict: 3, tags: [], verified: true })
    ).rejects.toThrow(/no such throne/);
  });

  it("applies the Underdog Blessing when the House is below the share threshold", async () => {
    // Pile Realm influence onto bidet so flush sits well under 15% share.
    const bidet = await makeUser({ houseId: "bidet" });
    for (let i = 0; i < 6; i++) {
      const t = await makeThrone(bidet.id);
      await submitRating(bidet, { throneId: t.id, verdict: 5, tags: [], verified: true });
    }
    const flush = await makeUser({ houseId: "flush" });
    const throne = await makeThrone(flush.id);
    const result = await submitRating(flush, { throneId: throne.id, verdict: 4, tags: [], verified: true });

    // First rating on a fresh throne: base 10 + first bonus 15, each ×1.25 → 13 + 19 = 32.
    expect(result.blessed).toBe(true);
    expect(result.influence).toBe(Math.ceil(10 * 1.25) + Math.ceil(15 * 1.25));
  });

  it("does not bless a House at or above the threshold", async () => {
    const flush = await makeUser({ houseId: "flush" });
    const throne = await makeThrone(flush.id);
    // Seed one flush rating so the Realm isn't empty; the second rating then sees
    // flush holding ~100% share (not an underdog).
    await submitRating(flush, { throneId: throne.id, verdict: 5, tags: [], verified: true });
    const throne2 = await makeThrone(flush.id);
    const result = await submitRating(flush, { throneId: throne2.id, verdict: 5, tags: [], verified: true });
    expect(result.blessed).toBe(false);
  });
});

import { vi } from "vitest";
vi.mock("@/auth", () => ({ auth: vi.fn() }));
import { auth } from "@/auth";
import { POST as ratingsPOST } from "@/app/api/ratings/route";

describe("POST /api/ratings authz", () => {
  it("401s without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const res = await ratingsPOST(new Request("http://test/api/ratings", {
      method: "POST",
      body: JSON.stringify({ throneId: "00000000-0000-0000-0000-000000000000", verdict: 3, tags: [], verified: true }),
    }));
    expect(res.status).toBe(401);
  });
});
