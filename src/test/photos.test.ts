import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { photos, reviewQueue } from "@/db/schema";
import { PhotoError, submitPhoto } from "@/lib/server/photos";
import type { VisionClient } from "@/lib/server/photoScreen";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const okVision: VisionClient = {
  async classify() { return { personDetected: false, nsfw: false, relevant: true, note: "an entrance" }; },
};

describe("submitPhoto", () => {
  beforeEach(resetDb);

  it("clean photo lands pending (NOT approved) with a low queue row", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const { photoId, status } = await submitPhoto(user, { throneId: throne.id, bytes: JPEG, contentType: "image/jpeg" }, Date.now(), okVision);
    expect(status).toBe("pending");
    const [p] = await db.select().from(photos).where(eq(photos.id, photoId));
    expect(p.status).toBe("pending");
    expect(p.aiVerdict?.relevant).toBe(true);
    const [q] = (await db.select().from(reviewQueue)).filter((r) => r.kind === "photo");
    expect(q.severity).toBe("low");
    expect(q.aiAssessment).toBe("an entrance");
  });

  it("person detected → auto-rejected, high queue row, bytes kept", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const vision: VisionClient = {
      async classify() { return { personDetected: true, nsfw: false, relevant: true, note: "a person at the sink" }; },
    };
    const { status, photoId } = await submitPhoto(user, { throneId: throne.id, bytes: JPEG, contentType: "image/jpeg" }, Date.now(), vision);
    expect(status).toBe("rejected");
    const [p] = await db.select().from(photos).where(eq(photos.id, photoId));
    expect(p.rejectedReason).toBe("person_detected");
    expect(p.bytes.length).toBeGreaterThan(0);
    const [q] = (await db.select().from(reviewQueue)).filter((r) => r.kind === "photo");
    expect(q.severity).toBe("high");
  });

  it("nsfw → rejected AND bytes wiped", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const vision: VisionClient = {
      async classify() { return { personDetected: false, nsfw: true, relevant: false, note: "explicit" }; },
    };
    const { photoId } = await submitPhoto(user, { throneId: throne.id, bytes: JPEG, contentType: "image/jpeg" }, Date.now(), vision);
    const [p] = await db.select().from(photos).where(eq(photos.id, photoId));
    expect(p.status).toBe("rejected");
    expect(p.rejectedReason).toBe("nsfw");
    expect(p.bytes.length).toBe(0);
  });

  it("vision failure fails CLOSED: pending, screen_unavailable queue row", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const vision: VisionClient = { async classify() { throw new Error("down"); } };
    const { status } = await submitPhoto(user, { throneId: throne.id, bytes: JPEG, contentType: "image/jpeg" }, Date.now(), vision);
    expect(status).toBe("pending");
    const [q] = (await db.select().from(reviewQueue)).filter((r) => r.kind === "photo");
    expect(q.signals).toEqual([{ signal: "screen_unavailable" }]);
  });

  it("validates type, size, and the 3-per-throne cap", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    await expect(
      submitPhoto(user, { throneId: throne.id, bytes: JPEG, contentType: "image/gif" }, Date.now(), okVision)
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      submitPhoto(user, { throneId: throne.id, bytes: Buffer.alloc(5 * 1024 * 1024 + 1), contentType: "image/jpeg" }, Date.now(), okVision)
    ).rejects.toMatchObject({ status: 413 });
    for (let i = 0; i < 3; i++) {
      await submitPhoto(user, { throneId: throne.id, bytes: JPEG, contentType: "image/jpeg" }, Date.now(), okVision);
    }
    await expect(
      submitPhoto(user, { throneId: throne.id, bytes: JPEG, contentType: "image/jpeg" }, Date.now(), okVision)
    ).rejects.toMatchObject({ status: 429 });
  });

  it("hidden or missing throne 404s", async () => {
    const user = await makeUser();
    await expect(
      submitPhoto(user, { throneId: "00000000-0000-0000-0000-000000000001", bytes: JPEG, contentType: "image/jpeg" }, Date.now(), okVision)
    ).rejects.toBeInstanceOf(PhotoError);
  });
});
