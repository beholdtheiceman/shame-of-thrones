import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { resetDb } from "./db";
import { makeUser } from "./fixtures";

const secret = () => new TextEncoder().encode(process.env.NATIVE_JWT_SECRET);
async function bearer(googleSubject: string, opts?: { expInPast?: boolean }) {
  const t = new SignJWT({ googleSubject })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt();
  t.setExpirationTime(opts?.expInPast ? Math.floor(Date.now() / 1000) - 60 : "30d");
  return t.sign(secret());
}

async function loadSessionInfoWith(authHeader: string | null) {
  vi.resetModules();
  vi.doMock("next/headers", () => ({
    headers: async () => new Headers(authHeader ? { authorization: authHeader } : {}),
  }));
  vi.doMock("@/auth", () => ({ auth: async () => null }));
  return (await import("@/lib/server/session")).sessionInfo;
}

describe("sessionInfo bearer branch", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("resolves a valid bearer to the matching user", async () => {
    const sub = "google-sub-bearer-1";
    await makeUser({ googleSubject: sub });
    const sessionInfo = await loadSessionInfoWith(`Bearer ${await bearer(sub)}`);
    expect((await sessionInfo()).kind).toBe("user");
  });

  it("falls through to anonymous on an expired bearer", async () => {
    const sessionInfo = await loadSessionInfoWith(`Bearer ${await bearer("x", { expInPast: true })}`);
    expect((await sessionInfo()).kind).toBe("anonymous");
  });

  it("falls through to anonymous on a tampered bearer", async () => {
    const sessionInfo = await loadSessionInfoWith(`Bearer ${(await bearer("x")).slice(0, -3)}aaa`);
    expect((await sessionInfo()).kind).toBe("anonymous");
  });
});
