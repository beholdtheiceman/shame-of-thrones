import { NextResponse } from "next/server";
import { metricsPayload } from "@/lib/server/metrics";
import { sessionInfo } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const info = await sessionInfo();
  if (info.kind !== "user" || info.user.role !== "moderator") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json(await metricsPayload());
}
