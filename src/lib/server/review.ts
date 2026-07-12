import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { ratings, reviewQueue, thrones, users } from "@/db/schema";
import { sessionInfo } from "./session";

export interface ReviewItemDTO {
  id: string;
  kind: "rating" | "new_throne" | "confirmation" | "report" | "testimony";
  severity: "low" | "medium" | "high";
  status: "pending" | "resolved";
  signals: unknown[];
  actor: string;
  subject: string;
  aiAssessment: string | null;
  aiSeverity: "low" | "medium" | "high" | null;
  aiTriagedAt: number | null;
  aiError: string | null;
  createdAt: number;
  resolvedAt: number | null;
  resolutionNote: string | null;
}

/** Moderator gate: null → the route responds 404 (not 403), so the surface
 * doesn't advertise itself. */
export async function moderatorOrNull() {
  const info = await sessionInfo();
  if (info.kind !== "user" || info.user.role !== "moderator") return null;
  return info.user;
}

async function subjectSummary(row: typeof reviewQueue.$inferSelect): Promise<string> {
  if (row.kind === "rating") {
    const rating = await db.query.ratings.findFirst({ where: eq(ratings.id, row.subjectId) });
    if (!rating) return "Rating (missing)";
    const throne = await db.query.thrones.findFirst({ where: eq(thrones.id, rating.throneId) });
    return `${rating.verified ? "Verified" : "Hearsay"} ${rating.verdict}/5 rating at "${throne?.name ?? "?"}"`;
  }
  const throne = await db.query.thrones.findFirst({ where: eq(thrones.id, row.subjectId) });
  const label = row.kind === "new_throne" ? "New throne" : "Confirmation of";
  return `${label} "${throne?.name ?? "?"}"`;
}

/** Pending first (newest first), then a short tail of recently resolved. */
export async function listReview(): Promise<ReviewItemDTO[]> {
  const pending = await db.select().from(reviewQueue)
    .where(eq(reviewQueue.status, "pending"))
    .orderBy(desc(reviewQueue.createdAt)).limit(100);
  const resolved = await db.select().from(reviewQueue)
    .where(eq(reviewQueue.status, "resolved"))
    .orderBy(desc(reviewQueue.resolvedAt)).limit(10);
  const rows = [...pending, ...resolved];
  if (rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.userId))];
  const actorRows = await db.select({ id: users.id, name: users.displayName })
    .from(users).where(inArray(users.id, userIds));
  const nameById = new Map(actorRows.map((u) => [u.id, u.name]));

  return Promise.all(rows.map(async (row) => ({
    id: row.id, kind: row.kind, severity: row.severity, status: row.status,
    signals: row.signals,
    actor: nameById.get(row.userId) ?? "?",
    subject: await subjectSummary(row),
    aiAssessment: row.aiAssessment, aiSeverity: row.aiSeverity,
    aiTriagedAt: row.aiTriagedAt?.getTime() ?? null,
    aiError: row.aiError,
    createdAt: row.createdAt.getTime(),
    resolvedAt: row.resolvedAt?.getTime() ?? null,
    resolutionNote: row.resolutionNote,
  })));
}

export async function resolveReview(reviewId: string, moderatorId: string, note?: string): Promise<void> {
  await db.update(reviewQueue).set({
    status: "resolved", resolvedBy: moderatorId, resolvedAt: new Date(),
    resolutionNote: note?.trim() || null,
  }).where(eq(reviewQueue.id, reviewId));
}
