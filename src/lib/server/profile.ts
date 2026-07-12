import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { influenceEvents, ledgerEntries, users } from "@/db/schema";
import { HOUSE_BY_ID } from "@/lib/data";
import { HOUSE_SWITCH_WINDOW_MS } from "@/lib/game/rules";
import { lifetimeXp, rankForXp } from "@/lib/selectors";
import type { HouseId } from "@/lib/types";
import { toGameEvent } from "./mappers";

export class ProfileError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function createProfile(googleSubject: string, displayName: string, houseId: HouseId) {
  const existing = await db.query.users.findFirst({ where: eq(users.googleSubject, googleSubject) });
  if (existing) throw new ProfileError("profile already exists", 409);
  try {
    const [user] = await db.insert(users).values({ googleSubject, displayName, houseId }).returning();
    await db.insert(ledgerEntries).values({
      text: `**${displayName}** pledges the oath to **${HOUSE_BY_ID[houseId].name}**.`,
    });
    return user;
  } catch (e) {
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
  const xp = Math.max(0, lifetimeXp(userId, events.map(toGameEvent)));
  return {
    profile: {
      name: user.displayName,
      houseId: user.houseId,
      joinedAt: user.joinedAt.getTime(),
      badges: user.badges,
      lastHouseSwitchAt: user.lastHouseSwitchAt?.getTime() ?? null,
    },
    rank: rankForXp(xp),
  };
}
