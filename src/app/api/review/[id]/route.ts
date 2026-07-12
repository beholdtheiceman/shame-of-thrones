import { NextResponse } from "next/server";
import { z } from "zod";
import { moderatorOrNull, resolveReview } from "@/lib/server/review";

const bodySchema = z.object({
  action: z.literal("resolve"),
  note: z.string().max(500).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const mod = await moderatorOrNull();
  if (!mod) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  await resolveReview(id, mod.id, parsed.data.note);
  return NextResponse.json({ ok: true });
}
