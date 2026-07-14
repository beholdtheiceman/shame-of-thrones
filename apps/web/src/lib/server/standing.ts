import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";

type UserRow = typeof users.$inferSelect;

export class StandingError extends Error {
  status = 403;
  constructor(public code: "banished" | "suspended", public until?: Date) {
    super(code);
  }
}

/** Sync check against the already-fetched session user row — no extra query.
 * Bans win over suspensions. Reads are never gated, only writes. */
export function requireGoodStanding(
  user: Pick<UserRow, "bannedAt" | "suspendedUntil">,
  now = Date.now()
): void {
  if (user.bannedAt) throw new StandingError("banished");
  if (user.suspendedUntil && user.suspendedUntil.getTime() > now) {
    throw new StandingError("suspended", user.suspendedUntil);
  }
}

export async function suspendUser(userId: string, days: number, now = Date.now()) {
  const [u] = await db.update(users)
    .set({ suspendedUntil: new Date(now + days * 86_400_000) })
    .where(eq(users.id, userId)).returning();
  return u;
}

export async function banUser(userId: string, now = Date.now()) {
  const [u] = await db.update(users)
    .set({ bannedAt: new Date(now) })
    .where(eq(users.id, userId)).returning();
  return u;
}

export async function reinstateUser(userId: string) {
  const [u] = await db.update(users)
    .set({ bannedAt: null, suspendedUntil: null })
    .where(eq(users.id, userId)).returning();
  return u;
}
