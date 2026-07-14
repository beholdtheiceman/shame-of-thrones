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
} from "@/lib/standings";
import type { HouseId } from "@/lib/types";
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
    .select({ event: influenceEvents, displayName: users.displayName })
    .from(influenceEvents)
    .innerJoin(users, eq(influenceEvents.userId, users.id));
  const events = eventRows.map((row) => ({
    ...toGameEvent(row.event),
    authorName: row.displayName,
  }));

  const council = smallCouncil(events, {
    window: args.window,
    houseFilter: args.house,
    now,
    viewerName: args.viewerName ?? undefined,
  });
  const houses = houseStandings(events, now);
  const range = windowRange(args.window, now);

  return {
    council,
    houses,
    window: {
      key: args.window,
      start: range?.start ?? null,
      end: range?.end ?? null,
      seasonIndex: args.window === "season" ? seasonWindow(now).index : undefined,
    },
  };
}
