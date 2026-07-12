import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { influenceEvents, ratings, reviewQueue, thrones, users, type ReviewSignal } from "@/db/schema";
import { SAFETY } from "@/lib/game/rules";
import { haversineMeters } from "@/lib/geo";

type UserRow = typeof users.$inferSelect;
type ReviewRow = typeof reviewQueue.$inferSelect;
type Severity = "low" | "medium" | "high";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export class RateLimitError extends Error {
  status = 429;
}

/** All write kinds count toward the rate windows: ratings, charted thrones,
 * confirmations (counted via their influence events). */
async function writesInLastHour(userId: string, now: number): Promise<number> {
  const since = new Date(now - HOUR_MS);
  const count = sql<number>`count(*)::int`;
  const [[r], [t], [c]] = await Promise.all([
    db.select({ n: count }).from(ratings)
      .where(and(eq(ratings.userId, userId), gte(ratings.createdAt, since))),
    db.select({ n: count }).from(thrones)
      .where(and(eq(thrones.addedBy, userId), gte(thrones.addedAt, since))),
    db.select({ n: count }).from(influenceEvents)
      .where(and(
        eq(influenceEvents.userId, userId),
        eq(influenceEvents.reason, "confirmation"),
        gte(influenceEvents.createdAt, since)
      )),
  ]);
  return r.n + t.n + c.n;
}

/** Call BEFORE the write. The only hard rejection in the anti-gaming bundle. */
export async function enforceHardCeiling(userId: string, now = Date.now()): Promise<void> {
  if ((await writesInLastHour(userId, now)) >= SAFETY.hardRateLimitPerHour) {
    throw new RateLimitError("The ravens cannot carry so many messages — rest awhile.");
  }
}

export interface SignalContext {
  kind: "rating" | "new_throne" | "confirmation";
  subjectId: string; // rating id or throne id
  user: Pick<UserRow, "id" | "joinedAt">;
  /** Present only for newly-inserted ratings; travel is checked for verified
   * ones. Coordinates come from the throne, never the user. */
  rating?: {
    id: string;
    verified: boolean;
    createdAt: number;
    throne: { id: string; lat: number; lng: number };
  };
}

const SIGNAL_SEVERITY: Record<ReviewSignal["signal"], Severity> = {
  new_account: "low",
  new_throne: "low",
  rate_soft: "medium",
  impossible_travel: "high",
  user_report: "medium",
  testimony_blocked: "high",
  testimony_flagged: "medium",
  screen_unavailable: "medium",
};

const RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2 };

/** Call AFTER the action's transaction commits — the action already succeeded
 * (Larry's rule: flag, never reject). Returns the inserted queue row, or null. */
export async function evaluateSignals(ctx: SignalContext, now = Date.now()): Promise<ReviewRow | null> {
  const signals: ReviewSignal[] = [];

  const accountAgeMs = now - ctx.user.joinedAt.getTime();
  if (accountAgeMs < SAFETY.newAccountWindowMs) {
    signals.push({ signal: "new_account", accountAgeDays: Math.floor(accountAgeMs / DAY_MS) });
  }

  const writes = await writesInLastHour(ctx.user.id, now);
  if (writes > SAFETY.softRateLimitPerHour) {
    signals.push({ signal: "rate_soft", writesLastHour: writes });
  }

  if (ctx.kind === "new_throne") signals.push({ signal: "new_throne" });

  if (ctx.rating?.verified) {
    const [prev] = await db.select({
      throneId: ratings.throneId, createdAt: ratings.createdAt,
      lat: thrones.lat, lng: thrones.lng,
    })
      .from(ratings)
      .innerJoin(thrones, eq(ratings.throneId, thrones.id))
      .where(and(
        eq(ratings.userId, ctx.user.id),
        eq(ratings.verified, true),
        ne(ratings.id, ctx.rating.id)
      ))
      .orderBy(desc(ratings.createdAt))
      .limit(1);

    if (prev) {
      const km = haversineMeters(prev, ctx.rating.throne) / 1000;
      // Floor elapsed time at one minute so same-timestamp pairs don't divide by zero.
      const hours = Math.max((ctx.rating.createdAt - prev.createdAt.getTime()) / HOUR_MS, 1 / 60);
      const kmh = km / hours;
      if (kmh > SAFETY.impossibleTravelKmh) {
        signals.push({
          signal: "impossible_travel",
          kmh: Math.round(kmh),
          fromThroneId: prev.throneId,
          minutes: Math.round((ctx.rating.createdAt - prev.createdAt.getTime()) / 60_000),
        });
      }
    }
  }

  if (signals.length === 0) return null;

  const severity = signals
    .map((s) => SIGNAL_SEVERITY[s.signal])
    .reduce((max, s) => (RANK[s] > RANK[max] ? s : max), "low" as Severity);

  const [row] = await db.insert(reviewQueue).values({
    kind: ctx.kind, subjectId: ctx.subjectId, userId: ctx.user.id,
    signals, severity, createdAt: new Date(now),
  }).returning();
  return row;
}
