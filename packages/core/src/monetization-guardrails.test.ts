import { describe, expect, it } from "vitest";
import { COSMETICS } from "./cosmetics";

// The influence_reason enum values from apps/web schema. A cosmetic sku must
// never collide with a way to earn Influence (spec §2, invariant 1 & 4).
const INFLUENCE_REASONS = [
  "rating", "first_of_name", "new_throne", "confirmation", "hearsay", "reversal",
];

describe("monetization guardrails", () => {
  it("no cosmetic sku collides with an influence reason", () => {
    for (const c of COSMETICS) {
      expect(INFLUENCE_REASONS).not.toContain(c.sku);
    }
  });

  it("cosmetics carry no gameplay-advantage fields", () => {
    for (const c of COSMETICS) {
      expect(c).not.toHaveProperty("points");
      expect(c).not.toHaveProperty("influence");
      expect(c).not.toHaveProperty("multiplier");
      expect(c).not.toHaveProperty("rank");
    }
  });
});
