import { beforeEach, describe, expect, it, vi } from "vitest";

// The real session module imports "@/auth" (next-auth), which this vitest
// environment cannot resolve ("next/server" vs "next/server.js"). A factory
// mock (rather than vi.spyOn on the real export, and rather than a
// factory-less vi.mock which still auto-introspects the real module) keeps
// that import chain from ever loading. See existing precedent:
// invites-route.test.ts, moderate.test.ts mock "@/auth" for the same reason.
vi.mock("@/lib/server/session", () => ({ sessionInfo: vi.fn() }));

import { POST as equipPOST } from "@/app/api/cosmetics/equip/route";
import { POST as grantPOST } from "@/app/api/cosmetics/grant/route";
import { grantEntitlement, ownedSkus } from "@/lib/server/entitlements";
import * as session from "@/lib/server/session";
import { resetDb } from "./db";
import { makeUser } from "./fixtures";

beforeEach(resetDb);

function req(body: unknown) {
  return new Request("http://t", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function asUser(user: Awaited<ReturnType<typeof makeUser>>) {
  vi.mocked(session.sessionInfo).mockResolvedValue({ kind: "user", user });
}

describe("POST /api/cosmetics/equip", () => {
  it("401s when not signed in", async () => {
    vi.mocked(session.sessionInfo).mockResolvedValue({ kind: "anonymous" });
    expect((await equipPOST(req({ category: "banner_style", sku: "banner.gilded" }))).status).toBe(401);
  });

  it("403s when equipping an unowned sku", async () => {
    const user = await makeUser();
    asUser(user);
    expect((await equipPOST(req({ category: "banner_style", sku: "banner.gilded" }))).status).toBe(403);
  });

  it("equips an owned sku", async () => {
    const user = await makeUser();
    await grantEntitlement({ userId: user.id, sku: "banner.gilded", source: "grant", platform: "admin" });
    asUser(user);
    const res = await equipPOST(req({ category: "banner_style", sku: "banner.gilded" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ equipped: { banner_style: "banner.gilded" } });
  });

  it("rejects a bad category", async () => {
    const user = await makeUser();
    asUser(user);
    expect((await equipPOST(req({ category: "wings", sku: null }))).status).toBe(400);
  });
});

describe("POST /api/cosmetics/grant (moderator)", () => {
  it("403s for non-moderators", async () => {
    const user = await makeUser({ role: "user" });
    asUser(user);
    expect((await grantPOST(req({ userId: user.id, sku: "banner.gilded" }))).status).toBe(403);
  });

  it("grants to a target user when called by a moderator", async () => {
    const mod = await makeUser({ role: "moderator" });
    const target = await makeUser();
    asUser(mod);
    const res = await grantPOST(req({ userId: target.id, sku: "banner.gilded" }));
    expect(res.status).toBe(201);
    expect(await ownedSkus(target.id)).toEqual(["banner.gilded"]);
  });

  it("rejects an unknown sku", async () => {
    const mod = await makeUser({ role: "moderator" });
    asUser(mod);
    expect((await grantPOST(req({ userId: mod.id, sku: "banner.ghost" }))).status).toBe(400);
  });
});
