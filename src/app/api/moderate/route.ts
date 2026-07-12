import { NextResponse } from "next/server";
import { z } from "zod";
import { EnforcementError, hideRating, hideTestimony, hideThrone } from "@/lib/server/enforcement";
import { approvePhoto, PhotoError, rejectPhoto } from "@/lib/server/photos";
import { moderatorOrNull, resolveReview } from "@/lib/server/review";
import { banUser, reinstateUser, suspendUser } from "@/lib/server/standing";

const bodySchema = z.object({
  action: z.enum(["hide_throne", "hide_rating", "hide_testimony", "suspend_user", "ban_user", "reinstate_user", "approve_photo", "reject_photo"]),
  subjectId: z.string().uuid(), // throne id, rating id, or user id per action
  days: z.number().int().min(1).max(365).optional(),
  note: z.string().trim().max(500).optional(),
  reviewId: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  const mod = await moderatorOrNull();
  if (!mod) return NextResponse.json({ error: "not found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const { action, subjectId, days, note, reviewId } = parsed.data;

  try {
    switch (action) {
      case "hide_throne": await hideThrone(subjectId, mod); break;
      case "hide_rating": await hideRating(subjectId, mod); break;
      case "hide_testimony": await hideTestimony(subjectId, mod); break;
      case "suspend_user": await suspendUser(subjectId, days ?? 7); break;
      case "ban_user": await banUser(subjectId); break;
      case "reinstate_user": await reinstateUser(subjectId); break;
      case "approve_photo": await approvePhoto(subjectId, mod); break;
      case "reject_photo": await rejectPhoto(subjectId, mod, note); break;
    }
    if (reviewId) {
      await resolveReview(reviewId, mod.id, `[${action}] ${note ?? ""}`.trim());
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof EnforcementError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof PhotoError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
