import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { influenceEvents, thrones, users } from "@/db/schema";
import { resetDb } from "./db";

describe("schema integrity", () => {
  beforeEach(resetDb);

  it("influence_events rejects UPDATE and DELETE (append-only)", async () => {
    const [user] = await db.insert(users).values({
      googleSubject: "sub-1",
      displayName: "TestUser",
      houseId: "flush",
    }).returning();

    const [throne] = await db.insert(thrones).values({
      name: "Test Throne",
      lat: 40.74,
      lng: -73.98,
      category: "cafe",
      amenities: {
        accessible: true,
        babyChanging: false,
        genderNeutral: true,
        freeAccess: true,
        open24h: false,
      },
      addedBy: user.id,
    }).returning();

    const [ev] = await db.insert(influenceEvents).values({
      fiefId: "89aaaaaaaaaaaaa",
      houseId: "flush",
      userId: user.id,
      points: 10,
      reason: "rating",
      throneId: throne.id,
    }).returning();

    // Drizzle wraps the PG error; the trigger's message lives on error.cause.
    const appendOnly = (e: unknown) =>
      /append-only/.test(String((e as { cause?: unknown }).cause ?? e));

    await expect(
      db.update(influenceEvents).set({ points: 999 }).where(eq(influenceEvents.id, ev.id))
    ).rejects.toSatisfy(appendOnly);

    await expect(
      db.delete(influenceEvents).where(eq(influenceEvents.id, ev.id))
    ).rejects.toSatisfy(appendOnly);
  });

  it("users.displayName is unique", async () => {
    await db.insert(users).values({ googleSubject: "a", displayName: "Dup", houseId: "flush" });

    await expect(
      db.insert(users).values({ googleSubject: "b", displayName: "Dup", houseId: "bidet" })
    ).rejects.toThrow();
  });
});
