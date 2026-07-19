import type { HouseId } from "./types";

const DAY = 86_400_000;

export interface AnalyticsRating {
  throneId: string;
  userId: string;
  verified: boolean;
  createdAt: number;
}
export interface AnalyticsUser {
  id: string;
  houseId: HouseId;
  joinedAt: number;
}
export interface AnalyticsInfluence {
  fiefId: string;
  houseId: HouseId;
  points: number;
  createdAt: number;
}
export interface MetricEvent {
  name: string;
  userId: string | null;
  meta: Record<string, unknown>;
  createdAt: number;
}

/** PRD §9: verified ratings in the last 30 days ÷ distinct thrones rated. */
export function verifiedRatingsPerThronePerMonth(ratings: AnalyticsRating[], now: number): number {
  const since = now - 30 * DAY;
  const recent = ratings.filter((r) => r.verified && r.createdAt >= since);
  if (recent.length === 0) return 0;
  const thrones = new Set(recent.map((r) => r.throneId));
  if (thrones.size === 0) return 0;
  return recent.length / thrones.size;
}

/** Distinct rating userIds ÷ total users, clamped 0..1. */
export function contributorPct(users: AnalyticsUser[], ratings: AnalyticsRating[]): number {
  if (users.length === 0) return 0;
  const contributors = new Set(ratings.map((r) => r.userId));
  return contributors.size / users.length;
}

/**
 * Approximate D30 retention, grouped by house: of users who joined ≥30d ago,
 * the fraction with ≥1 rating whose createdAt ≥ joinedAt + 30d.
 */
export function d30RetentionByHouse(
  users: AnalyticsUser[],
  ratings: AnalyticsRating[],
  now: number
): Map<HouseId, number> {
  const ratingsByUser = new Map<string, AnalyticsRating[]>();
  for (const r of ratings) {
    const list = ratingsByUser.get(r.userId);
    if (list) list.push(r);
    else ratingsByUser.set(r.userId, [r]);
  }

  const totals = new Map<HouseId, number>();
  const retained = new Map<HouseId, number>();
  for (const u of users) {
    if (now - u.joinedAt < 30 * DAY) continue; // not yet eligible
    totals.set(u.houseId, (totals.get(u.houseId) ?? 0) + 1);
    const threshold = u.joinedAt + 30 * DAY;
    const kept = (ratingsByUser.get(u.id) ?? []).some((r) => r.createdAt >= threshold);
    if (kept) retained.set(u.houseId, (retained.get(u.houseId) ?? 0) + 1);
  }

  const out = new Map<HouseId, number>();
  for (const [house, total] of totals) {
    out.set(house, total === 0 ? 0 : (retained.get(house) ?? 0) / total);
  }
  return out;
}

/**
 * Replay influence chronologically within [seasonStart, now]; per fief track the
 * leading house by cumulative points and count transitions to a different leader.
 * The initial assignment of a leader is not counted as a change.
 */
export function fiefsChangingHands(events: AnalyticsInfluence[], seasonStart: number, now: number): number {
  const inWindow = events
    .filter((e) => e.createdAt >= seasonStart && e.createdAt <= now)
    .sort((a, b) => a.createdAt - b.createdAt);

  const totals = new Map<string, Map<HouseId, number>>();
  const leader = new Map<string, HouseId | null>();
  let changes = 0;

  for (const e of inWindow) {
    let fiefTotals = totals.get(e.fiefId);
    if (!fiefTotals) {
      fiefTotals = new Map<HouseId, number>();
      totals.set(e.fiefId, fiefTotals);
    }
    fiefTotals.set(e.houseId, (fiefTotals.get(e.houseId) ?? 0) + e.points);

    // Determine current leader (highest cumulative points; ties keep prior leader).
    let top: HouseId | null = null;
    let topPoints = -Infinity;
    for (const [house, points] of fiefTotals) {
      if (points > topPoints) {
        topPoints = points;
        top = house;
      }
    }

    const prev = leader.get(e.fiefId);
    if (prev === undefined) {
      leader.set(e.fiefId, top); // initial assignment — not a change
    } else if (top !== prev) {
      changes += 1;
      leader.set(e.fiefId, top);
    }
  }

  return changes;
}

/** Mean of meta.ms over time_to_rate events; null if none. */
export function avgTimeToRateMs(events: MetricEvent[]): number | null {
  const samples = events
    .filter((e) => e.name === "time_to_rate" && typeof e.meta.ms === "number")
    .map((e) => e.meta.ms as number);
  if (samples.length === 0) return null;
  return samples.reduce((sum, ms) => sum + ms, 0) / samples.length;
}

/** Fraction of nwt_outcome events with meta.success === true; null if none. */
export function nwtSuccessRate(events: MetricEvent[]): number | null {
  const outcomes = events.filter((e) => e.name === "nwt_outcome");
  if (outcomes.length === 0) return null;
  const successes = outcomes.filter((e) => e.meta.success === true).length;
  return successes / outcomes.length;
}
