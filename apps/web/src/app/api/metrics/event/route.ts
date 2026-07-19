import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { metricsEvents } from "@/db/schema";
import { sessionInfo } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const NAMES = new Set(["time_to_rate", "nwt_outcome"]);

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const name = body?.name;
  if (typeof name !== "string" || !NAMES.has(name)) {
    return NextResponse.json({ error: "invalid name" }, { status: 400 });
  }
  const meta =
    body?.meta && typeof body.meta === "object" && !Array.isArray(body.meta)
      ? (body.meta as Record<string, unknown>)
      : {};

  // Fail-soft: instrumentation must never break the UX. Any failure (session,
  // insert) still returns ok:true so the client keeps working.
  try {
    const info = await sessionInfo();
    const userId = info.kind === "user" ? info.user.id : null;
    await db.insert(metricsEvents).values({ name, userId, meta });
  } catch {
    // swallow — never surface instrumentation errors to the client
  }
  return NextResponse.json({ ok: true });
}
