import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { reviewQueue } from "@/db/schema";
import { listReview, resolveReview } from "@/lib/server/review";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
import { auth } from "@/auth";
import { GET as reviewGET } from "@/app/api/review/route";

async function makeItem(userId: string, subjectId: string, overrides: Partial<typeof reviewQueue.$inferInsert> = {}) {
  const [row] = await db.insert(reviewQueue).values({
    kind: "new_throne", subjectId, userId,
    signals: [{ signal: "new_throne" }], severity: "low", ...overrides,
  }).returning();
  return row;
}

describe("review queue server lib", () => {
  beforeEach(resetDb);

  it("lists pending items with actor name and subject summary", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id, { name: "Sketchy Cellar" });
    await makeItem(user.id, throne.id);
    const items = await listReview();
    expect(items).toHaveLength(1);
    expect(items[0].actor).toBe(user.displayName);
    expect(items[0].subject).toContain("Sketchy Cellar");
    expect(items[0].status).toBe("pending");
  });

  it("resolveReview stamps moderator, time, and note", async () => {
    const user = await makeUser();
    const mod = await makeUser({ role: "moderator" });
    const throne = await makeThrone(user.id);
    const item = await makeItem(user.id, throne.id);
    await resolveReview(item.id, mod.id, "benign — verified venue on street view");

    const [row] = await db.select().from(reviewQueue).where(eq(reviewQueue.id, item.id));
    expect(row.status).toBe("resolved");
    expect(row.resolvedBy).toBe(mod.id);
    expect(row.resolutionNote).toContain("street view");
    expect(row.resolvedAt).not.toBeNull();
  });
});

describe("GET /api/review authz", () => {
  beforeEach(resetDb);

  it("404s for anonymous and for non-moderators", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await reviewGET()).status).toBe(404);

    const pleb = await makeUser();
    vi.mocked(auth).mockResolvedValue({ googleSubject: pleb.googleSubject } as never);
    expect((await reviewGET()).status).toBe(404);
  });

  it("200s for a moderator", async () => {
    const mod = await makeUser({ role: "moderator" });
    vi.mocked(auth).mockResolvedValue({ googleSubject: mod.googleSubject } as never);
    const res = await reviewGET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });
});
