import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { influenceEvents, users } from "@/db/schema";
import {
  houseStandings,
  seasonWindow,
  smallCouncil,
  windowRange,
  type HouseStandingRow,
  type SmallCouncilResult,
  type WindowKey,
} from "@sot/core";
import type { Equipped, HouseId } from "@sot/core";
import { toGameEvent } from "./mappers";

export interface StandingsPayload {
  council: SmallCouncilResult;
  houses: HouseStandingRow[];
  window: { key: WindowKey; start: number | null; end: number | null; seasonIndex?: number };
}

export async function standingsPayload(args: {
  window: WindowKey;
  house: HouseId | null;
  viewerName: string | null;
  now?: number;
}): Promise<StandingsPayload> {
  const now = args.now ?? Date.now();
  const eventRows = await db
    .select({ event: influenceEvents, displayName: users.displayName, equipped: users.equipped })
    .from(influenceEvents)
    .innerJoin(users, eq(influenceEvents.userId, users.id));
  const events = eventRows.map((row) => ({
    ...toGameEvent(row.event),
    authorName: row.displayName,
  }));

  const bannerByName = new Map<string, string>();
  for (const row of eventRows) {
    const sku = (row.equipped as Equipped | null)?.banner_style;
    if (sku) bannerByName.set(row.displayName, sku);
  }

  const council = smallCouncil(events, {
    window: args.window,
    houseFilter: args.house,
    now,
    viewerName: args.viewerName ?? undefined,
  });
  const stamp = (r: (typeof council.rows)[number]) => ({ ...r, bannerStyle: bannerByName.get(r.name) });
  const stampedCouncil = {
    rows: council.rows.map(stamp),
    viewerRow: council.viewerRow ? stamp(council.viewerRow) : null,
  };
  const houses = houseStandings(events, now);
  const range = windowRange(args.window, now);

  return {
    council: stampedCouncil,
    houses,
    window: {
      key: args.window,
      start: range?.start ?? null,
      end: range?.end ?? null,
      seasonIndex: args.window === "season" ? seasonWindow(now).index : undefined,
    },
  };
}
