import { db } from "@/db/client";
import { influenceEvents, metricsEvents, ratings, users } from "@/db/schema";
import {
  avgTimeToRateMs,
  contributorPct,
  d30RetentionByHouse,
  fiefsChangingHands,
  nwtSuccessRate,
  seasonWindow,
  verifiedRatingsPerThronePerMonth,
  type AnalyticsInfluence,
  type AnalyticsRating,
  type AnalyticsUser,
  type HouseId,
  type MetricEvent,
} from "@sot/core";

export interface MetricsPayload {
  verifiedRatingsPerThronePerMonth: number;
  contributorPct: number;
  d30RetentionByHouse: Record<HouseId, number>;
  fiefsChangingHands: number;
  avgTimeToRateMs: number | null;
  nwtSuccessRate: number | null;
  generatedAt: number;
}

export async function metricsPayload(now = Date.now()): Promise<MetricsPayload> {
  const [ratingRows, userRows, influenceRows, eventRows] = await Promise.all([
    db.select().from(ratings),
    db.select().from(users),
    db.select().from(influenceEvents),
    db.select().from(metricsEvents),
  ]);

  const analyticsRatings: AnalyticsRating[] = ratingRows.map((r) => ({
    throneId: r.throneId,
    userId: r.userId,
    verified: r.verified,
    createdAt: r.createdAt.getTime(),
  }));
  const analyticsUsers: AnalyticsUser[] = userRows.map((u) => ({
    id: u.id,
    houseId: u.houseId,
    joinedAt: u.joinedAt.getTime(),
  }));
  const analyticsInfluence: AnalyticsInfluence[] = influenceRows.map((e) => ({
    fiefId: e.fiefId,
    houseId: e.houseId,
    points: e.points,
    createdAt: e.createdAt.getTime(),
  }));
  const analyticsEvents: MetricEvent[] = eventRows.map((e) => ({
    name: e.name,
    userId: e.userId,
    meta: e.meta,
    createdAt: e.createdAt.getTime(),
  }));

  const season = seasonWindow(now);
  const retentionMap = d30RetentionByHouse(analyticsUsers, analyticsRatings, now);

  return {
    verifiedRatingsPerThronePerMonth: verifiedRatingsPerThronePerMonth(analyticsRatings, now),
    contributorPct: contributorPct(analyticsUsers, analyticsRatings),
    d30RetentionByHouse: Object.fromEntries(retentionMap) as Record<HouseId, number>,
    fiefsChangingHands: fiefsChangingHands(analyticsInfluence, season.start, now),
    avgTimeToRateMs: avgTimeToRateMs(analyticsEvents),
    nwtSuccessRate: nwtSuccessRate(analyticsEvents),
    generatedAt: now,
  };
}
