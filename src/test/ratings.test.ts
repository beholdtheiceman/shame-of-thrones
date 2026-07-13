import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { influenceEvents, ratings } from "@/db/schema";
import { mePayload } from "@/lib/server/profile";
import { submitRating } from "@/lib/server/ratings";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

const HOUR = 3_600_000;

describe("submitRating", () => {
  beforeEach(resetDb);

  it("awards 10+15 for a first verified rating and grants the badge", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const result = await submitRating(user, { throneId: throne.id, verdict: 5, tags: ["Clean"], verified: true });

    expect(result).toMatchObject({ influence: 25, firstOfName: true, updated: false });
    const events = await db.select().from(influenceEvents);
    expect(events.map((e) => e.points).sort()).toEqual([10, 15]);
    const me = await mePayload(user.id);
    expect(me.profile.badges).toContain("first_of_their_name");
  });

  it("awards 2 for hearsay, no first bonus after someone else rated", async () => {
    const alice = await makeUser();
    const bob = await makeUser({ houseId: "bidet" });
    const throne = await makeThrone(alice.id);
    await submitRating(alice, { throneId: throne.id, verdict: 4, tags: [], verified: true });
    const result = await submitRating(bob, { throneId: throne.id, verdict: 2, tags: [], verified: false });
    expect(result.influence).toBe(2);
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
    await submitRating(alice, { throneId: throne.id, verdict: 3, tags: [], verified: false }, t0); // 2+15=17 flush
    const result = await submitRating(bob, { throneId: throne.id, verdict: 3, tags: [], verified: true }, t0 + HOUR); // 10 bidet — no flip
    expect(result.flipped).toBe(false);

    const carol = await makeUser({ houseId: "bidet", displayName: `Carol-${Math.random().toString(36).slice(2, 8)}` });
    const flip = await submitRating(carol, { throneId: throne.id, verdict: 3, tags: [], verified: true }, t0 + 2 * HOUR); // bidet 20 > 17
    expect(flip.flipped).toBe(true);
  });

  it("404s on an unknown throne", async () => {
    const user = await makeUser();
    await expect(
      submitRating(user, { throneId: "00000000-0000-0000-0000-000000000000", verdict: 3, tags: [], verified: true })
    ).rejects.toThrow(/no such throne/);
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
