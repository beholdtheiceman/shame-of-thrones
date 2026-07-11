import { NextResponse } from "next/server";
import { sessionInfo } from "@/lib/server/session";
import { mePayload } from "@/lib/server/profile";

export const dynamic = "force-dynamic";

export async function GET() {
  const info = await sessionInfo();
  if (info.kind === "anonymous") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (info.kind === "no_profile") return NextResponse.json({ profile: null });
  return NextResponse.json(await mePayload(info.user.id));
}
