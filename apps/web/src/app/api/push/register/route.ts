import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { pushTokens } from "@/db/schema";
import { sessionInfo } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  token: z.string().min(1),
  platform: z.string().optional(),
});

export async function POST(req: Request) {
  const info = await sessionInfo();
  if (info.kind !== "user") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  await db
    .insert(pushTokens)
    .values({ userId: info.user.id, token: parsed.data.token, platform: parsed.data.platform })
    .onConflictDoUpdate({
      target: pushTokens.token,
      set: { userId: info.user.id, platform: parsed.data.platform },
    });

  return NextResponse.json({ ok: true });
}
