import type { Equipped, InfluenceEvent, Rating } from "@sot/core";
import type { influenceEvents, ratings, users } from "@/db/schema";

type RatingRow = typeof ratings.$inferSelect;
type EventRow = typeof influenceEvents.$inferSelect;
type UserRow = typeof users.$inferSelect;

export function toGameRating(
  row: RatingRow,
  author: Pick<UserRow, "displayName" | "houseId"> & { equipped?: unknown }
): Rating {
  return {
    id: row.id,
    throneId: row.throneId,
    authorName: author.displayName,
    houseId: author.houseId,
    verdict: row.verdict as Rating["verdict"],
    tags: row.tags,
    testimony: row.testimonyHiddenAt ? "" : (row.testimony ?? ""),
    verified: row.verified,
    createdAt: row.createdAt.getTime(),
    bannerStyle: (author.equipped as Equipped | null | undefined)?.banner_style,
  };
}

/** authorName carries the user id server-side — selectors only use it as an
 * opaque grouping key (lifetimeXp), never for display. */
export function toGameEvent(row: EventRow): InfluenceEvent {
  return {
    id: row.id,
    fiefId: row.fiefId,
    houseId: row.houseId,
    points: row.points,
    reason: row.reason,
    throneId: row.throneId,
    authorName: row.userId,
    createdAt: row.createdAt.getTime(),
  };
}
