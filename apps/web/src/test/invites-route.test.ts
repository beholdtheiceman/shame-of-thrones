import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { invites } from "@/db/schema";
import { resetDb } from "./db";
import { makeUser } from "./fixtures";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
import { auth } from "@/auth";
import { GET as invitesGET, POST as invitesPOST } from "@/app/api/invites/route";

function post(body: unknown) {
  return new Request("http://test/api/invites", { method: "POST", body: JSON.stringify(body) });
}
function get(qs = "") {
  return new Request(`http://test/api/invites${qs}`, { method: "GET" });
}

describe("/api/invites admin routes", () => {
  beforeEach(resetDb);

  it("403s a non-moderator on POST", async () => {
    const user = await makeUser({ role: "user" });
    vi.mocked(auth).mockResolvedValue({ googleSubject: user.googleSubject } as never);
    const res = await invitesPOST(post({ cohort: "brooklyn", count: 3 }));
    expect(res.status).toBe(403);
  });

  it("403s a non-moderator on GET", async () => {
    const user = await makeUser({ role: "user" });
    vi.mocked(auth).mockResolvedValue({ googleSubject: user.googleSubject } as never);
    const res = await invitesGET(get());
    expect(res.status).toBe(403);
  });

  it("403s an anonymous visitor", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await invitesPOST(post({ cohort: "x", count: 1 }))).status).toBe(403);
    expect((await invitesGET(get())).status).toBe(403);
  });

  it("moderator generates codes and they persist, clamped to 500", async () => {
    const mod = await makeUser({ role: "moderator" });
    vi.mocked(auth).mockResolvedValue({ googleSubject: mod.googleSubject } as never);
    const res = await invitesPOST(post({ cohort: "queens", count: 3 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.codes).toHaveLength(3);
    expect(body.codes[0]).toMatch(/^SOT-/);
    expect(await db.select().from(invites)).toHaveLength(3);
  });

  it("400s a missing cohort", async () => {
    const mod = await makeUser({ role: "moderator" });
    vi.mocked(auth).mockResolvedValue({ googleSubject: mod.googleSubject } as never);
    expect((await invitesPOST(post({ count: 3 }))).status).toBe(400);
  });

  it("GET reports counts and honors ?cohort=", async () => {
    const mod = await makeUser({ role: "moderator" });
    vi.mocked(auth).mockResolvedValue({ googleSubject: mod.googleSubject } as never);
    await invitesPOST(post({ cohort: "queens", count: 2 }));
    await invitesPOST(post({ cohort: "brooklyn", count: 1 }));

    const all = await (await invitesGET(get())).json();
    expect(all.total).toBe(3);
    expect(all.redeemed).toBe(0);
    expect(all.remaining).toBe(3);

    const queens = await (await invitesGET(get("?cohort=queens"))).json();
    expect(queens.total).toBe(2);
    expect(queens.invites.every((i: { cohort: string }) => i.cohort === "queens")).toBe(true);
  });
});
