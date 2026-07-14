import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  // Imports deferred until after env is loaded, because db/client reads DATABASE_URL at import time.
  const { db, pool } = await import("./client");
  const { influenceEvents, ledgerEntries, ratings, thrones, users } = await import("./schema");
  const { SEED_INFLUENCE, SEED_LEDGER, SEED_RATINGS, SEED_THRONES, fiefIdForCoords } = await import("@sot/core");

  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) {
    console.log("Database not empty — refusing to seed. Truncate manually if you really mean it.");
    return;
  }

  // 1. Users from every distinct authorName in the seed data
  const authorHouse = new Map<string, string>();
  for (const r of SEED_RATINGS) authorHouse.set(r.authorName, r.houseId);
  for (const e of SEED_INFLUENCE) if (!authorHouse.has(e.authorName)) authorHouse.set(e.authorName, e.houseId);
  for (const t of SEED_THRONES) if (!authorHouse.has(t.addedBy)) authorHouse.set(t.addedBy, "flush");

  const userIdByName = new Map<string, string>();
  for (const [name, houseId] of authorHouse) {
    const [u] = await db.insert(users).values({
      googleSubject: `seed:${name}`,
      displayName: name,
      houseId: houseId as "flush" | "bidet" | "plunger" | "porcelain",
    }).returning();
    userIdByName.set(name, u.id);
  }

  // 2. Thrones (old string id → new uuid)
  const throneIdByOldId = new Map<string, string>();
  for (const t of SEED_THRONES) {
    const [row] = await db.insert(thrones).values({
      name: t.name, lat: t.lat, lng: t.lng, category: t.category, status: t.status,
      publicAccessAttested: true,
      amenities: t.amenities, addedBy: userIdByName.get(t.addedBy)!,
      addedAt: new Date(t.addedAt), lastConfirmedAt: new Date(t.lastConfirmedAt),
    }).returning();
    throneIdByOldId.set(t.id, row.id);
  }

  // 3. Ratings
  for (const r of SEED_RATINGS) {
    await db.insert(ratings).values({
      throneId: throneIdByOldId.get(r.throneId)!,
      userId: userIdByName.get(r.authorName)!,
      verdict: r.verdict, tags: r.tags, verified: r.verified,
      createdAt: new Date(r.createdAt),
    });
  }

  // 4. Influence events (recompute fiefId from the throne so geo stays consistent)
  for (const e of SEED_INFLUENCE) {
    const seedThrone = SEED_THRONES.find((t) => t.id === e.throneId)!;
    await db.insert(influenceEvents).values({
      fiefId: fiefIdForCoords(seedThrone.lat, seedThrone.lng),
      houseId: e.houseId,
      userId: userIdByName.get(e.authorName)!,
      points: e.points, reason: e.reason,
      throneId: throneIdByOldId.get(e.throneId)!,
      createdAt: new Date(e.createdAt),
    });
  }

  // 5. Ledger
  for (const l of SEED_LEDGER) {
    await db.insert(ledgerEntries).values({ text: l.text, createdAt: new Date(l.createdAt) });
  }

  console.log(
    `Seeded ${userIdByName.size} users, ${throneIdByOldId.size} thrones, ${SEED_RATINGS.length} ratings, ${SEED_INFLUENCE.length} influence events.`
  );
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
