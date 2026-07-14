import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { influenceEvents, ledgerEntries, ratings, thrones, users } from "@/db/schema";

type UserRow = typeof users.$inferSelect;
type EventRow = typeof influenceEvents.$inferSelect;

export class EnforcementError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Reversals negate originals 1:1 and copy the ORIGINAL createdAt so the
 * 0.98^days fief decay cancels exactly for all time. Originals that already
 * have a matching reversal are skipped (idempotence across rating-then-throne
 * takedowns). */
function unreversed(events: EventRow[]): EventRow[] {
  const originals = events.filter((e) => e.reason !== "reversal");
  const reversals = events.filter((e) => e.reason === "reversal");
  return originals.filter(
    (o) => !reversals.some(
      (r) =>
        r.userId === o.userId &&
        r.fiefId === o.fiefId &&
        r.houseId === o.houseId &&
        r.points === -o.points &&
        r.createdAt.getTime() === o.createdAt.getTime()
    )
  );
}

function toReversalValues(events: EventRow[]) {
  return events.map((e) => ({
    fiefId: e.fiefId, houseId: e.houseId, userId: e.userId,
    points: -e.points, reason: "reversal" as const,
    throneId: e.throneId, createdAt: e.createdAt,
  }));
}

export async function hideThrone(throneId: string, moderator: UserRow, now = Date.now()) {
  return db.transaction(async (tx) => {
    const throne = await tx.query.thrones.findFirst({ where: eq(thrones.id, throneId) });
    if (!throne) throw new EnforcementError("no such throne", 404);
    if (throne.hiddenAt) throw new EnforcementError("already stricken", 409);

    const events = await tx.select().from(influenceEvents).where(eq(influenceEvents.throneId, throneId));
    const values = toReversalValues(unreversed(events));
    if (values.length > 0) await tx.insert(influenceEvents).values(values);

    await tx.update(thrones)
      .set({ hiddenAt: new Date(now), hiddenBy: moderator.id })
      .where(eq(thrones.id, throneId));
    await tx.insert(ledgerEntries).values({
      text: `⚖️ The Maesters strike **${throne.name}** from the record.`,
      createdAt: new Date(now),
    });
    return throne;
  });
}

export async function hideRating(ratingId: string, moderator: UserRow, now = Date.now()) {
  return db.transaction(async (tx) => {
    const rating = await tx.query.ratings.findFirst({ where: eq(ratings.id, ratingId) });
    if (!rating) throw new EnforcementError("no such rating", 404);
    if (rating.hiddenAt) throw new EnforcementError("already stricken", 409);

    // The rating's awards were inserted with createdAt === rating.createdAt
    // (rating/hearsay event + any first_of_name bonus).
    const events = await tx.select().from(influenceEvents).where(and(
      eq(influenceEvents.userId, rating.userId),
      eq(influenceEvents.throneId, rating.throneId),
      eq(influenceEvents.createdAt, rating.createdAt)
    ));
    const values = toReversalValues(unreversed(events));
    if (values.length > 0) await tx.insert(influenceEvents).values(values);

    await tx.update(ratings)
      .set({ hiddenAt: new Date(now), hiddenBy: moderator.id })
      .where(eq(ratings.id, ratingId));
    return rating;
  });
}

export async function hideTestimony(ratingId: string, moderator: UserRow, now = Date.now()) {
  const rating = await db.query.ratings.findFirst({ where: eq(ratings.id, ratingId) });
  if (!rating) throw new EnforcementError("no such rating", 404);
  if (!rating.testimony) throw new EnforcementError("no testimony to strike", 409);
  if (rating.testimonyHiddenAt) throw new EnforcementError("already stricken", 409);
  const [updated] = await db.update(ratings)
    .set({ testimonyHiddenAt: new Date(now), testimonyHiddenBy: moderator.id })
    .where(eq(ratings.id, ratingId)).returning();
  return updated;
}
