import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { ratings, reviewQueue } from "@/db/schema";
import { submitBirthDate } from "@/lib/server/ageGate";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/server/testimonyScreen", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server/testimonyScreen")>();
  return { ...mod, screenTestimony: vi.fn(mod.screenTestimony) };
});
import { auth } from "@/auth";
import { screenTestimony } from "@/lib/server/testimonyScreen";
import { POST as ratingsPOST } from "@/app/api/ratings/route";

function post(body: unknown) {
  return new Request("http://test/api/ratings", { method: "POST", body: JSON.stringify(body) });
}

async function attestedUser(overrides = {}) {
  const user = await makeUser(overrides);
  await submitBirthDate(user.googleSubject, "1990-01-01");
  vi.mocked(auth).mockResolvedValue({ googleSubject: user.googleSubject } as never);
  return user;
}

describe("testimony wiring", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(screenTestimony).mockReset();
  });

  it("allowed testimony persists with no queue row", async () => {
    const user = await attestedUser();
    const throne = await makeThrone(user.id);
    vi.mocked(screenTestimony).mockResolvedValue({ verdict: "allow", note: "fine" });
    const res = await ratingsPOST(post({ throneId: throne.id, verdict: 4, tags: [], verified: true, testimony: "a noble seat" }));
    expect(res.status).toBe(201);
    const [row] = await db.select().from(ratings);
    expect(row.testimony).toBe("a noble seat");
    const queue = await db.select().from(reviewQueue);
    expect(queue.filter((q) => q.kind === "testimony")).toHaveLength(0);
  });

  it("blocked testimony: rating posts WITHOUT text; high queue row carries category, never the text", async () => {
    const user = await attestedUser();
    const throne = await makeThrone(user.id);
    vi.mocked(screenTestimony).mockResolvedValue({ verdict: "block", category: "doxxing", note: "address disclosed" });
    const res = await ratingsPOST(post({ throneId: throne.id, verdict: 2, tags: [], verified: true, testimony: "clerk Dave lives at 12 Elm St" }));
    expect(res.status).toBe(201);
    expect((await res.json()).testimonyBlocked).toBe(true);
    const [row] = await db.select().from(ratings);
    expect(row.testimony).toBeNull();
    const [q] = (await db.select().from(reviewQueue)).filter((r) => r.kind === "testimony");
    expect(q.severity).toBe("high");
    expect(q.aiAssessment).toBe("address disclosed");
    expect(JSON.stringify(q.signals)).not.toContain("Elm St");
  });

  it("flagged testimony persists AND queues at medium with the pre-filled note", async () => {
    const user = await attestedUser();
    const throne = await makeThrone(user.id);
    vi.mocked(screenTestimony).mockResolvedValue({ verdict: "flag", category: "harassment", note: "targets an individual" });
    const res = await ratingsPOST(post({ throneId: throne.id, verdict: 1, tags: [], verified: true, testimony: "the day janitor is a troll" }));
    expect(res.status).toBe(201);
    const [row] = await db.select().from(ratings);
    expect(row.testimony).toBe("the day janitor is a troll");
    const [q] = (await db.select().from(reviewQueue)).filter((r) => r.kind === "testimony");
    expect(q.severity).toBe("medium");
    expect(q.aiAssessment).toBe("targets an individual");
    expect(q.aiTriagedAt).not.toBeNull();
  });

  it("screen_unavailable fails open: text persists, queue row pending triage", async () => {
    const user = await attestedUser();
    const throne = await makeThrone(user.id);
    vi.mocked(screenTestimony).mockResolvedValue({ verdict: "flag", category: "screen_unavailable", note: "Screen unavailable: api down" });
    await ratingsPOST(post({ throneId: throne.id, verdict: 3, tags: [], verified: true, testimony: "fine" }));
    const [q] = (await db.select().from(reviewQueue)).filter((r) => r.kind === "testimony");
    expect(q.signals).toEqual([{ signal: "screen_unavailable" }]);
    expect(q.aiTriagedAt).toBeNull(); // real triage still owed
  });

  it("empty testimony never calls the screen", async () => {
    const user = await attestedUser();
    const throne = await makeThrone(user.id);
    await ratingsPOST(post({ throneId: throne.id, verdict: 4, tags: [], verified: true }));
    expect(vi.mocked(screenTestimony)).not.toHaveBeenCalled();
  });

  it("24h update path screens too: blocked update keeps the old text", async () => {
    const user = await attestedUser();
    const throne = await makeThrone(user.id);
    vi.mocked(screenTestimony).mockResolvedValue({ verdict: "allow", note: "fine" });
    await ratingsPOST(post({ throneId: throne.id, verdict: 4, tags: [], verified: true, testimony: "original take" }));
    vi.mocked(screenTestimony).mockResolvedValue({ verdict: "block", category: "slur", note: "slur present" });
    const res = await ratingsPOST(post({ throneId: throne.id, verdict: 2, tags: [], verified: true, testimony: "something vile" }));
    expect(res.status).toBe(200);
    expect((await res.json()).testimonyBlocked).toBe(true);
    const [row] = await db.select().from(ratings);
    expect(row.testimony).toBe("original take");
  });
});
