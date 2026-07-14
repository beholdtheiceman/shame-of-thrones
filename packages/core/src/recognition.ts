import { weekWindow } from "./standings";
import type { BadgeId, Rating } from "./types";

export const OATHKEEPER_WEEKS = 4;

const WEEK_MS = 7 * 86_400_000;

/** Consecutive Mon-00:00-UTC weeks with >= 1 verified rating. `weeks` is the run
 * ending at the current week (if active) else at last week; `thisWeekActive`
 * flags whether the current week already counts. */
export function currentStreak(
  ratings: Rating[],
  now: number
): { weeks: number; thisWeekActive: boolean } {
  const activeStarts = new Set<number>();
  for (const r of ratings) {
    if (!r.verified) continue;
    activeStarts.add(weekWindow(r.createdAt).start);
  }

  const thisWeekStart = weekWindow(now).start;
  const thisWeekActive = activeStarts.has(thisWeekStart);

  // Start counting at this week if active, otherwise at last week.
  let cursor = thisWeekActive ? thisWeekStart : thisWeekStart - WEEK_MS;
  let weeks = 0;
  while (activeStarts.has(cursor)) {
    weeks += 1;
    cursor -= WEEK_MS;
  }

  return { weeks, thisWeekActive };
}

export function earnedBadges(input: {
  ratings: Rating[];
  thronesAdded: number;
  streakWeeks: number;
  now: number;
}): BadgeId[] {
  const { ratings, thronesAdded, streakWeeks } = input;
  const badges: BadgeId[] = [];

  if (ratings.some((r) => r.verified)) badges.push("first_of_their_name");
  if (thronesAdded > 0) badges.push("cartographer");
  if (ratings.some((r) => new Date(r.createdAt).getUTCHours() < 5)) badges.push("nights_watch");
  if (streakWeeks >= OATHKEEPER_WEEKS) badges.push("oathkeeper");

  return badges;
}
