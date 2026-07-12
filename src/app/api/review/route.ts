import { NextResponse } from "next/server";
import { listReview, moderatorOrNull } from "@/lib/server/review";

export const dynamic = "force-dynamic";

export async function GET() {
  const mod = await moderatorOrNull();
  if (!mod) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ items: await listReview() });
}
