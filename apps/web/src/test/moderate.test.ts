import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { ratings, reviewQueue, thrones, users } from "@/db/schema";
import { submitBirthDate } from "@/lib/server/ageGate";
import { submitRating } from "@/lib/server/ratings";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
import { auth } from "@/auth";
import { POST as moderatePOST } from "@/app/api/moderate/route";
import { POST as thronesPOST } from "@/app/api/thrones/route";

function post(body: unknown) {
  return new Request("http://test/api/moderate", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/moderate", () => {
  beforeEach(resetDb);

  it("404s for non-moderators", async () => {
    const pleb = await makeUser();
    vi.mocked(auth).mockResolvedValue({ googleSubject: pleb.googleSubject } as never);
    const res = await moderatePOST(post({ action: "ban_user", subjectId: pleb.id }));
    expect(res.status).toBe(404);
  });

  it("hide_throne + reviewId auto-resolves the queue row with a prefixed note", async () => {
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    const [q] = await db.insert(reviewQueue).values({
      kind: "new_throne", subjectId: throne.id, userId: adder.id,
      signals: [{ signal: "new_throne" }], severity: "low",
    }).returning();
    const mod = await makeUser({ role: "moderator" });
    vi.mocked(auth).mockResolvedValue({ googleSubject: mod.googleSubject } as never);

    const res = await moderatePOST(post({ action: "hide_throne", subjectId: throne.id, reviewId: q.id, note: "private garage" }));
    expect(res.status).toBe(200);
    const [t] = await db.select().from(thrones).where(eq(thrones.id, throne.id));
    expect(t.hiddenAt).not.toBeNull();
    const [resolved] = await db.select().from(reviewQueue).where(eq(reviewQueue.id, q.id));
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolutionNote).toBe("[hide_throne] private garage");
  });

  it("suspend_user defaults to 7 days; ban_user and reinstate_user round-trip", async () => {
    const target = await makeUser();
    const mod = await makeUser({ role: "moderator" });
    vi.mocked(auth).mockResolvedValue({ googleSubject: mod.googleSubject } as never);

    await moderatePOST(post({ action: "suspend_user", subjectId: target.id }));
    let [u] = await db.select().from(users).where(eq(users.id, target.id));
    expect(u.suspendedUntil).not.toBeNull();

    await moderatePOST(post({ action: "ban_user", subjectId: target.id }));
    [u] = await db.select().from(users).where(eq(users.id, target.id));
    expect(u.bannedAt).not.toBeNull();

    await moderatePOST(post({ action: "reinstate_user", subjectId: target.id }));
    [u] = await db.select().from(users).where(eq(users.id, target.id));
    expect(u.bannedAt).toBeNull();
    expect(u.suspendedUntil).toBeNull();
  });

  it("hide_testimony via API", async () => {
    const rater = await makeUser();
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    const r = await submitRating(rater, { throneId: throne.id, verdict: 3, tags: [], verified: true, testimony: "meh" });
    const mod = await makeUser({ role: "moderator" });
    vi.mocked(auth).mockResolvedValue({ googleSubject: mod.googleSubject } as never);
    const res = await moderatePOST(post({ action: "hide_testimony", subjectId: r.ratingId }));
    expect(res.status).toBe(200);
    const [row] = await db.select().from(ratings).where(eq(ratings.id, r.ratingId));
    expect(row.testimonyHiddenAt).not.toBeNull();
  });
});

describe("standing gates on write routes", () => {
  beforeEach(resetDb);

  it("banned user gets 403 banished from add-throne", async () => {
    const user = await makeUser({ bannedAt: new Date() });
    await submitBirthDate(user.googleSubject, "1990-01-01");
    vi.mocked(auth).mockResolvedValue({ googleSubject: user.googleSubject } as never);
    const res = await thronesPOST(new Request("http://test/api/thrones", {
      method: "POST",
      body: JSON.stringify({
        name: "Banned's Privy", lat: 40.7, lng: -73.9, category: "cafe",
        amenities: { accessible: false, babyChanging: false, genderNeutral: false, freeAccess: true, open24h: false },
        publicAccessAttested: true,
      }),
    }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("banished");
  });
});
