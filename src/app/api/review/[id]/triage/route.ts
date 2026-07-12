import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { reviewQueue } from "@/db/schema";
import { moderatorOrNull } from "@/lib/server/review";
import { runTriage } from "@/lib/server/triage";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const mod = await moderatorOrNull();
  if (!mod) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { id } = await params;
  await runTriage(id);
  const row = await db.query.reviewQueue.findFirst({ where: eq(reviewQueue.id, id) });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: !row.aiError, aiError: row.aiError });
}
