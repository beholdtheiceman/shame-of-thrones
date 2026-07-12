import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { ageAttestations, influenceEvents, photos, ratings, reports, reviewQueue, thrones, users } from "@/db/schema";
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

describe("cycle A schema", () => {
  beforeEach(resetDb);

  const AMEN = { accessible: false, babyChanging: false, genderNeutral: false, freeAccess: true, open24h: false };

  it("reports dedupe per reporter+subject via unique index", async () => {
    const [u] = await db.insert(users).values({
      googleSubject: "sub-rep", displayName: "Reporter", houseId: "flush",
    }).returning();
    const subjectId = "00000000-0000-0000-0000-000000000042";
    await db.insert(reports).values({ reporterId: u.id, subjectKind: "throne", subjectId, reason: "closed" });
    await expect(
      db.insert(reports).values({ reporterId: u.id, subjectKind: "throne", subjectId, reason: "spam" })
    ).rejects.toThrow();
  });

  it("hide/enforcement/testimony columns default null", async () => {
    const [u] = await db.insert(users).values({
      googleSubject: "sub-cols", displayName: "Cols", houseId: "flush",
    }).returning();
    expect(u.suspendedUntil).toBeNull();
    expect(u.bannedAt).toBeNull();
    const [t] = await db.insert(thrones).values({
      name: "T", lat: 1, lng: 1, category: "cafe", amenities: AMEN,
      addedBy: u.id, publicAccessAttested: true,
    }).returning();
    expect(t.hiddenAt).toBeNull();
    const [r] = await db.insert(ratings).values({
      throneId: t.id, userId: u.id, verdict: 3, tags: [], verified: false, testimony: "clean enough",
    }).returning();
    expect(r.testimony).toBe("clean enough");
    expect(r.hiddenAt).toBeNull();
    expect(r.testimonyHiddenAt).toBeNull();
  });

  it("influence ledger accepts negative reversal events", async () => {
    const [u] = await db.insert(users).values({
      googleSubject: "sub-rev", displayName: "Rev", houseId: "flush",
    }).returning();
    const [t] = await db.insert(thrones).values({
      name: "T2", lat: 1, lng: 1, category: "cafe", amenities: AMEN,
      addedBy: u.id, publicAccessAttested: true,
    }).returning();
    const [ev] = await db.insert(influenceEvents).values({
      fiefId: "f1", houseId: "flush", userId: u.id, points: -10, reason: "reversal", throneId: t.id,
    }).returning();
    expect(ev.points).toBe(-10);
  });
});

describe("cycle B schema", () => {
  beforeEach(resetDb);

  it("photos store bytes and default to pending", async () => {
    const [u] = await db.insert(users).values({
      googleSubject: "sub-ph", displayName: "Ph", houseId: "flush",
    }).returning();
    const [t] = await db.insert(thrones).values({
      name: "PT", lat: 1, lng: 1, category: "cafe",
      amenities: { accessible: false, babyChanging: false, genderNeutral: false, freeAccess: true, open24h: false },
      addedBy: u.id, publicAccessAttested: true,
    }).returning();
    const [p] = await db.insert(photos).values({
      throneId: t.id, uploadedBy: u.id, bytes: Buffer.from([0xff, 0xd8, 0xff]), contentType: "image/jpeg",
    }).returning();
    expect(p.status).toBe("pending");
    expect(Buffer.from(p.bytes).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
    expect(p.aiVerdict).toBeNull();
  });
});
