import { describe, expect, it } from "vitest";
import {
  avgTimeToRateMs,
  contributorPct,
  d30RetentionByHouse,
  fiefsChangingHands,
  nwtSuccessRate,
  verifiedRatingsPerThronePerMonth,
  type AnalyticsInfluence,
  type AnalyticsRating,
  type AnalyticsUser,
  type MetricEvent,
} from "./analytics";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 6, 16, 12, 0, 0);

function rating(o: Partial<AnalyticsRating> = {}): AnalyticsRating {
  return { throneId: "t1", userId: "u1", verified: true, createdAt: NOW, ...o };
}
function user(o: Partial<AnalyticsUser> = {}): AnalyticsUser {
  return { id: "u1", houseId: "flush", joinedAt: NOW - 60 * DAY, ...o };
}
function influence(o: Partial<AnalyticsInfluence> = {}): AnalyticsInfluence {
  return { fiefId: "f1", houseId: "flush", points: 1, createdAt: NOW, ...o };
}
function event(o: Partial<MetricEvent> = {}): MetricEvent {
  return { name: "time_to_rate", userId: "u1", meta: {}, createdAt: NOW, ...o };
}

describe("verifiedRatingsPerThronePerMonth", () => {
  it("returns 0 when there are no ratings", () => {
    expect(verifiedRatingsPerThronePerMonth([], NOW)).toBe(0);
  });

  it("counts verified ratings in the last 30 days divided by distinct thrones", () => {
    const ratings = [
      rating({ throneId: "a", verified: true, createdAt: NOW - DAY }),
      rating({ throneId: "a", verified: true, createdAt: NOW - 2 * DAY }),
      rating({ throneId: "b", verified: true, createdAt: NOW - 3 * DAY }),
      rating({ throneId: "c", verified: false, createdAt: NOW - DAY }), // unverified, ignored
      rating({ throneId: "d", verified: true, createdAt: NOW - 40 * DAY }), // too old, ignored
    ];
    // 3 verified in window across 2 distinct thrones (a, b) => 1.5
    expect(verifiedRatingsPerThronePerMonth(ratings, NOW)).toBe(1.5);
  });
});

describe("contributorPct", () => {
  it("returns 0 with no users", () => {
    expect(contributorPct([], [rating()])).toBe(0);
  });

  it("is distinct rating userIds over total users", () => {
    const users = [user({ id: "u1" }), user({ id: "u2" }), user({ id: "u3" }), user({ id: "u4" })];
    const ratings = [rating({ userId: "u1" }), rating({ userId: "u1" }), rating({ userId: "u2" })];
    expect(contributorPct(users, ratings)).toBe(0.5);
  });
});

describe("d30RetentionByHouse", () => {
  it("fraction of eligible users with a rating >= joinedAt+30d, by house", () => {
    const users = [
      user({ id: "a", houseId: "flush", joinedAt: NOW - 60 * DAY }), // retained
      user({ id: "b", houseId: "flush", joinedAt: NOW - 60 * DAY }), // not retained
      user({ id: "c", houseId: "bidet", joinedAt: NOW - 5 * DAY }),  // too new, excluded
    ];
    const ratings = [
      rating({ userId: "a", createdAt: NOW - 60 * DAY + 31 * DAY }), // after +30d
      rating({ userId: "b", createdAt: NOW - 60 * DAY + 5 * DAY }),  // before +30d
    ];
    const map = d30RetentionByHouse(users, ratings, NOW);
    expect(map.get("flush")).toBe(0.5);
    expect(map.has("bidet")).toBe(false); // no eligible users in bidet
  });
});

describe("fiefsChangingHands", () => {
  it("counts leader-change transitions within the window; initial assignment is not a change", () => {
    const events = [
      influence({ fiefId: "f1", houseId: "flush", points: 5, createdAt: NOW - 10 * DAY }), // flush leads (initial)
      influence({ fiefId: "f1", houseId: "bidet", points: 10, createdAt: NOW - 8 * DAY }), // bidet takes lead (change 1)
      influence({ fiefId: "f1", houseId: "flush", points: 10, createdAt: NOW - 6 * DAY }), // flush retakes (change 2)
      influence({ fiefId: "f2", houseId: "plunger", points: 3, createdAt: NOW - 4 * DAY }), // f2 initial, no change
    ];
    expect(fiefsChangingHands(events, NOW - 20 * DAY, NOW)).toBe(2);
  });

  it("ignores events outside the window", () => {
    const events = [
      influence({ fiefId: "f1", houseId: "flush", points: 5, createdAt: NOW - 100 * DAY }),
      influence({ fiefId: "f1", houseId: "bidet", points: 10, createdAt: NOW - 90 * DAY }),
    ];
    expect(fiefsChangingHands(events, NOW - 20 * DAY, NOW)).toBe(0);
  });
});

describe("avgTimeToRateMs", () => {
  it("returns null when there are no time_to_rate events", () => {
    expect(avgTimeToRateMs([event({ name: "nwt_outcome", meta: { success: true } })])).toBeNull();
  });

  it("averages meta.ms over time_to_rate events", () => {
    const events = [
      event({ name: "time_to_rate", meta: { ms: 1000 } }),
      event({ name: "time_to_rate", meta: { ms: 3000 } }),
      event({ name: "nwt_outcome", meta: { success: true } }), // ignored
    ];
    expect(avgTimeToRateMs(events)).toBe(2000);
  });
});

describe("nwtSuccessRate", () => {
  it("returns null when there are no nwt_outcome events", () => {
    expect(nwtSuccessRate([event({ name: "time_to_rate", meta: { ms: 1 } })])).toBeNull();
  });

  it("is the fraction of nwt_outcome events with meta.success === true", () => {
    const events = [
      event({ name: "nwt_outcome", meta: { success: true } }),
      event({ name: "nwt_outcome", meta: { success: true } }),
      event({ name: "nwt_outcome", meta: { success: false } }),
      event({ name: "time_to_rate", meta: { ms: 1 } }), // ignored
    ];
    expect(nwtSuccessRate(events)).toBeCloseTo(2 / 3);
  });
});
