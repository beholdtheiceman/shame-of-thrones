import { NextResponse } from "next/server";
import { z } from "zod";
import { RATING_TAGS } from "@/lib/game/rules";
import { AgeGateError, requireAgeGate } from "@/lib/server/ageGate";
import { RatingError, submitRating } from "@/lib/server/ratings";
import { sessionInfo } from "@/lib/server/session";
import { enforceHardCeiling, evaluateSignals, RateLimitError } from "@/lib/server/signals";
import { scheduleTriage } from "@/lib/server/triage";

const bodySchema = z.object({
  throneId: z.string().uuid(),
  verdict: z.number().int().min(1).max(5),
  tags: z.array(z.string().refine((t) => (RATING_TAGS as readonly string[]).includes(t), "unknown tag")).default([]),
  verified: z.boolean(),
});

export async function POST(req: Request) {
  const info = await sessionInfo();
  if (info.kind !== "user") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  try {
    await requireAgeGate(info.user.googleSubject);
    await enforceHardCeiling(info.user.id);

    const now = Date.now();
    const result = await submitRating(info.user, {
      ...parsed.data,
      verdict: parsed.data.verdict as 1 | 2 | 3 | 4 | 5,
    }, now);

    if (!result.updated) {
      const row = await evaluateSignals({
        kind: "rating", subjectId: result.ratingId, user: info.user,
        rating: { id: result.ratingId, verified: parsed.data.verified, createdAt: now, throne: result.throne },
      }, now);
      if (row) scheduleTriage(row.id);
    }

    return NextResponse.json(result, { status: result.updated ? 200 : 201 });
  } catch (e) {
    if (e instanceof AgeGateError) return NextResponse.json({ error: e.code }, { status: e.status });
    if (e instanceof RateLimitError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof RatingError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
