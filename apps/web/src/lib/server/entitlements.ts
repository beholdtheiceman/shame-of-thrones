import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { entitlements, users } from "@/db/schema";
import { canEquip, normalizeEquipped, type CosmeticCategory, type Equipped } from "@sot/core";

export async function ownedSkus(userId: string): Promise<string[]> {
  const rows = await db
    .select({ sku: entitlements.sku })
    .from(entitlements)
    .where(and(eq(entitlements.userId, userId), isNull(entitlements.revokedAt)));
  return rows.map((r) => r.sku);
}

export async function grantEntitlement(input: {
  userId: string;
  sku: string;
  source: "purchase" | "grant" | "pass";
  platform?: "ios" | "android" | "admin" | null;
  storeTxnId?: string | null;
}): Promise<void> {
  // ON CONFLICT DO NOTHING (no target) covers BOTH unique constraints:
  // the storeTxnId unique (duplicate webhook) and the (userId, sku) active
  // partial unique (already owned). Both make a re-grant a safe no-op.
  await db
    .insert(entitlements)
    .values({
      userId: input.userId,
      sku: input.sku,
      source: input.source,
      platform: input.platform ?? null,
      storeTxnId: input.storeTxnId ?? null,
    })
    .onConflictDoNothing();
}

export async function revokeEntitlement(storeTxnId: string): Promise<void> {
  await db
    .update(entitlements)
    .set({ revokedAt: new Date() })
    .where(and(eq(entitlements.storeTxnId, storeTxnId), isNull(entitlements.revokedAt)));
}

/** Set (or clear, with sku=null) the equipped cosmetic for a category slot.
 * Ownership is validated server-side; the persisted value is normalized. */
export async function setEquipped(
  userId: string,
  category: CosmeticCategory,
  sku: string | null
): Promise<Equipped> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error("no profile");
  const owned = await ownedSkus(userId);
  if (sku !== null && !canEquip(sku, owned)) throw new Error("not owned");

  const next: Equipped = { ...((user.equipped ?? {}) as Equipped) };
  if (sku === null) delete next[category];
  else next[category] = sku;

  const normalized = normalizeEquipped(next, owned);
  await db.update(users).set({ equipped: normalized }).where(eq(users.id, userId));
  return normalized;
}
