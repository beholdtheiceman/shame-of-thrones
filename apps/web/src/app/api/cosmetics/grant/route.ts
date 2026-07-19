import { NextResponse } from "next/server";
import { sessionInfo } from "@/lib/server/session";
import { grantEntitlement } from "@/lib/server/entitlements";
import { cosmeticBySku } from "@sot/core";

export const dynamic = "force-dynamic";

/** Moderator-only comp/support grant. Mirrors the /api/invites admin pattern. */
export async function POST(req: Request) {
  const info = await sessionInfo();
  if (info.kind !== "user" || info.user.role !== "moderator") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const sku = typeof body?.sku === "string" ? body.sku : "";
  if (!userId || !cosmeticBySku(sku)) {
    return NextResponse.json({ error: "userId and a known sku are required" }, { status: 400 });
  }

  await grantEntitlement({ userId, sku, source: "grant", platform: "admin" });
  return NextResponse.json({ ok: true }, { status: 201 });
}
