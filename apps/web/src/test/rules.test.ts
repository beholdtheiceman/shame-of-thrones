import { describe, expect, it } from "vitest";
import { rampedPoints, SAFETY } from "@sot/core";

const DAY = 86_400_000;

describe("rampedPoints", () => {
  it("halves and rounds up for accounts under 7 days", () => {
    expect(rampedPoints(10, 3 * DAY)).toBe(5);
    expect(rampedPoints(15, 3 * DAY)).toBe(8); // ceil(7.5)
    expect(rampedPoints(3, 0)).toBe(2);        // ceil(1.5)
    expect(rampedPoints(2, 6 * DAY)).toBe(1);  // never zero
  });

  it("pays full points at exactly the window boundary and beyond", () => {
    expect(rampedPoints(10, SAFETY.newAccountWindowMs)).toBe(10);
    expect(rampedPoints(10, 30 * DAY)).toBe(10);
  });
});
