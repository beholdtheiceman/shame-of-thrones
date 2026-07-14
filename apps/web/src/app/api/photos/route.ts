import { NextResponse } from "next/server";
import { AgeGateError, requireAgeGate } from "@/lib/server/ageGate";
import { PhotoError, submitPhoto } from "@/lib/server/photos";
import { sessionInfo } from "@/lib/server/session";
import { enforceHardCeiling, RateLimitError } from "@/lib/server/signals";
import { requireGoodStanding, StandingError } from "@/lib/server/standing";

export async function POST(req: Request) {
  const info = await sessionInfo();
  if (info.kind !== "user") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const throneId = form?.get("throneId");
  if (!form || !(file instanceof File) || typeof throneId !== "string") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    await requireAgeGate(info.user.googleSubject);
    requireGoodStanding(info.user);
    await enforceHardCeiling(info.user.id);
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await submitPhoto(info.user, { throneId, bytes, contentType: file.type });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    if (e instanceof AgeGateError) return NextResponse.json({ error: e.code }, { status: e.status });
    if (e instanceof StandingError) return NextResponse.json({ error: e.code, until: e.until ?? null }, { status: e.status });
    if (e instanceof RateLimitError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof PhotoError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
