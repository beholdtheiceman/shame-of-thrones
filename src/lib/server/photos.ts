import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { photos, reviewQueue, thrones, users } from "@/db/schema";
import { screenPhoto, type VisionClient } from "./photoScreen";

type UserRow = typeof users.$inferSelect;

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_PER_THRONE = 3;   // non-rejected photos per user per throne
const MAX_PENDING = 10;     // pending photos per user overall

export class PhotoError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export interface SubmitPhotoInput {
  throneId: string;
  bytes: Buffer;
  contentType: string;
}

export async function submitPhoto(
  user: UserRow,
  input: SubmitPhotoInput,
  now = Date.now(),
  vision?: VisionClient
) {
  const throne = await db.query.thrones.findFirst({ where: eq(thrones.id, input.throneId) });
  if (!throne || throne.hiddenAt) throw new PhotoError("no such throne", 404);
  if (!(ALLOWED_TYPES as readonly string[]).includes(input.contentType)) {
    throw new PhotoError("only jpeg, png, or webp portraits are accepted", 415);
  }
  if (input.bytes.length === 0) throw new PhotoError("empty file", 400);
  if (input.bytes.length > MAX_BYTES) throw new PhotoError("portraits may not exceed 5MB", 413);

  const count = sql<number>`count(*)::int`;
  const [[perThrone], [pending]] = await Promise.all([
    db.select({ n: count }).from(photos).where(and(
      eq(photos.uploadedBy, user.id), eq(photos.throneId, input.throneId), ne(photos.status, "rejected")
    )),
    db.select({ n: count }).from(photos).where(and(
      eq(photos.uploadedBy, user.id), eq(photos.status, "pending")
    )),
  ]);
  if (perThrone.n >= MAX_PER_THRONE) {
    throw new PhotoError("You have offered enough portraits of this throne.", 429);
  }
  if (pending.n >= MAX_PENDING) {
    throw new PhotoError("The Maesters are still reviewing your earlier portraits.", 429);
  }

  const [photo] = await db.insert(photos).values({
    throneId: input.throneId, uploadedBy: user.id,
    bytes: input.bytes, contentType: input.contentType, createdAt: new Date(now),
  }).returning({ id: photos.id });

  const verdict = await screenPhoto(input.bytes, input.contentType, vision);

  if (!verdict) {
    // Fail CLOSED: stays pending (invisible); human review is the backstop.
    await db.insert(reviewQueue).values({
      kind: "photo", subjectId: photo.id, userId: user.id,
      signals: [{ signal: "screen_unavailable" }], severity: "medium", createdAt: new Date(now),
    });
    return { photoId: photo.id, status: "pending" as const };
  }

  if (verdict.personDetected || verdict.nsfw) {
    const reason = verdict.nsfw ? "nsfw" : "person_detected";
    await db.update(photos).set({
      status: "rejected", rejectedReason: reason, aiVerdict: verdict,
      ...(verdict.nsfw ? { bytes: Buffer.alloc(0) } : {}), // nothing explicit is retained
    }).where(eq(photos.id, photo.id));
    await db.insert(reviewQueue).values({
      kind: "photo", subjectId: photo.id, userId: user.id,
      signals: [{ signal: "photo_rejected", reason }], severity: "high",
      aiAssessment: verdict.note, aiSeverity: "high", aiTriagedAt: new Date(now), createdAt: new Date(now),
    });
    return { photoId: photo.id, status: "rejected" as const };
  }

  await db.update(photos).set({ aiVerdict: verdict }).where(eq(photos.id, photo.id));
  await db.insert(reviewQueue).values({
    kind: "photo", subjectId: photo.id, userId: user.id,
    signals: [{ signal: "photo_pending", relevant: verdict.relevant }],
    severity: verdict.relevant ? "low" : "medium",
    aiAssessment: verdict.note, aiSeverity: verdict.relevant ? "low" : "medium",
    aiTriagedAt: new Date(now), createdAt: new Date(now),
  });
  return { photoId: photo.id, status: "pending" as const };
}

export async function approvePhoto(photoId: string, moderator: UserRow, now = Date.now()) {
  const photo = await db.query.photos.findFirst({ where: eq(photos.id, photoId) });
  if (!photo) throw new PhotoError("no such photo", 404);
  if (photo.status === "approved") throw new PhotoError("already approved", 409);
  const [updated] = await db.update(photos).set({
    status: "approved", rejectedReason: null, reviewedBy: moderator.id, reviewedAt: new Date(now),
  }).where(eq(photos.id, photoId)).returning({ id: photos.id, status: photos.status });
  return updated;
}

export async function rejectPhoto(photoId: string, moderator: UserRow, note?: string, now = Date.now()) {
  const photo = await db.query.photos.findFirst({ where: eq(photos.id, photoId) });
  if (!photo) throw new PhotoError("no such photo", 404);
  if (photo.status === "rejected") throw new PhotoError("already rejected", 409);
  const [updated] = await db.update(photos).set({
    status: "rejected", rejectedReason: note?.trim() || "rejected by moderator",
    reviewedBy: moderator.id, reviewedAt: new Date(now),
  }).where(eq(photos.id, photoId)).returning({ id: photos.id, status: photos.status });
  return updated;
}
