import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { invites, users } from "@/db/schema";
import { createProfile, ProfileError } from "@/lib/server/profile";
import { resetDb } from "./db";
import { makeUser } from "./fixtures";

async function makeInvite(createdBy: string, code: string, cohort = "brooklyn") {
  const [row] = await db.insert(invites).values({ code, cohort, createdBy }).returning();
  return row;
}

describe("createProfile beta gate", () => {
  beforeEach(resetDb);
  afterEach(() => {
    delete process.env.BETA_INVITE_REQUIRED;
  });

  it("flag off: creates a profile with no invite and null cohort", async () => {
    delete process.env.BETA_INVITE_REQUIRED;
    const user = await createProfile("g-open", "OpenSignup", "flush");
    expect(user.cohort).toBeNull();
  });

  it("flag on, missing code: rejects with 403", async () => {
    process.env.BETA_INVITE_REQUIRED = "true";
    await expect(createProfile("g-1", "NoCode", "flush")).rejects.toMatchObject({ status: 403 });
  });

  it("flag on, unknown code: rejects with 403", async () => {
    process.env.BETA_INVITE_REQUIRED = "true";
    await expect(createProfile("g-2", "BadCode", "flush", "SOT-XXXX-XXXX")).rejects.toMatchObject({ status: 403 });
  });

  it("flag on, valid code: creates user with cohort and marks invite redeemed", async () => {
    process.env.BETA_INVITE_REQUIRED = "true";
    const inviter = await makeUser({ role: "moderator" });
    const invite = await makeInvite(inviter.id, "SOT-GOOD-CODE", "queens");

    const user = await createProfile("g-3", "GoodCode", "bidet", "SOT-GOOD-CODE");
    expect(user.cohort).toBe("queens");

    const [redeemed] = await db.select().from(invites).where(eq(invites.id, invite.id));
    expect(redeemed.redeemedBy).toBe(user.id);
    expect(redeemed.redeemedAt).not.toBeNull();
  });

  it("flag on, already-redeemed code: rejects with 403 (not found among unredeemed)", async () => {
    process.env.BETA_INVITE_REQUIRED = "true";
    const inviter = await makeUser({ role: "moderator" });
    await makeInvite(inviter.id, "SOT-ONCE-ONLY", "brooklyn");

    await createProfile("g-4", "FirstUser", "flush", "SOT-ONCE-ONLY");
    // second attempt with the same (now redeemed) code
    await expect(createProfile("g-5", "SecondUser", "flush", "SOT-ONCE-ONLY")).rejects.toMatchObject({
      status: 403,
    });
    // only the first user got the cohort
    const withCohort = await db.select().from(users).where(eq(users.cohort, "brooklyn"));
    expect(withCohort).toHaveLength(1);
  });

  it("throws ProfileError specifically", async () => {
    process.env.BETA_INVITE_REQUIRED = "true";
    await expect(createProfile("g-6", "NoCode2", "flush")).rejects.toBeInstanceOf(ProfileError);
  });
});
