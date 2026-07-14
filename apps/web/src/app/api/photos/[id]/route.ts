import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { photos } from "@/db/schema";
import { sessionInfo } from "@/lib/server/session";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const photo = await db.query.photos.findFirst({ where: eq(photos.id, id) });
  if (!photo || photo.bytes.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (photo.status !== "approved") {
    const info = await sessionInfo();
    const allowed = info.kind === "user" &&
      (info.user.role === "moderator" || info.user.id === photo.uploadedBy);
    if (!allowed) return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(photo.bytes), {
    status: 200,
    headers: {
      "Content-Type": photo.contentType,
      "Cache-Control": photo.status === "approved" ? "public, max-age=3600" : "private, no-store",
    },
  });
}
