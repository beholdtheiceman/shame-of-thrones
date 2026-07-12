import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { photos } from "@/db/schema";
import { sessionInfo } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const info = await sessionInfo();
  const viewerId = info.kind === "user" ? info.user.id : null;

  const rows = await db.select({
    id: photos.id, status: photos.status, uploadedBy: photos.uploadedBy,
    rejectedReason: photos.rejectedReason, createdAt: photos.createdAt,
  }).from(photos).where(eq(photos.throneId, id)).orderBy(desc(photos.createdAt));

  const visible = rows.filter((p) => p.status === "approved" || (viewerId && p.uploadedBy === viewerId));
  return NextResponse.json({
    photos: visible.map((p) => ({
      id: p.id, status: p.status, mine: viewerId === p.uploadedBy,
      rejectedReason: viewerId === p.uploadedBy ? p.rejectedReason : null,
      createdAt: p.createdAt.getTime(),
    })),
  });
}
