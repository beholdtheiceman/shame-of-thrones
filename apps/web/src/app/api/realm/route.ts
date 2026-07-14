import { NextResponse } from "next/server";
import { realmPayload } from "@/lib/server/realm";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await realmPayload());
}
