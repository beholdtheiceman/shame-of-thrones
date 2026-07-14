import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { ratings, reviewQueue } from "@/db/schema";
import { submitBirthDate } from "@/lib/server/ageGate";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
import { auth } from "@/auth";
import { POST as ratingsPOST } from "@/app/api/ratings/route";
import { POST as thronesPOST } from "@/app/api/thrones/route";

const AMENITIES = { accessible: false, babyChanging: false, genderNeutral: false, freeAccess: true, open24h: false };

function post(path: string, body: unknown) {
  return new Request(`http://test${path}`, { method: "POST", body: JSON.stringify(body) });
}

describe("write-route hardening", () => {
  beforeEach(resetDb);

  it("403s a rating with age_gate_required when unattested", async () => {
    const user = await makeUser();
    vi.mocked(auth).mockResolvedValue({ googleSubject: user.googleSubject } as never);
    const throne = await makeThrone(user.id);
    const res = await ratingsPOST(post("/api/ratings", { throneId: throne.id, verdict: 4, tags: [], verified: true }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("age_gate_required");
  });

  it("accepts an attested user's rating and queues nothing for a clean write", async () => {
    const user = await makeUser();
    await submitBirthDate(user.googleSubject, "1990-01-01");
    vi.mocked(auth).mockResolvedValue({ googleSubject: user.googleSubject } as never);
    const throne = await makeThrone(user.id);
    const res = await ratingsPOST(post("/api/ratings", { throneId: throne.id, verdict: 4, tags: [], verified: true }));
    expect(res.status).toBe(201);
    expect(await db.select().from(reviewQueue)).toHaveLength(0);
  });

  it("flags but does not reject a new account's rating", async () => {
    const newbie = await makeUser({ joinedAt: new Date() });
    await submitBirthDate(newbie.googleSubject, "1990-01-01");
    vi.mocked(auth).mockResolvedValue({ googleSubject: newbie.googleSubject } as never);
    const throne = await makeThrone(newbie.id);
    const res = await ratingsPOST(post("/api/ratings", { throneId: throne.id, verdict: 4, tags: [], verified: true }));
    expect(res.status).toBe(201); // action went through — Larry's rule
    const queue = await db.select().from(reviewQueue);
    expect(queue).toHaveLength(1);
    expect(queue[0].signals.map((s) => s.signal)).toContain("new_account");
  });

  it("429s the 31st write in an hour", async () => {
    const user = await makeUser();
    await submitBirthDate(user.googleSubject, "1990-01-01");
    vi.mocked(auth).mockResolvedValue({ googleSubject: user.googleSubject } as never);
    const throne = await makeThrone(user.id);
    const now = Date.now();
    const rows = Array.from({ length: 30 }, (_, i) => ({
      throneId: throne.id, userId: user.id, verdict: 3, tags: [] as string[], verified: true,
      createdAt: new Date(now - i * 60_000),
    }));
    await db.insert(ratings).values(rows);
    const res = await ratingsPOST(post("/api/ratings", { throneId: throne.id, verdict: 4, tags: [], verified: true }));
    expect(res.status).toBe(429);
  });

  it("400s Add-a-Throne without the public-access attestation", async () => {
    const user = await makeUser();
    await submitBirthDate(user.googleSubject, "1990-01-01");
    vi.mocked(auth).mockResolvedValue({ googleSubject: user.googleSubject } as never);
    const res = await thronesPOST(post("/api/thrones", {
      name: "Somewhere", lat: 40.7, lng: -73.9, category: "cafe", amenities: AMENITIES,
    }));
    expect(res.status).toBe(400);
  });

  it("queues every attested new throne at low severity", async () => {
    const user = await makeUser();
    await submitBirthDate(user.googleSubject, "1990-01-01");
    vi.mocked(auth).mockResolvedValue({ googleSubject: user.googleSubject } as never);
    const res = await thronesPOST(post("/api/thrones", {
      name: "Corner Cafe Restroom", lat: 40.7, lng: -73.9, category: "cafe",
      amenities: AMENITIES, publicAccessAttested: true,
    }));
    expect(res.status).toBe(201);
    const queue = await db.select().from(reviewQueue);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ kind: "new_throne", severity: "low" });
  });
});
