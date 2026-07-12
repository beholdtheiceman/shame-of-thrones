import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { influenceEvents, ledgerEntries, thrones, users } from "@/db/schema";
import { HOUSE_BY_ID } from "@/lib/data";
import { fiefIdForCoords } from "@/lib/geo";
import { INFLUENCE, rampedPoints } from "@/lib/game/rules";
import type { Amenities, ThroneCategory } from "@/lib/types";

type UserRow = typeof users.$inferSelect;

export class ThroneError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function addThrone(
  user: UserRow,
  input: { name: string; lat: number; lng: number; category: ThroneCategory; amenities: Amenities; publicAccessAttested: boolean },
  now = Date.now()
) {
  return db.transaction(async (tx) => {
    const [throne] = await tx.insert(thrones).values({
      name: input.name, lat: input.lat, lng: input.lng,
      category: input.category, amenities: input.amenities,
      publicAccessAttested: input.publicAccessAttested,
      status: "rumored", addedBy: user.id,
      addedAt: new Date(now), lastConfirmedAt: new Date(now),
    }).returning();

    if (!user.badges.includes("cartographer")) {
      await tx.update(users).set({ badges: [...user.badges, "cartographer"] }).where(eq(users.id, user.id));
    }
    await tx.insert(ledgerEntries).values({
      text: `📜 **${user.displayName}** charts a new throne — **${throne.name}** enters the Realm as *Rumored*.`,
      createdAt: new Date(now),
    });
    return throne;
  });
}

export async function confirmThrone(confirmer: UserRow, throneId: string, now = Date.now()) {
  return db.transaction(async (tx) => {
    const throne = await tx.query.thrones.findFirst({ where: eq(thrones.id, throneId) });
    if (!throne || throne.hiddenAt) throw new ThroneError("no such throne", 404);
    if (throne.status === "verified") throw new ThroneError("already confirmed", 409);
    if (throne.addedBy === confirmer.id) {
      throw new ThroneError("a throne cannot vouch for itself — a second traveler must confirm it", 403);
    }

    const adder = await tx.query.users.findFirst({ where: eq(users.id, throne.addedBy) });
    if (!adder) throw new ThroneError("adder no longer exists", 500);

    const fiefId = fiefIdForCoords(throne.lat, throne.lng);
    const adderAward = rampedPoints(INFLUENCE.throneConfirmedAdderAward, now - adder.joinedAt.getTime());
    const confirmAward = rampedPoints(INFLUENCE.confirmAction, now - confirmer.joinedAt.getTime());
    await tx.insert(influenceEvents).values([
      { // PRD §5.5: adding a throne pays out once confirmed — to the adder
        fiefId, houseId: adder.houseId, userId: adder.id,
        points: adderAward, reason: "new_throne",
        throneId: throne.id, createdAt: new Date(now),
      },
      { // PRD §5.5: the confirmation itself is a freshness check — to the confirmer
        fiefId, houseId: confirmer.houseId, userId: confirmer.id,
        points: confirmAward, reason: "confirmation",
        throneId: throne.id, createdAt: new Date(now),
      },
    ]);

    const [updated] = await tx.update(thrones)
      .set({ status: "verified", lastConfirmedAt: new Date(now) })
      .where(eq(thrones.id, throne.id)).returning();

    await tx.insert(ledgerEntries).values({
      text: `✅ **${confirmer.displayName}** confirms **${throne.name}** is real — it enters the Realm's official record (+${adderAward} Influence to **${HOUSE_BY_ID[adder.houseId].name}**).`,
      createdAt: new Date(now),
    });
    return updated;
  });
}
