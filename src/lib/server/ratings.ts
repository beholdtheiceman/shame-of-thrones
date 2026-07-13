import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { influenceEvents, ledgerEntries, ratings, thrones, users } from "@/db/schema";
import { HOUSE_BY_ID } from "@/lib/data";
import { fiefIdForCoords } from "@/lib/geo";
import { INFLUENCE, rampedPoints, RATING_UPDATE_WINDOW_MS } from "@/lib/game/rules";
import { fiefControl } from "@/lib/selectors";
import { toGameEvent } from "./mappers";

export interface SubmitRatingInput {
  throneId: string;
  verdict: 1 | 2 | 3 | 4 | 5;
  tags: string[];
  verified: boolean;
  testimony?: string;
}

type UserRow = typeof users.$inferSelect;

export class RatingError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function submitRating(user: UserRow, input: SubmitRatingInput, now = Date.now()) {
  return db.transaction(async (tx) => {
    const throne = await tx.query.thrones.findFirst({ where: eq(thrones.id, input.throneId) });
    if (!throne || throne.hiddenAt) throw new RatingError("no such throne", 404);

    const fiefId = fiefIdForCoords(throne.lat, throne.lng);

    // 24h window: a repeat visit updates the verdict, awards nothing.
    const [latest] = await tx.select().from(ratings)
      .where(and(eq(ratings.throneId, throne.id), eq(ratings.userId, user.id)))
      .orderBy(desc(ratings.createdAt)).limit(1);

    if (latest && now - latest.createdAt.getTime() < RATING_UPDATE_WINDOW_MS) {
      await tx.update(ratings)
        .set({
          verdict: input.verdict, tags: input.tags, verified: input.verified,
          ...(input.testimony !== undefined ? { testimony: input.testimony.trim() || null } : {}),
        })
        .where(eq(ratings.id, latest.id));
      return { updated: true as const, influence: 0, flipped: false, firstOfName: false, ratingId: latest.id };
    }

    const isFirstRating =
      (await tx.select({ id: ratings.id }).from(ratings).where(eq(ratings.throneId, throne.id)).limit(1))
        .length === 0;

    const [insertedRating] = await tx.insert(ratings).values({
      throneId: throne.id, userId: user.id,
      verdict: input.verdict, tags: input.tags, verified: input.verified,
      testimony: input.testimony?.trim() || null,
      createdAt: new Date(now),
    }).returning();

    const fiefEventRows = await tx.select().from(influenceEvents).where(eq(influenceEvents.fiefId, fiefId));
    const before = fiefControl(fiefId, fiefEventRows.map(toGameEvent), now);

    const accountAgeMs = now - user.joinedAt.getTime();
    const base = rampedPoints(
      input.verified ? INFLUENCE.verifiedRating : INFLUENCE.hearsayRating,
      accountAgeMs
    );
    const firstBonus = rampedPoints(INFLUENCE.firstOfNameBonus, accountAgeMs);
    const newEvents = [
      {
        fiefId, houseId: user.houseId, userId: user.id, points: base,
        reason: input.verified ? ("rating" as const) : ("hearsay" as const),
        throneId: throne.id, createdAt: new Date(now),
      },
      ...(isFirstRating
        ? [{
            fiefId, houseId: user.houseId, userId: user.id, points: firstBonus,
            reason: "first_of_name" as const, throneId: throne.id, createdAt: new Date(now),
          }]
        : []),
    ];
    const inserted = await tx.insert(influenceEvents).values(newEvents).returning();

    const after = fiefControl(fiefId, [...fiefEventRows, ...inserted].map(toGameEvent), now);
    const flipped = !!after.leader && (!before.leader || before.leader.houseId !== after.leader.houseId);
    const points = base + (isFirstRating ? firstBonus : 0);
    const houseName = HOUSE_BY_ID[user.houseId].name;

    const ledgerTexts: string[] = [];
    if (flipped && after.leader) {
      ledgerTexts.push(`🏰 **${HOUSE_BY_ID[after.leader.houseId].name}** has seized the Fief around **${throne.name}**!`);
    } else {
      ledgerTexts.push(`**${user.displayName}** struck a banner for **${houseName}** at **${throne.name}** (+${points} Influence).`);
    }

    if (isFirstRating) {
      ledgerTexts.push(`🏅 **${user.displayName}** earns "First of Their Name" — first rating at **${throne.name}**.`);
    }

    await tx.insert(ledgerEntries).values(ledgerTexts.map((text) => ({ text, createdAt: new Date(now) })));
    await tx.update(thrones).set({ lastConfirmedAt: new Date(now) }).where(eq(thrones.id, throne.id));

    return {
      updated: false as const, influence: points, flipped, firstOfName: isFirstRating, fief: after,
      ratingId: insertedRating.id,
      throne: { id: throne.id, lat: throne.lat, lng: throne.lng },
    };
  });
}
