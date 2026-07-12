import { NextResponse } from "next/server";
import { confirmThrone, ThroneError } from "@/lib/server/thrones";
import { sessionInfo } from "@/lib/server/session";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const info = await sessionInfo();
  if (info.kind !== "user") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const throne = await confirmThrone(info.user, id);
    return NextResponse.json({ ok: true, status: throne.status });
  } catch (e) {
    if (e instanceof ThroneError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
