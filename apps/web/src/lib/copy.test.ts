import { describe, expect, it } from "vitest";
import { COPY, copyFor } from "./copy";
import { VERDICT_SCALE } from "./data";

describe("copyFor", () => {
  it("resolves themed and plain variants", () => {
    expect(copyFor("rumored", false)).toBe("Rumored");
    expect(copyFor("rumored", true)).toBe("Unverified");
  });
  it("every entry has non-empty themed and plain strings", () => {
    for (const [k, v] of Object.entries(COPY)) {
      expect(v.themed.length, k).toBeGreaterThan(0);
      expect(v.plain.length, k).toBeGreaterThan(0);
    }
  });
});

describe("VERDICT_SCALE plain labels", () => {
  it("all five tiers have a plainLabel", () => {
    expect(VERDICT_SCALE.map((t) => t.plainLabel)).toEqual([
      "Avoid", "Poor", "Okay", "Good", "Excellent",
    ]);
  });
});
