import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { photos, reviewQueue } from "@/db/schema";
import { submitReport } from "@/lib/server/reports";
import { listReview } from "@/lib/server/review";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
import { auth } from "@/auth";
import { POST as moderatePOST } from "@/app/api/moderate/route";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

function post(body: unknown) {
  return new Request("http://test/api/moderate", { method: "POST", body: JSON.stringify(body) });
}

describe("photo moderation", () => {
  beforeEach(resetDb);

  it("approve_photo flips status, stamps reviewer, auto-resolves", async () => {
    const owner = await makeUser();
    const throne = await makeThrone(owner.id);
    const [photo] = await db.insert(photos).values({
      throneId: throne.id, uploadedBy: owner.id, bytes: JPEG, contentType: "image/jpeg",
    }).returning();
    const [q] = await db.insert(reviewQueue).values({
      kind: "photo", subjectId: photo.id, userId: owner.id,
      signals: [{ signal: "photo_pending", relevant: true }], severity: "low",
    }).returning();

    const mod = await makeUser({ role: "moderator" });
    vi.mocked(auth).mockResolvedValue({ googleSubject: mod.googleSubject } as never);
    const res = await moderatePOST(post({ action: "approve_photo", subjectId: photo.id, reviewId: q.id }));
    expect(res.status).toBe(200);

    const [p] = await db.select().from(photos).where(eq(photos.id, photo.id));
    expect(p.status).toBe("approved");
    expect(p.reviewedBy).toBe(mod.id);
    const [resolved] = await db.select().from(reviewQueue).where(eq(reviewQueue.id, q.id));
    expect(resolved.status).toBe("resolved");
  });

  it("reject_photo keeps bytes and records the reason", async () => {
    const owner = await makeUser();
    const throne = await makeThrone(owner.id);
    const [photo] = await db.insert(photos).values({
      throneId: throne.id, uploadedBy: owner.id, bytes: JPEG, contentType: "image/jpeg",
    }).returning();
    const mod = await makeUser({ role: "moderator" });
    vi.mocked(auth).mockResolvedValue({ googleSubject: mod.googleSubject } as never);
    await moderatePOST(post({ action: "reject_photo", subjectId: photo.id, note: "not a restroom" }));
    const [p] = await db.select().from(photos).where(eq(photos.id, photo.id));
    expect(p.status).toBe("rejected");
    expect(p.rejectedReason).toBe("not a restroom");
    expect(p.bytes.length).toBeGreaterThan(0);
  });

  it("approved photos are reportable (queue row → uploader); pending are not", async () => {
    const owner = await makeUser();
    const throne = await makeThrone(owner.id);
    const [photo] = await db.insert(photos).values({
      throneId: throne.id, uploadedBy: owner.id, bytes: JPEG, contentType: "image/jpeg", status: "approved",
    }).returning();
    const reporter = await makeUser();
    await submitReport(reporter, { subjectKind: "photo", subjectId: photo.id, reason: "inappropriate" });
    const [q] = await db.select().from(reviewQueue);
    expect(q.kind).toBe("report");
    expect(q.userId).toBe(owner.id);

    const [pending] = await db.insert(photos).values({
      throneId: throne.id, uploadedBy: owner.id, bytes: JPEG, contentType: "image/jpeg",
    }).returning();
    await expect(
      submitReport(reporter, { subjectKind: "photo", subjectId: pending.id, reason: "spam" })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("listReview surfaces photo rows with subjectKind photo", async () => {
    const owner = await makeUser();
    const throne = await makeThrone(owner.id);
    const [photo] = await db.insert(photos).values({
      throneId: throne.id, uploadedBy: owner.id, bytes: JPEG, contentType: "image/jpeg",
    }).returning();
    await db.insert(reviewQueue).values({
      kind: "photo", subjectId: photo.id, userId: owner.id,
      signals: [{ signal: "photo_pending", relevant: true }], severity: "low",
    });
    const items = await listReview();
    expect(items[0].subjectKind).toBe("photo");
    expect(items[0].subject).toContain(throne.name);
  });
});
