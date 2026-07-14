import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { photos, ratings, reports, reviewQueue, thrones, users, type ReviewSignal } from "@/db/schema";
import { scheduleTriage } from "./triage";

type UserRow = typeof users.$inferSelect;
type ReportReason = (typeof reports.$inferSelect)["reason"];
type Severity = "low" | "medium" | "high";

const DAY_MS = 86_400_000;
const REPORT_DAILY_CAP = 20;

const SEVERITY_BY_REASON: Record<ReportReason, Severity> = {
  wrong_info: "low", closed: "low",
  inappropriate: "medium", not_public_restroom: "medium", harassment: "medium", spam: "medium",
};

const ESCALATE: Record<Severity, Severity> = { low: "medium", medium: "high", high: "high" };

export class ReportError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export interface SubmitReportInput {
  subjectKind: "throne" | "rating" | "photo";
  subjectId: string;
  reason: ReportReason;
  note?: string;
}

export async function submitReport(reporter: UserRow, input: SubmitReportInput, now = Date.now()) {
  // Subject must exist and be visible; the queue row belongs to the content author.
  let authorId: string;
  if (input.subjectKind === "throne") {
    const t = await db.query.thrones.findFirst({ where: eq(thrones.id, input.subjectId) });
    if (!t || t.hiddenAt) throw new ReportError("no such throne", 404);
    authorId = t.addedBy;
  } else if (input.subjectKind === "photo") {
    const p = await db.query.photos.findFirst({ where: eq(photos.id, input.subjectId) });
    if (!p || p.status !== "approved") throw new ReportError("no such photo", 404);
    authorId = p.uploadedBy;
  } else {
    const r = await db.query.ratings.findFirst({ where: eq(ratings.id, input.subjectId) });
    if (!r || r.hiddenAt) throw new ReportError("no such rating", 404);
    authorId = r.userId;
  }

  const [{ n: todays }] = await db.select({ n: sql<number>`count(*)::int` }).from(reports)
    .where(and(eq(reports.reporterId, reporter.id), gte(reports.createdAt, new Date(now - DAY_MS))));
  if (todays >= REPORT_DAILY_CAP) {
    throw new ReportError("The Maesters can hear no more from you today.", 429);
  }

  let report;
  try {
    [report] = await db.insert(reports).values({
      reporterId: reporter.id, subjectKind: input.subjectKind, subjectId: input.subjectId,
      reason: input.reason, note: input.note?.trim() || null, createdAt: new Date(now),
    }).returning();
  } catch (e) {
    const text = `${(e as { cause?: unknown })?.cause ?? ""}${e instanceof Error ? e.message : ""}`;
    if (text.includes("reports_reporter_subject_idx")) {
      throw new ReportError("You have already raised this banner.", 409);
    }
    throw e;
  }

  const [{ n: reporterCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(reports)
    .where(and(eq(reports.subjectKind, input.subjectKind), eq(reports.subjectId, input.subjectId)));
  const signal: ReviewSignal = { signal: "user_report", reason: input.reason, reporterCount };

  const existing = await db.query.reviewQueue.findFirst({
    where: and(
      eq(reviewQueue.kind, "report"),
      eq(reviewQueue.subjectId, input.subjectId),
      eq(reviewQueue.status, "pending")
    ),
  });

  if (existing) {
    await db.update(reviewQueue).set({
      signals: [...existing.signals, signal],
      severity: reporterCount >= 2 ? ESCALATE[existing.severity] : existing.severity,
    }).where(eq(reviewQueue.id, existing.id));
    return { reportId: report.id, reviewId: existing.id };
  }

  const [row] = await db.insert(reviewQueue).values({
    kind: "report", subjectId: input.subjectId, userId: authorId,
    signals: [signal], severity: SEVERITY_BY_REASON[input.reason], createdAt: new Date(now),
  }).returning();
  scheduleTriage(row.id);
  return { reportId: report.id, reviewId: row.id };
}
