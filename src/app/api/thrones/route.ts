import { NextResponse } from "next/server";
import { z } from "zod";
import { AgeGateError, requireAgeGate } from "@/lib/server/ageGate";
import { addThrone } from "@/lib/server/thrones";
import { sessionInfo } from "@/lib/server/session";
import { enforceHardCeiling, evaluateSignals, RateLimitError } from "@/lib/server/signals";
import { scheduleTriage } from "@/lib/server/triage";

const bodySchema = z.object({
  name: z.string().trim().min(2).max(80),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  category: z.enum(["cafe", "restaurant", "park", "transit", "library", "retail", "municipal", "gas_station", "other"]),
  amenities: z.object({
    accessible: z.boolean(), babyChanging: z.boolean(), genderNeutral: z.boolean(),
    freeAccess: z.boolean(), open24h: z.boolean(),
  }),
  publicAccessAttested: z.literal(true), // private residences may not be charted
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
    const throne = await addThrone(info.user, parsed.data, now);

    // Every new throne is queued (low severity) so a human reviews for
    // residence-style entries; the throne still appears immediately as Rumored.
    const row = await evaluateSignals({ kind: "new_throne", subjectId: throne.id, user: info.user }, now);
    if (row) scheduleTriage(row.id);

    return NextResponse.json({ ok: true, throneId: throne.id }, { status: 201 });
  } catch (e) {
    if (e instanceof AgeGateError) return NextResponse.json({ error: e.code }, { status: e.status });
    if (e instanceof RateLimitError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
