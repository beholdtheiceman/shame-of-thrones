import { describe, expect, it } from "vitest";
import type { Rating } from "./types";
import { currentStreak, earnedBadges, OATHKEEPER_WEEKS } from "./recognition";

const DAY = 86_400_000;
const WEEK = 7 * DAY;
// Thursday 2026-07-16 12:00 UTC — current week starts Mon 2026-07-13.
const NOW = Date.UTC(2026, 6, 16, 12, 0, 0);

function rating(overrides: Partial<Rating>): Rating {
  return {
    id: "r1", throneId: "t1", authorName: "A", houseId: "flush",
    verdict: 3, tags: [], testimony: "", verified: true, createdAt: NOW,
    ...overrides,
  };
}

describe("currentStreak", () => {
  it("counts consecutive active weeks ending this week", () => {
    const ratings = [
      rating({ createdAt: NOW }),                // this week
      rating({ createdAt: NOW - WEEK }),         // -1
      rating({ createdAt: NOW - 2 * WEEK }),     // -2
      rating({ createdAt: NOW - 3 * WEEK }),     // -3
    ];
    expect(currentStreak(ratings, NOW)).toEqual({ weeks: 4, thisWeekActive: true });
  });

  it("keeps an at-risk streak alive when this week is not yet active", () => {
    const ratings = [
      rating({ createdAt: NOW - WEEK }),         // -1
      rating({ createdAt: NOW - 2 * WEEK }),     // -2
    ];
    expect(currentStreak(ratings, NOW)).toEqual({ weeks: 2, thisWeekActive: false });
  });

  it("is zero when neither this week nor last week is active", () => {
    const ratings = [rating({ createdAt: NOW - 3 * WEEK })];
    expect(currentStreak(ratings, NOW)).toEqual({ weeks: 0, thisWeekActive: false });
  });

  it("breaks the run on a gap week", () => {
    const ratings = [
      rating({ createdAt: NOW }),                // this week
      // -1 missing
      rating({ createdAt: NOW - 2 * WEEK }),     // -2
    ];
    expect(currentStreak(ratings, NOW)).toEqual({ weeks: 1, thisWeekActive: true });
  });

  it("ignores unverified ratings", () => {
    const ratings = [rating({ createdAt: NOW, verified: false })];
    expect(currentStreak(ratings, NOW)).toEqual({ weeks: 0, thisWeekActive: false });
  });

  it("counts multiple ratings in one week as one active week", () => {
    const ratings = [
      rating({ id: "a", createdAt: NOW }),
      rating({ id: "b", createdAt: NOW - DAY }),
    ];
    expect(currentStreak(ratings, NOW)).toEqual({ weeks: 1, thisWeekActive: true });
  });
});

describe("earnedBadges", () => {
  const noRatings: Rating[] = [];

  it("returns nothing for a brand-new user", () => {
    expect(earnedBadges({ ratings: noRatings, thronesAdded: 0, streakWeeks: 0, now: NOW })).toEqual([]);
  });

  it("grants first_of_their_name only on a verified rating", () => {
    expect(
      earnedBadges({ ratings: [rating({ verified: false })], thronesAdded: 0, streakWeeks: 0, now: NOW })
    ).not.toContain("first_of_their_name");
    expect(
      earnedBadges({ ratings: [rating({ verified: true })], thronesAdded: 0, streakWeeks: 0, now: NOW })
    ).toContain("first_of_their_name");
  });

  it("grants cartographer when thronesAdded > 0", () => {
    expect(earnedBadges({ ratings: noRatings, thronesAdded: 1, streakWeeks: 0, now: NOW })).toContain("cartographer");
  });

  it("grants nights_watch for a rating before 05:00 UTC but not at 05:00", () => {
    const preDawn = rating({ createdAt: Date.UTC(2026, 6, 16, 4, 59) });
    const fiveAM = rating({ createdAt: Date.UTC(2026, 6, 16, 5, 0) });
    expect(earnedBadges({ ratings: [preDawn], thronesAdded: 0, streakWeeks: 0, now: NOW })).toContain("nights_watch");
    expect(earnedBadges({ ratings: [fiveAM], thronesAdded: 0, streakWeeks: 0, now: NOW })).not.toContain("nights_watch");
  });

  it("grants oathkeeper at exactly the threshold, not below", () => {
    expect(earnedBadges({ ratings: noRatings, thronesAdded: 0, streakWeeks: OATHKEEPER_WEEKS - 1, now: NOW })).not.toContain("oathkeeper");
    expect(earnedBadges({ ratings: noRatings, thronesAdded: 0, streakWeeks: OATHKEEPER_WEEKS, now: NOW })).toContain("oathkeeper");
  });
});
