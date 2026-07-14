import { NextResponse } from "next/server";
import { z } from "zod";
import { markNotificationsRead } from "@/lib/server/notifications";
import { sessionInfo } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ ids: z.array(z.uuid()).max(50).optional() }).strict();

export async function POST(req: Request) {
  const info = await sessionInfo();
  if (info.kind !== "user") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  await markNotificationsRead(info.user.id, parsed.data.ids);
  return NextResponse.json({ ok: true });
}
