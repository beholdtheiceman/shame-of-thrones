import { beforeEach, describe, expect, it } from "vitest";
import { banUser, reinstateUser, requireGoodStanding, StandingError, suspendUser } from "@/lib/server/standing";
import { resetDb } from "./db";
import { makeUser } from "./fixtures";

const DAY = 86_400_000;

describe("standing", () => {
  beforeEach(resetDb);

  it("clean users pass", async () => {
    const user = await makeUser();
    expect(() => requireGoodStanding(user)).not.toThrow();
  });

  it("banned users throw banished", async () => {
    const user = await makeUser();
    const banned = await banUser(user.id);
    try {
      requireGoodStanding(banned);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(StandingError);
      expect((e as StandingError).code).toBe("banished");
    }
  });

  it("suspension blocks until the date, then expires", async () => {
    const user = await makeUser();
    const now = Date.now();
    const suspended = await suspendUser(user.id, 7, now);
    expect(suspended.suspendedUntil!.getTime()).toBe(now + 7 * DAY);
    expect(() => requireGoodStanding(suspended, now + 6 * DAY)).toThrow(StandingError);
    expect(() => requireGoodStanding(suspended, now + 8 * DAY)).not.toThrow();
  });

  it("reinstate clears both levers", async () => {
    const user = await makeUser();
    await suspendUser(user.id, 30);
    await banUser(user.id);
    const clean = await reinstateUser(user.id);
    expect(clean.suspendedUntil).toBeNull();
    expect(clean.bannedAt).toBeNull();
    expect(() => requireGoodStanding(clean)).not.toThrow();
  });
});
