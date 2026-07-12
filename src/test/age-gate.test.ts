import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { ageAttestations } from "@/db/schema";
import { AgeGateError, ageGateStatus, requireAgeGate, submitBirthDate } from "@/lib/server/ageGate";
import { resetDb } from "./db";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
import { auth } from "@/auth";
import { POST as ageGatePOST } from "@/app/api/age-gate/route";

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("submitBirthDate", () => {
  beforeEach(resetDb);

  it("confirms someone who turns 13 exactly today, discards the date", async () => {
    const now = new Date("2026-07-11T12:00:00Z");
    const result = await submitBirthDate("sub-x", "2013-07-11", now);
    expect(result).toEqual({ confirmed: true, locked: false });
    const rows = await db.select().from(ageAttestations);
    expect(rows).toHaveLength(1);
    expect(rows[0].over13ConfirmedAt).not.toBeNull(); // only a timestamp — no birthdate column exists
  });

  it("locks someone who turns 13 tomorrow, and the lock survives retries", async () => {
    const now = new Date("2026-07-11T12:00:00Z");
    expect(await submitBirthDate("sub-y", "2013-07-12", now)).toEqual({ confirmed: false, locked: true });
    // retry with an adult birthdate — still locked
    expect(await submitBirthDate("sub-y", "1990-01-01", now)).toEqual({ confirmed: false, locked: true });
  });

  it("is idempotent once confirmed", async () => {
    const now = new Date();
    await submitBirthDate("sub-z", iso(new Date(now.getTime() - 20 * 365 * DAY)), now);
    expect(await ageGateStatus("sub-z")).toEqual({ confirmed: true, locked: false });
  });
});

describe("requireAgeGate", () => {
  beforeEach(resetDb);

  it("throws age_gate_required with 403 when unattested", async () => {
    await expect(requireAgeGate("sub-none")).rejects.toMatchObject({ code: "age_gate_required", status: 403 });
  });

  it("throws age_gate_locked when locked", async () => {
    await submitBirthDate("sub-kid", "2020-01-01", new Date());
    await expect(requireAgeGate("sub-kid")).rejects.toBeInstanceOf(AgeGateError);
    await expect(requireAgeGate("sub-kid")).rejects.toMatchObject({ code: "age_gate_locked" });
  });

  it("passes when confirmed", async () => {
    await submitBirthDate("sub-ok", "1990-01-01", new Date());
    await expect(requireAgeGate("sub-ok")).resolves.toBeUndefined();
  });
});

describe("POST /api/age-gate", () => {
  beforeEach(resetDb);

  it("401s without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const res = await ageGatePOST(new Request("http://test/api/age-gate", {
      method: "POST", body: JSON.stringify({ birthDate: "1990-01-01" }),
    }));
    expect(res.status).toBe(401);
  });

  it("confirms an adult birthdate for a signed-in session without a profile", async () => {
    vi.mocked(auth).mockResolvedValue({ googleSubject: "sub-api" } as never);
    const res = await ageGatePOST(new Request("http://test/api/age-gate", {
      method: "POST", body: JSON.stringify({ birthDate: "1990-01-01" }),
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ confirmed: true, locked: false });
  });

  it("400s a malformed date", async () => {
    vi.mocked(auth).mockResolvedValue({ googleSubject: "sub-api" } as never);
    const res = await ageGatePOST(new Request("http://test/api/age-gate", {
      method: "POST", body: JSON.stringify({ birthDate: "not-a-date" }),
    }));
    expect(res.status).toBe(400);
  });
});
