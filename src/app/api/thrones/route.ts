import { NextResponse } from "next/server";
import { z } from "zod";
import { addThrone } from "@/lib/server/thrones";
import { sessionInfo } from "@/lib/server/session";

const bodySchema = z.object({
  name: z.string().trim().min(2).max(80),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  category: z.enum(["cafe", "restaurant", "park", "transit", "library", "retail", "municipal", "gas_station", "other"]),
  amenities: z.object({
    accessible: z.boolean(), babyChanging: z.boolean(), genderNeutral: z.boolean(),
    freeAccess: z.boolean(), open24h: z.boolean(),
  }),
});

export async function POST(req: Request) {
  const info = await sessionInfo();
  if (info.kind !== "user") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const throne = await addThrone(info.user, parsed.data);
  return NextResponse.json({ ok: true, throneId: throne.id }, { status: 201 });
}
