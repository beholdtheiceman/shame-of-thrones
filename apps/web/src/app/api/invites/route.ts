import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { generateInviteCode } from "@sot/core";
import { db } from "@/db/client";
import { invites } from "@/db/schema";
import { sessionInfo } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const MAX_COUNT = 500;

export async function POST(req: Request) {
  const info = await sessionInfo();
  if (info.kind !== "user" || info.user.role !== "moderator") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const cohort = typeof body?.cohort === "string" ? body.cohort.trim() : "";
  if (!cohort) return NextResponse.json({ error: "cohort required" }, { status: 400 });
  const rawCount = Number(body?.count);
  if (!Number.isFinite(rawCount)) return NextResponse.json({ error: "invalid count" }, { status: 400 });
  const count = Math.max(1, Math.min(MAX_COUNT, Math.floor(rawCount)));

  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    // Retry a handful of times on the (astronomically rare) unique collision.
    for (let attempt = 0; ; attempt++) {
      const code = generateInviteCode();
      try {
        await db.insert(invites).values({ code, cohort, createdBy: info.user.id });
        codes.push(code);
        break;
      } catch (e) {
        if (attempt >= 4) throw e;
      }
    }
  }

  return NextResponse.json({ cohort, codes }, { status: 201 });
}

export async function GET(req: Request) {
  const info = await sessionInfo();
  if (info.kind !== "user" || info.user.role !== "moderator") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const cohortFilter = new URL(req.url).searchParams.get("cohort");
  const rows = await (cohortFilter
    ? db.select().from(invites).where(eq(invites.cohort, cohortFilter)).orderBy(desc(invites.createdAt))
    : db.select().from(invites).orderBy(desc(invites.createdAt)));

  const redeemed = rows.filter((r) => r.redeemedBy !== null).length;
  return NextResponse.json({
    invites: rows.map((r) => ({
      id: r.id,
      code: r.code,
      cohort: r.cohort,
      redeemed: r.redeemedBy !== null,
      redeemedAt: r.redeemedAt?.getTime() ?? null,
      createdAt: r.createdAt.getTime(),
    })),
    total: rows.length,
    redeemed,
    remaining: rows.length - redeemed,
  });
}
