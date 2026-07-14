import { NextResponse } from "next/server";
import { z } from "zod";
import { HOUSES } from "@/lib/data";
import { AgeGateError, requireAgeGate } from "@/lib/server/ageGate";
import { createProfile, ProfileError, switchHouse } from "@/lib/server/profile";
import { updateNotifyPrefs } from "@/lib/server/notifications";
import { sessionInfo } from "@/lib/server/session";
import { requireGoodStanding, StandingError } from "@/lib/server/standing";
import type { HouseId } from "@/lib/types";

const houseIds = HOUSES.map((h) => h.id) as [HouseId, ...HouseId[]];

const notifyPrefsSchema = z.object({
  contested: z.boolean(),
  banner_fallen: z.boolean(),
  season_start: z.boolean(),
}).strict();

const bodySchema = z.union([
  z.object({ name: z.string().trim().min(2).max(24).optional(), houseId: z.enum(houseIds) }).strict(),
  z.object({ notifyPrefs: notifyPrefsSchema }).strict(),
]);

export async function POST(req: Request) {
  const info = await sessionInfo();
  if (info.kind === "anonymous") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  try {
    await requireAgeGate(info.kind === "user" ? info.user.googleSubject : info.googleSubject);
    if (info.kind === "user") requireGoodStanding(info.user);
    if (info.kind === "no_profile") {
      if (!("houseId" in parsed.data) || !parsed.data.name) {
        return NextResponse.json({ error: "name required" }, { status: 400 });
      }
      const user = await createProfile(info.googleSubject, parsed.data.name, parsed.data.houseId);
      return NextResponse.json({ ok: true, userId: user.id }, { status: 201 });
    }
    if ("notifyPrefs" in parsed.data) {
      return NextResponse.json({ ok: true, notifyPrefs: await updateNotifyPrefs(info.user.id, parsed.data.notifyPrefs) });
    }
    await switchHouse(info.user.id, parsed.data.houseId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AgeGateError) return NextResponse.json({ error: e.code }, { status: e.status });
    if (e instanceof StandingError) return NextResponse.json({ error: e.code, until: e.until ?? null }, { status: e.status });
    if (e instanceof ProfileError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
