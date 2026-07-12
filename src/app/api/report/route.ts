import { NextResponse } from "next/server";
import { z } from "zod";
import { AgeGateError, requireAgeGate } from "@/lib/server/ageGate";
import { ReportError, submitReport } from "@/lib/server/reports";
import { sessionInfo } from "@/lib/server/session";
import { requireGoodStanding, StandingError } from "@/lib/server/standing";

const bodySchema = z.object({
  subjectKind: z.enum(["throne", "rating"]),
  subjectId: z.string().uuid(),
  reason: z.enum(["wrong_info", "closed", "inappropriate", "not_public_restroom", "harassment", "spam"]),
  note: z.string().trim().max(280).optional(),
});

export async function POST(req: Request) {
  const info = await sessionInfo();
  if (info.kind !== "user") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  try {
    await requireAgeGate(info.user.googleSubject);
    requireGoodStanding(info.user);
    const result = await submitReport(info.user, parsed.data);
    return NextResponse.json({ ok: true, reportId: result.reportId }, { status: 201 });
  } catch (e) {
    if (e instanceof AgeGateError) return NextResponse.json({ error: e.code }, { status: e.status });
    if (e instanceof StandingError) return NextResponse.json({ error: e.code, until: e.until ?? null }, { status: e.status });
    if (e instanceof ReportError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
