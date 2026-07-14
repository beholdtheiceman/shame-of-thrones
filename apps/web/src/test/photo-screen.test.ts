import { describe, expect, it } from "vitest";
import { screenPhoto, type VisionClient } from "@/lib/server/photoScreen";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

describe("screenPhoto", () => {
  it("passes through the client's verdict", async () => {
    const fake: VisionClient = {
      async classify() { return { personDetected: true, nsfw: false, relevant: true, note: "a face is visible at the sink" }; },
    };
    const v = await screenPhoto(JPEG, "image/jpeg", fake);
    expect(v?.personDetected).toBe(true);
  });

  it("fails CLOSED on error — returns null (photo stays pending/invisible)", async () => {
    const failing: VisionClient = {
      async classify() { throw new Error("vision down"); },
    };
    expect(await screenPhoto(JPEG, "image/jpeg", failing)).toBeNull();
  });
});
