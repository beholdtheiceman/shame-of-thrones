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

import { ageAttestations, reviewQueue } from "@/db/schema";

describe("phase 1 schema", () => {
  beforeEach(resetDb);

  it("users default to role 'user'", async () => {
    const [user] = await db.insert(users).values({
      googleSubject: "sub-r", displayName: "RoleUser", houseId: "flush",
    }).returning();
    expect(user.role).toBe("user");
  });

  it("review_queue stores signals jsonb and defaults to pending", async () => {
    const [user] = await db.insert(users).values({
      googleSubject: "sub-q", displayName: "QueueUser", houseId: "flush",
    }).returning();
    const [row] = await db.insert(reviewQueue).values({
      kind: "rating",
      subjectId: "00000000-0000-0000-0000-000000000001",
      userId: user.id,
      signals: [{ signal: "impossible_travel", kmh: 840, fromThroneId: "x", minutes: 12 }],
      severity: "high",
    }).returning();
    expect(row.status).toBe("pending");
    expect(row.aiAssessment).toBeNull();
    expect(row.signals[0]).toMatchObject({ signal: "impossible_travel", kmh: 840 });
  });

  it("age_attestations keys by google_subject and stores no birthdate", async () => {
    const [att] = await db.insert(ageAttestations).values({
      googleSubject: "sub-a", over13ConfirmedAt: new Date(),
    }).returning();
    expect(att.lockedAt).toBeNull();
    expect(Object.keys(att).sort()).toEqual(["googleSubject", "lockedAt", "over13ConfirmedAt"]);
  });
});
