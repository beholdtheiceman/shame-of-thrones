import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { ageAttestations } from "@/db/schema";

export interface AgeGateStatus {
  confirmed: boolean;
  locked: boolean;
}

export class AgeGateError extends Error {
  status = 403;
  constructor(public code: "age_gate_required" | "age_gate_locked") {
    super(code);
  }
}

export async function ageGateStatus(googleSubject: string): Promise<AgeGateStatus> {
  const row = await db.query.ageAttestations.findFirst({
    where: eq(ageAttestations.googleSubject, googleSubject),
  });
  return { confirmed: !!row?.over13ConfirmedAt, locked: !!row?.lockedAt };
}

/** Calendar-correct: you turn 13 ON your 13th birthday (UTC). */
function isAtLeast13(birthDate: string, now: Date): boolean {
  const [y, m, d] = birthDate.split("-").map(Number);
  const thirteenthBirthday = Date.UTC(y + 13, m - 1, d);
  return now.getTime() >= thirteenthBirthday;
}

/** COPPA neutral gate. The birthdate is computed against and discarded —
 * only the outcome timestamp is stored. A lock is permanent. */
export async function submitBirthDate(
  googleSubject: string,
  birthDate: string,
  now = new Date()
): Promise<AgeGateStatus> {
  const existing = await ageGateStatus(googleSubject);
  if (existing.locked || existing.confirmed) return existing;

  if (isAtLeast13(birthDate, now)) {
    await db.insert(ageAttestations)
      .values({ googleSubject, over13ConfirmedAt: now })
      .onConflictDoUpdate({
        target: ageAttestations.googleSubject,
        set: { over13ConfirmedAt: now },
      });
    return { confirmed: true, locked: false };
  }

  await db.insert(ageAttestations)
    .values({ googleSubject, lockedAt: now })
    .onConflictDoUpdate({
      target: ageAttestations.googleSubject,
      set: { lockedAt: now },
    });
  return { confirmed: false, locked: true };
}

export async function requireAgeGate(googleSubject: string): Promise<void> {
  const status = await ageGateStatus(googleSubject);
  if (status.locked) throw new AgeGateError("age_gate_locked");
  if (!status.confirmed) throw new AgeGateError("age_gate_required");
}
