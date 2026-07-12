import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { submitBirthDate } from "@/lib/server/ageGate";

const bodySchema = z.object({
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(req: Request) {
  const session = await auth();
  const sub = session?.googleSubject;
  if (!sub) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const [y, m, d] = parsed.data.birthDate.split("-").map(Number);
  const asDate = new Date(Date.UTC(y, m - 1, d));
  const valid = y >= 1900 && asDate.getTime() <= Date.now() &&
    asDate.getUTCMonth() === m - 1 && asDate.getUTCDate() === d;
  if (!valid) return NextResponse.json({ error: "invalid date" }, { status: 400 });

  return NextResponse.json(await submitBirthDate(sub, parsed.data.birthDate));
}
