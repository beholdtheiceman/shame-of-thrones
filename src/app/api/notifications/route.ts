import { NextResponse } from "next/server";
import { notificationsPayload } from "@/lib/server/notifications";
import { sessionInfo } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const info = await sessionInfo();
  if (info.kind !== "user") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await notificationsPayload(info.user.id));
}
