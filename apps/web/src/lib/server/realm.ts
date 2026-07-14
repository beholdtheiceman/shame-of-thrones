import { desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { influenceEvents, ledgerEntries, photos, ratings, thrones, users } from "@/db/schema";
import { fiefIdForCoords } from "@sot/core";
import { fiefControl, throneScore } from "@sot/core";
import { toGameEvent, toGameRating } from "./mappers";

export async function realmPayload(now = Date.now()) {
  const [throneRows, ratingRows, eventRows, ledgerRows, photoCounts] = await Promise.all([
    db.select().from(thrones).where(isNull(thrones.hiddenAt)),
    db
      .select({ rating: ratings, displayName: users.displayName, houseId: users.houseId })
      .from(ratings)
      .innerJoin(users, eq(ratings.userId, users.id))
      .where(isNull(ratings.hiddenAt)),
    db.select().from(influenceEvents),
    db.select().from(ledgerEntries).orderBy(desc(ledgerEntries.createdAt)).limit(60),
    db.select({ throneId: photos.throneId, n: sql<number>`count(*)::int` })
      .from(photos).where(eq(photos.status, "approved")).groupBy(photos.throneId),
  ]);

  const visibleThroneIds = new Set(throneRows.map((t) => t.id));
  const gameRatings = ratingRows
    .filter((r) => visibleThroneIds.has(r.rating.throneId))
    .map((r) => toGameRating(r.rating, { displayName: r.displayName, houseId: r.houseId }));
  const gameEvents = eventRows.map(toGameEvent);
  const photoCountByThrone = new Map(photoCounts.map((p) => [p.throneId, p.n]));

  const throneDtos = throneRows.map((t) => {
    const { score, count } = throneScore(t.id, gameRatings, now);
    return {
      id: t.id,
      name: t.name,
      lat: t.lat,
      lng: t.lng,
      category: t.category,
      status: t.status,
      amenities: t.amenities,
      addedBy: t.addedBy,
      addedAt: t.addedAt.getTime(),
      lastConfirmedAt: t.lastConfirmedAt.getTime(),
      fiefId: fiefIdForCoords(t.lat, t.lng),
      score,
      ratingCount: count,
      photoCount: photoCountByThrone.get(t.id) ?? 0,
    };
  });

  const fiefIds = [...new Set(gameEvents.map((e) => e.fiefId))];
  const fiefs = fiefIds.map((id) => fiefControl(id, gameEvents, now));

  return {
    thrones: throneDtos,
    ratings: gameRatings,
    fiefs,
    ledger: ledgerRows.map((l) => ({ id: l.id, createdAt: l.createdAt.getTime(), text: l.text })),
  };
}

export type RealmPayload = Awaited<ReturnType<typeof realmPayload>>;
