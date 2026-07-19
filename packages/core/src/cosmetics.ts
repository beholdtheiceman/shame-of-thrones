export type CosmeticCategory =
  | "banner_style"
  | "map_theme"
  | "profile_sigil"
  | "rating_stamp";

export interface Cosmetic {
  /** Stable id, e.g. "banner.dragonscale". Never reused. */
  sku: string;
  category: CosmeticCategory;
  name: string;
  description: string;
  /** Display price in USD. The store is the source of truth for the charged amount. */
  priceUsd: number;
  /** Render token each client maps to a concrete banner treatment. */
  art: string;
}

/** M1 catalog: banner styles only. Other categories are scaffolded via the
 * CosmeticCategory type but ship no purchasable SKUs yet (spec §8). */
export const COSMETICS: Cosmetic[] = [
  {
    sku: "banner.dragonscale",
    category: "banner_style",
    name: "Dragonscale Banner",
    description: "Scaled hide that catches the torchlight.",
    priceUsd: 2.99,
    art: "dragonscale",
  },
  {
    sku: "banner.gilded",
    category: "banner_style",
    name: "Gilded Banner",
    description: "Threaded with gold for the newly crowned.",
    priceUsd: 2.99,
    art: "gilded",
  },
  {
    sku: "banner.obsidian",
    category: "banner_style",
    name: "Obsidian Banner",
    description: "Black glass, cut for the Long Night.",
    priceUsd: 3.99,
    art: "obsidian",
  },
];

const BY_SKU = new Map(COSMETICS.map((c) => [c.sku, c]));

export function cosmeticBySku(sku: string): Cosmetic | undefined {
  return BY_SKU.get(sku);
}

/** One active cosmetic per category slot. */
export type Equipped = Partial<Record<CosmeticCategory, string>>;

export function ownedCosmetics(entitlementSkus: string[]): Cosmetic[] {
  return entitlementSkus
    .map((s) => cosmeticBySku(s))
    .filter((c): c is Cosmetic => c !== undefined);
}

export function equippedFor(
  equipped: Equipped,
  category: CosmeticCategory
): Cosmetic | undefined {
  const sku = equipped[category];
  return sku ? cosmeticBySku(sku) : undefined;
}

/** A sku is equippable only if it exists in the catalog AND the user owns it. */
export function canEquip(sku: string, ownedSkus: string[]): boolean {
  return cosmeticBySku(sku) !== undefined && ownedSkus.includes(sku);
}

/** Drop any equipped entry that is unknown, unowned, or filed under the wrong
 * category slot. The server persists only normalized selections. */
export function normalizeEquipped(equipped: Equipped, ownedSkus: string[]): Equipped {
  const out: Equipped = {};
  for (const [category, sku] of Object.entries(equipped) as [CosmeticCategory, string][]) {
    const c = cosmeticBySku(sku);
    if (c && c.category === category && ownedSkus.includes(sku)) {
      out[category] = sku;
    }
  }
  return out;
}
