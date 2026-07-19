import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { influenceEvents, invites, ledgerEntries, ratings, thrones, users } from "@/db/schema";
import { HOUSE_BY_ID } from "@sot/core";
import { HOUSE_SWITCH_WINDOW_MS } from "@sot/core";
import { currentStreak, earnedBadges } from "@sot/core";
import { lifetimeXp, rankForXp } from "@sot/core";
import type { HouseId } from "@sot/core";
import { normalizedNotifyPrefs } from "./notifications";
import { toGameEvent, toGameRating } from "./mappers";

export class ProfileError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function createProfile(
  googleSubject: string,
  displayName: string,
  houseId: HouseId,
  inviteCode?: string
) {
  const existing = await db.query.users.findFirst({ where: eq(users.googleSubject, googleSubject) });
  if (existing) throw new ProfileError("profile already exists", 409);

  // Closed-beta gate: a no-op unless BETA_INVITE_REQUIRED === "true", so open
  // signup keeps working exactly as before.
  const betaRequired = process.env.BETA_INVITE_REQUIRED === "true";
  let invite: typeof invites.$inferSelect | undefined;
  if (betaRequired) {
    invite = await db.query.invites.findFirst({
      where: and(eq(invites.code, inviteCode ?? ""), isNull(invites.redeemedBy)),
    });
    if (!invite) throw new ProfileError("a valid invite is required for the closed beta", 403);
  }

  try {
    const [user] = await db
      .insert(users)
      .values({ googleSubject, displayName, houseId, cohort: invite?.cohort ?? null })
      .returning();
    if (invite) {
      // Guarded redeem — if the row was claimed between lookup and now, 0 rows
      // update and we treat the code as already taken.
      const redeemed = await db
        .update(invites)
        .set({ redeemedBy: user.id, redeemedAt: new Date() })
        .where(and(eq(invites.id, invite.id), isNull(invites.redeemedBy)))
        .returning();
      if (redeemed.length === 0) throw new ProfileError("that invite has already been claimed", 409);
    }
    await db.insert(ledgerEntries).values({
      text: `**${displayName}** pledges the oath to **${HOUSE_BY_ID[houseId].name}**.`,
    });
    return user;
  } catch (e) {
    if (e instanceof ProfileError) throw e;
    // Drizzle wraps the PG unique-violation; the constraint name is on error.cause.
    const text = `${(e as { cause?: unknown })?.cause ?? ""}${e instanceof Error ? e.message : ""}`;
    if (text.includes("users_display_name_unique")) {
      throw new ProfileError("that name is already sworn to another", 409);
    }
    throw e;
  }
}

export async function switchHouse(userId: string, houseId: HouseId, now = Date.now()) {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new ProfileError("no profile", 404);
  if (user.houseId === houseId) throw new ProfileError("already sworn to that house", 400);
  const last = user.lastHouseSwitchAt?.getTime() ?? null;
  if (last !== null && now - last < HOUSE_SWITCH_WINDOW_MS) {
    throw new ProfileError("oath already broken once this season", 429);
  }
  const [updated] = await db.update(users)
    .set({ houseId, lastHouseSwitchAt: new Date(now) })
    .where(eq(users.id, userId))
    .returning();
  await db.insert(ledgerEntries).values({
    text: `**${user.displayName}** breaks their oath and rides for **${HOUSE_BY_ID[houseId].name}**.`,
  });
  return updated;
}

export async function mePayload(userId: string) {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new ProfileError("no profile", 404);
  const events = await db.select().from(influenceEvents).where(eq(influenceEvents.userId, userId));
  const ratingRows = await db.select().from(ratings).where(eq(ratings.userId, userId));
  const myRatings = ratingRows.map((rating) => toGameRating(rating, user));
  const [{ n: thronesAdded }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(thrones)
    .where(eq(thrones.addedBy, userId));
  const now = Date.now();
  const streak = currentStreak(myRatings, now);
  const badges = earnedBadges({
    ratings: myRatings,
    thronesAdded,
    streakWeeks: streak.weeks,
    now,
  });
  const xp = Math.max(0, lifetimeXp(userId, events.map(toGameEvent)));
  return {
    profile: {
      name: user.displayName,
      houseId: user.houseId,
      joinedAt: user.joinedAt.getTime(),
      badges,
      notifyPrefs: normalizedNotifyPrefs(user.notifyPrefs),
      lastHouseSwitchAt: user.lastHouseSwitchAt?.getTime() ?? null,
    },
    rank: rankForXp(xp),
    streak,
  };
}
