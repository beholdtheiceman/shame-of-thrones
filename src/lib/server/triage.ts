import Anthropic from "@anthropic-ai/sdk";
import { and, eq, gte, sql } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/db/client";
import { ratings, reviewQueue, thrones, users } from "@/db/schema";

type Severity = "low" | "medium" | "high";
const SEVERITIES: readonly Severity[] = ["low", "medium", "high"];

export interface TriageClient {
  triage(prompt: string): Promise<{ assessment: string; severity: Severity }>;
}

const SYSTEM = `You are the Maester of Records for "Shame of Thrones", a playful
restroom-rating game with a territory mechanic. You triage flagged user actions
for a human moderator. You see the tripped heuristic signals and the action's
context. Write a short plain-English read of what is probably happening (benign
enthusiasm vs. gaming vs. policy problem like a private residence being charted),
and suggest a severity. Be concrete and calm; the moderator decides, not you.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    assessment: { type: "string", description: "2-4 sentences for the moderator" },
    severity: { type: "string", enum: ["low", "medium", "high"] },
  },
  required: ["assessment", "severity"],
  additionalProperties: false,
} as const;

export function anthropicTriageClient(): TriageClient {
  const model = process.env.TRIAGE_MODEL ?? "claude-haiku-4-5";
  return {
    async triage(prompt) {
      // Constructed lazily so a missing ANTHROPIC_API_KEY surfaces as a
      // caught triage failure (aiError on the row), not an unhandled throw.
      const client = new Anthropic();
      const response = await client.messages.create({
        model,
        max_tokens: 1024,
        system: SYSTEM,
        output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.content.find((b) => b.type === "text")?.text ?? "";
      const parsed = JSON.parse(text) as { assessment: string; severity: string };
      const severity = SEVERITIES.includes(parsed.severity as Severity)
        ? (parsed.severity as Severity)
        : "medium";
      return { assessment: parsed.assessment, severity };
    },
  };
}

/** Builds the moderator-context prompt: signals + subject + a compact activity
 * summary (counts and timestamps — display name is the only PII sent). */
async function buildPrompt(row: typeof reviewQueue.$inferSelect): Promise<string> {
  const user = await db.query.users.findFirst({ where: eq(users.id, row.userId) });
  const count = sql<number>`count(*)::int`;
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [[ratingCount], [recentRatings], [throneCount]] = await Promise.all([
    db.select({ n: count }).from(ratings).where(eq(ratings.userId, row.userId)),
    db.select({ n: count }).from(ratings)
      .where(and(eq(ratings.userId, row.userId), gte(ratings.createdAt, weekAgo))),
    db.select({ n: count }).from(thrones).where(eq(thrones.addedBy, row.userId)),
  ]);

  let subject = "";
  if (row.kind === "rating") {
    const rating = await db.query.ratings.findFirst({ where: eq(ratings.id, row.subjectId) });
    const throne = rating
      ? await db.query.thrones.findFirst({ where: eq(thrones.id, rating.throneId) })
      : undefined;
    subject = `A ${rating?.verified ? "verified" : "hearsay"} rating (verdict ${rating?.verdict}/5, tags: ${rating?.tags.join(", ") || "none"}) at throne "${throne?.name}" (category ${throne?.category}, at ${throne?.lat}, ${throne?.lng}).`;
  } else {
    const throne = await db.query.thrones.findFirst({ where: eq(thrones.id, row.subjectId) });
    subject = `${row.kind === "new_throne" ? "A newly charted throne" : "A confirmation of throne"}: "${throne?.name}" (category ${throne?.category}, at ${throne?.lat}, ${throne?.lng}, status ${throne?.status}).`;
  }

  return [
    `Flagged action kind: ${row.kind}`,
    `Tripped signals: ${JSON.stringify(row.signals)}`,
    `Rule-assigned severity: ${row.severity}`,
    `Subject: ${subject}`,
    `Actor: "${user?.displayName}", account created ${user?.joinedAt.toISOString()}, ` +
      `${ratingCount.n} lifetime ratings (${recentRatings.n} in the last 7 days), ${throneCount.n} thrones charted.`,
    `What is probably going on here, and what severity would you assign?`,
  ].join("\n");
}

export async function runTriage(
  reviewId: string,
  client: TriageClient = anthropicTriageClient()
): Promise<void> {
  const row = await db.query.reviewQueue.findFirst({ where: eq(reviewQueue.id, reviewId) });
  if (!row || row.status !== "pending") return;
  try {
    const prompt = await buildPrompt(row);
    const result = await client.triage(prompt);
    await db.update(reviewQueue).set({
      aiAssessment: result.assessment,
      aiSeverity: result.severity,
      aiTriagedAt: new Date(),
      aiError: null,
    }).where(eq(reviewQueue.id, reviewId));
  } catch (e) {
    await db.update(reviewQueue).set({
      aiError: e instanceof Error ? e.message : String(e),
    }).where(eq(reviewQueue.id, reviewId));
  }
}

/** Fire triage in the background after the response is sent. Falls back to
 * fire-and-forget outside a Next request scope (tests never hit this — they
 * call runTriage directly with a fake client). */
export function scheduleTriage(reviewId: string): void {
  try {
    after(() => runTriage(reviewId));
  } catch {
    void runTriage(reviewId);
  }
}
