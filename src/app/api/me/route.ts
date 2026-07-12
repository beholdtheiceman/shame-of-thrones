import { NextResponse } from "next/server";
import { sessionInfo } from "@/lib/server/session";
import { ageGateStatus } from "@/lib/server/ageGate";
import { mePayload } from "@/lib/server/profile";

export const dynamic = "force-dynamic";

export async function GET() {
  const info = await sessionInfo();
  if (info.kind === "anonymous") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sub = info.kind === "user" ? info.user.googleSubject : info.googleSubject;
  const ageGate = await ageGateStatus(sub);

  if (info.kind === "no_profile") return NextResponse.json({ profile: null, ageGate });
  return NextResponse.json({ ...(await mePayload(info.user.id)), ageGate });
}
