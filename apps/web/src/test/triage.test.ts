import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { reviewQueue } from "@/db/schema";
import { runTriage, type TriageClient } from "@/lib/server/triage";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

async function makeReviewRow(userId: string, subjectId: string) {
  const [row] = await db.insert(reviewQueue).values({
    kind: "new_throne", subjectId, userId,
    signals: [{ signal: "new_throne" }], severity: "low",
  }).returning();
  return row;
}

describe("runTriage", () => {
  beforeEach(resetDb);

  it("writes the assessment and suggested severity back onto the row", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id, { name: "Steve's Apartment Bathroom" });
    const row = await makeReviewRow(user.id, throne.id);

    const prompts: string[] = [];
    const fake: TriageClient = {
      async triage(prompt) {
        prompts.push(prompt);
        return { assessment: "Name suggests a private residence.", severity: "high" };
      },
    };
    await runTriage(row.id, fake);

    const [updated] = await db.select().from(reviewQueue).where(eq(reviewQueue.id, row.id));
    expect(updated.aiAssessment).toBe("Name suggests a private residence.");
    expect(updated.aiSeverity).toBe("high");
    expect(updated.aiTriagedAt).not.toBeNull();
    expect(updated.aiError).toBeNull();
    expect(prompts[0]).toContain("Steve's Apartment Bathroom"); // subject context reaches the model
  });

  it("records the failure on aiError and leaves the row pending triage", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const row = await makeReviewRow(user.id, throne.id);

    const failing: TriageClient = {
      async triage() { throw new Error("api unreachable"); },
    };
    await runTriage(row.id, failing);

    const [updated] = await db.select().from(reviewQueue).where(eq(reviewQueue.id, row.id));
    expect(updated.aiAssessment).toBeNull();
    expect(updated.aiTriagedAt).toBeNull();
    expect(updated.aiError).toContain("api unreachable");
  });

  it("re-running after a failure clears aiError on success", async () => {
    const user = await makeUser();
    const throne = await makeThrone(user.id);
    const row = await makeReviewRow(user.id, throne.id);
    await runTriage(row.id, { async triage() { throw new Error("boom"); } });
    await runTriage(row.id, { async triage() { return { assessment: "Looks fine.", severity: "low" }; } });

    const [updated] = await db.select().from(reviewQueue).where(eq(reviewQueue.id, row.id));
    expect(updated.aiError).toBeNull();
    expect(updated.aiAssessment).toBe("Looks fine.");
  });
});
