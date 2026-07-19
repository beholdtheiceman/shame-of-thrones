import { NextResponse } from "next/server";
import { sessionInfo } from "@/lib/server/session";
import { setEquipped } from "@/lib/server/entitlements";
import type { CosmeticCategory } from "@sot/core";

export const dynamic = "force-dynamic";

const CATEGORIES = new Set<CosmeticCategory>([
  "banner_style", "map_theme", "profile_sigil", "rating_stamp",
]);

export async function POST(req: Request) {
  const info = await sessionInfo();
  if (info.kind !== "user") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const category = body?.category as CosmeticCategory;
  if (!CATEGORIES.has(category)) {
    return NextResponse.json({ error: "bad category" }, { status: 400 });
  }
  const sku: string | null = typeof body?.sku === "string" ? body.sku : null;

  try {
    const equipped = await setEquipped(info.user.id, category, sku);
    return NextResponse.json({ equipped });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: msg === "not owned" ? 403 : 400 });
  }
}
