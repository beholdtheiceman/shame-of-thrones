import { NextResponse } from "next/server";
import { HOUSES } from "@sot/core";
import { sessionInfo } from "@/lib/server/session";
import { standingsPayload } from "@/lib/server/standings";
import type { WindowKey } from "@sot/core";
import type { HouseId } from "@sot/core";

export const dynamic = "force-dynamic";

const WINDOWS: WindowKey[] = ["week", "season", "all"];

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;

  const wRaw = params.get("window");
  const window: WindowKey = WINDOWS.includes(wRaw as WindowKey) ? (wRaw as WindowKey) : "week";

  const hRaw = params.get("house");
  const house: HouseId | null = HOUSES.some((h) => h.id === hRaw) ? (hRaw as HouseId) : null;

  const info = await sessionInfo();
  const viewerName = info.kind === "user" ? info.user.displayName : null;

  return NextResponse.json(await standingsPayload({ window, house, viewerName }));
}
