import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { metricsEvents } from "@/db/schema";
import { resetDb } from "./db";
import { makeUser } from "./fixtures";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
import { auth } from "@/auth";
import { GET as metricsGET } from "@/app/api/metrics/route";
import { POST as eventPOST } from "@/app/api/metrics/event/route";

function post(path: string, body: unknown) {
  return new Request(`http://test${path}`, { method: "POST", body: JSON.stringify(body) });
}

describe("GET /api/metrics", () => {
  beforeEach(resetDb);

  it("403s a non-moderator", async () => {
    const user = await makeUser({ role: "user" });
    vi.mocked(auth).mockResolvedValue({ googleSubject: user.googleSubject } as never);
    const res = await metricsGET();
    expect(res.status).toBe(403);
  });

  it("403s an anonymous visitor", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const res = await metricsGET();
    expect(res.status).toBe(403);
  });

  it("returns the payload for a moderator", async () => {
    const mod = await makeUser({ role: "moderator" });
    vi.mocked(auth).mockResolvedValue({ googleSubject: mod.googleSubject } as never);
    const res = await metricsGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("verifiedRatingsPerThronePerMonth");
    expect(body).toHaveProperty("nwtSuccessRate");
    expect(body).toHaveProperty("generatedAt");
  });
});

describe("POST /api/metrics/event", () => {
  beforeEach(resetDb);

  it("400s an unknown event name", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const res = await eventPOST(post("/api/metrics/event", { name: "bogus", meta: {} }));
    expect(res.status).toBe(400);
    expect(await db.select().from(metricsEvents)).toHaveLength(0);
  });

  it("records a time_to_rate event for an authed user", async () => {
    const user = await makeUser();
    vi.mocked(auth).mockResolvedValue({ googleSubject: user.googleSubject } as never);
    const res = await eventPOST(post("/api/metrics/event", { name: "time_to_rate", meta: { ms: 1234 } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const rows = await db.select().from(metricsEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "time_to_rate", userId: user.id, meta: { ms: 1234 } });
  });

  it("records an anonymous nwt_outcome event with null userId", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const res = await eventPOST(post("/api/metrics/event", { name: "nwt_outcome", meta: { success: false } }));
    expect(res.status).toBe(200);
    const rows = await db.select().from(metricsEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBeNull();
  });
});
