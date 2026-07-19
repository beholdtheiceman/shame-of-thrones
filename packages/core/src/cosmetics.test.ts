import { describe, expect, it } from "vitest";
import {
  COSMETICS,
  cosmeticBySku,
  ownedCosmetics,
  equippedFor,
  canEquip,
  normalizeEquipped,
  type Equipped,
} from "./cosmetics";

describe("cosmetics catalog", () => {
  it("every catalog entry is a well-formed cosmetic with a unique sku", () => {
    const seen = new Set<string>();
    for (const c of COSMETICS) {
      expect(c.sku).toMatch(/^[a-z]+\.[a-z0-9]+$/);
      expect(c.priceUsd).toBeGreaterThanOrEqual(0);
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.art.length).toBeGreaterThan(0);
      expect(seen.has(c.sku)).toBe(false);
      seen.add(c.sku);
    }
  });

  it("M1 ships only banner_style SKUs", () => {
    expect(COSMETICS.length).toBeGreaterThan(0);
    for (const c of COSMETICS) expect(c.category).toBe("banner_style");
  });

  it("cosmeticBySku resolves known and unknown skus", () => {
    expect(cosmeticBySku(COSMETICS[0].sku)?.sku).toBe(COSMETICS[0].sku);
    expect(cosmeticBySku("banner.nope")).toBeUndefined();
  });
});

describe("ownership & equip helpers", () => {
  const a = COSMETICS[0].sku;

  it("ownedCosmetics maps entitlement skus to catalog entries, dropping unknowns", () => {
    const owned = ownedCosmetics([a, "banner.ghost"]);
    expect(owned.map((c) => c.sku)).toEqual([a]);
  });

  it("canEquip requires the sku to exist AND be owned", () => {
    expect(canEquip(a, [a])).toBe(true);
    expect(canEquip(a, [])).toBe(false);
    expect(canEquip("banner.ghost", ["banner.ghost"])).toBe(false);
  });

  it("equippedFor returns the equipped cosmetic for a slot", () => {
    const eq: Equipped = { banner_style: a };
    expect(equippedFor(eq, "banner_style")?.sku).toBe(a);
    expect(equippedFor({}, "banner_style")).toBeUndefined();
  });

  it("normalizeEquipped drops unowned, unknown, and category-mismatched entries", () => {
    expect(normalizeEquipped({ banner_style: a }, [a])).toEqual({ banner_style: a });
    expect(normalizeEquipped({ banner_style: a }, [])).toEqual({});
    expect(normalizeEquipped({ banner_style: "banner.ghost" }, ["banner.ghost"])).toEqual({});
    // sku belongs to banner_style but is filed under the wrong slot -> dropped
    expect(normalizeEquipped({ map_theme: a }, [a])).toEqual({});
  });
});
