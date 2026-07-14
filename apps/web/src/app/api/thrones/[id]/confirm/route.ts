import { NextResponse } from "next/server";
import { AgeGateError, requireAgeGate } from "@/lib/server/ageGate";
import { confirmThrone, ThroneError } from "@/lib/server/thrones";
import { sessionInfo } from "@/lib/server/session";
import { enforceHardCeiling, evaluateSignals, RateLimitError } from "@/lib/server/signals";
import { requireGoodStanding, StandingError } from "@/lib/server/standing";
import { scheduleTriage } from "@/lib/server/triage";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const info = await sessionInfo();
  if (info.kind !== "user") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    await requireAgeGate(info.user.googleSubject);
    requireGoodStanding(info.user);
    await enforceHardCeiling(info.user.id);

    const now = Date.now();
    const throne = await confirmThrone(info.user, id, now);

    const row = await evaluateSignals({ kind: "confirmation", subjectId: throne.id, user: info.user }, now);
    if (row) scheduleTriage(row.id);

    return NextResponse.json({ ok: true, status: throne.status });
  } catch (e) {
    if (e instanceof AgeGateError) return NextResponse.json({ error: e.code }, { status: e.status });
    if (e instanceof StandingError) return NextResponse.json({ error: e.code, until: e.until ?? null }, { status: e.status });
    if (e instanceof RateLimitError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof ThroneError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
