import { NextResponse } from "next/server";
import { z } from "zod";
import { HOUSES } from "@/lib/data";
import { createProfile, ProfileError, switchHouse } from "@/lib/server/profile";
import { sessionInfo } from "@/lib/server/session";
import type { HouseId } from "@/lib/types";

const houseIds = HOUSES.map((h) => h.id) as [HouseId, ...HouseId[]];

const bodySchema = z.object({
  name: z.string().trim().min(2).max(24).optional(),
  houseId: z.enum(houseIds),
});

export async function POST(req: Request) {
  const info = await sessionInfo();
  if (info.kind === "anonymous") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  try {
    if (info.kind === "no_profile") {
      if (!parsed.data.name) return NextResponse.json({ error: "name required" }, { status: 400 });
      const user = await createProfile(info.googleSubject, parsed.data.name, parsed.data.houseId);
      return NextResponse.json({ ok: true, userId: user.id }, { status: 201 });
    }
    await switchHouse(info.user.id, parsed.data.houseId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ProfileError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
