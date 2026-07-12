import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { reviewQueue } from "@/db/schema";
import { submitBirthDate } from "@/lib/server/ageGate";
import { ReportError, submitReport } from "@/lib/server/reports";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
import { auth } from "@/auth";
import { POST as reportPOST } from "@/app/api/report/route";

describe("submitReport", () => {
  beforeEach(resetDb);

  it("first report creates a queue row owned by the content author", async () => {
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    const reporter = await makeUser({ houseId: "bidet" });
    const { reviewId } = await submitReport(reporter, { subjectKind: "throne", subjectId: throne.id, reason: "closed" });
    const [q] = await db.select().from(reviewQueue);
    expect(q.id).toBe(reviewId);
    expect(q.kind).toBe("report");
    expect(q.severity).toBe("low"); // closed → low
    expect(q.userId).toBe(adder.id); // the AUTHOR, not the reporter
    expect(q.signals).toEqual([{ signal: "user_report", reason: "closed", reporterCount: 1 }]);
  });

  it("duplicate report from the same user 409s", async () => {
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    const reporter = await makeUser();
    await submitReport(reporter, { subjectKind: "throne", subjectId: throne.id, reason: "spam" });
    await expect(
      submitReport(reporter, { subjectKind: "throne", subjectId: throne.id, reason: "closed" })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("second reporter merges into the pending row and escalates severity", async () => {
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    const r1 = await makeUser();
    const r2 = await makeUser();
    await submitReport(r1, { subjectKind: "throne", subjectId: throne.id, reason: "wrong_info" });
    await submitReport(r2, { subjectKind: "throne", subjectId: throne.id, reason: "inappropriate" });
    const rows = await db.select().from(reviewQueue);
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe("medium"); // low escalated one step at 2 reporters
    expect(rows[0].signals).toHaveLength(2);
  });

  it("reporting a hidden or missing subject 404s", async () => {
    const reporter = await makeUser();
    await expect(
      submitReport(reporter, { subjectKind: "throne", subjectId: "00000000-0000-0000-0000-000000000009", reason: "spam" })
    ).rejects.toBeInstanceOf(ReportError);
  });

  it("daily cap 429s at 20", async () => {
    const adder = await makeUser();
    const reporter = await makeUser();
    for (let i = 0; i < 20; i++) {
      const t = await makeThrone(adder.id, { name: `T${i}` });
      await submitReport(reporter, { subjectKind: "throne", subjectId: t.id, reason: "closed" });
    }
    const extra = await makeThrone(adder.id, { name: "one-too-many" });
    await expect(
      submitReport(reporter, { subjectKind: "throne", subjectId: extra.id, reason: "closed" })
    ).rejects.toMatchObject({ status: 429 });
  });
});

describe("POST /api/report gates", () => {
  beforeEach(resetDb);

  it("401 anonymous; 403 unattested; 201 attested", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const adder = await makeUser();
    const throne = await makeThrone(adder.id);
    const body = { subjectKind: "throne", subjectId: throne.id, reason: "closed" };
    const mk = () => new Request("http://test/api/report", { method: "POST", body: JSON.stringify(body) });
    expect((await reportPOST(mk())).status).toBe(401);

    const user = await makeUser();
    vi.mocked(auth).mockResolvedValue({ googleSubject: user.googleSubject } as never);
    expect((await reportPOST(mk())).status).toBe(403);

    await submitBirthDate(user.googleSubject, "1990-01-01");
    expect((await reportPOST(mk())).status).toBe(201);
  });
});
