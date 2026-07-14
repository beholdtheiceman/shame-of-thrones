import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { reviewQueue } from "@/db/schema";
import { RATING_TAGS } from "@/lib/game/rules";
import { AgeGateError, requireAgeGate } from "@/lib/server/ageGate";
import { RatingError, submitRating } from "@/lib/server/ratings";
import { sessionInfo } from "@/lib/server/session";
import { enforceHardCeiling, evaluateSignals, RateLimitError } from "@/lib/server/signals";
import { requireGoodStanding, StandingError } from "@/lib/server/standing";
import { screenTestimony, type ScreenResult } from "@/lib/server/testimonyScreen";
import { scheduleTriage } from "@/lib/server/triage";

const bodySchema = z.object({
  throneId: z.string().uuid(),
  verdict: z.number().int().min(1).max(5),
  tags: z.array(z.string().refine((t) => (RATING_TAGS as readonly string[]).includes(t), "unknown tag")).default([]),
  verified: z.boolean(),
  testimony: z.string().trim().max(280).optional(),
});

async function queueTestimonyRow(
  ratingId: string, userId: string, screen: ScreenResult, blocked: boolean, now: number
) {
  const unavailable = screen.category === "screen_unavailable";
  const [row] = await db.insert(reviewQueue).values({
    kind: "testimony",
    subjectId: ratingId,
    userId,
    signals: blocked
      ? [{ signal: "testimony_blocked", category: screen.category ?? "unspecified" }]
      : unavailable
        ? [{ signal: "screen_unavailable" }]
        : [{ signal: "testimony_flagged", category: screen.category }],
    severity: blocked ? "high" : "medium",
    // The screen's note doubles as triage — except when the screen never ran.
    ...(unavailable
      ? {}
      : { aiAssessment: screen.note, aiSeverity: blocked ? ("high" as const) : ("medium" as const), aiTriagedAt: new Date(now) }),
    createdAt: new Date(now),
  }).returning();
  if (unavailable) scheduleTriage(row.id);
}

export async function POST(req: Request) {
  const info = await sessionInfo();
  if (info.kind !== "user") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  try {
    await requireAgeGate(info.user.googleSubject);
    requireGoodStanding(info.user);
    await enforceHardCeiling(info.user.id);

    const now = Date.now();
    const testimony = parsed.data.testimony?.trim() || undefined;
    let screen: ScreenResult | null = null;
    let testimonyBlocked = false;

    if (testimony) {
      screen = await screenTestimony(testimony);
      if (screen.verdict === "block") testimonyBlocked = true; // rating posts, words do not
    }

    const result = await submitRating(info.user, {
      throneId: parsed.data.throneId,
      verdict: parsed.data.verdict as 1 | 2 | 3 | 4 | 5,
      tags: parsed.data.tags,
      verified: parsed.data.verified,
      ...(testimony !== undefined && !testimonyBlocked ? { testimony } : {}),
    }, now);

    if (screen && screen.verdict !== "allow") {
      await queueTestimonyRow(result.ratingId, info.user.id, screen, testimonyBlocked, now);
    }

    if (!result.updated) {
      const row = await evaluateSignals({
        kind: "rating", subjectId: result.ratingId, user: info.user,
        rating: { id: result.ratingId, verified: parsed.data.verified, createdAt: now, throne: result.throne },
      }, now);
      if (row) scheduleTriage(row.id);
    }

    return NextResponse.json({ ...result, testimonyBlocked }, { status: result.updated ? 200 : 201 });
  } catch (e) {
    if (e instanceof AgeGateError) return NextResponse.json({ error: e.code }, { status: e.status });
    if (e instanceof StandingError) return NextResponse.json({ error: e.code, until: e.until ?? null }, { status: e.status });
    if (e instanceof RateLimitError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof RatingError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
