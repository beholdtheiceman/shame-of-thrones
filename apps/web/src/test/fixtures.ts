import { db } from "@/db/client";
import { thrones, users } from "@/db/schema";

export async function makeUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const n = Math.random().toString(36).slice(2, 8);
  const [user] = await db.insert(users).values({
    googleSubject: `sub-${n}`,
    displayName: `User-${n}`,
    houseId: "flush",
    joinedAt: new Date(Date.now() - 30 * 86_400_000), // established; override for ramp tests
    ...overrides,
  }).returning();
  return user;
}

export async function makeThrone(addedBy: string, overrides: Partial<typeof thrones.$inferInsert> = {}) {
  const [throne] = await db.insert(thrones).values({
    name: "Fixture Throne",
    lat: 40.746, lng: -73.9895,
    category: "cafe",
    status: "verified",
    amenities: { accessible: true, babyChanging: false, genderNeutral: true, freeAccess: true, open24h: false },
    addedBy,
    ...overrides,
  }).returning();
  return throne;
}
