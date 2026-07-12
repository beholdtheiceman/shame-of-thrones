import { HOUSES, VERDICT_SCALE } from "./data";
import type { HouseId, InfluenceEvent, Rating } from "./types";

const MS_PER_DAY = 86_400_000;

/** Ratings decay toward irrelevance with a ~60-day half-life; verified
 * (proximity-passed) ratings count 3x a Hearsay (remote) rating. */
export function throneScore(
  throneId: string,
  ratings: Rating[],
  now: number
): { score: number | null; count: number } {
  const relevant = ratings.filter((r) => r.throneId === throneId);
  if (relevant.length === 0) return { score: null, count: 0 };

  let weighted = 0;
  let weightSum = 0;
  for (const r of relevant) {
    const daysSince = Math.max(0, (now - r.createdAt) / MS_PER_DAY);
    const recency = Math.pow(0.5, daysSince / 60);
    const trust = r.verified ? 3 : 1;
    const weight = recency * trust;
    weighted += weight * r.verdict;
    weightSum += weight;
  }
  return { score: weightSum > 0 ? weighted / weightSum : null, count: relevant.length };
}

export interface FiefControlShare {
  houseId: HouseId;
  influence: number;
  share: number; // 0-1
}

export interface FiefControl {
  fiefId: string;
  shares: FiefControlShare[];
  leader: FiefControlShare | null;
  contested: boolean;
  totalInfluence: number;
}

/** Influence decays ~2%/day — territory must be held, not just taken. */
export function fiefControl(
  fiefId: string,
  influenceEvents: InfluenceEvent[],
  now: number
): FiefControl {
  const totals = new Map<HouseId, number>();
  for (const h of HOUSES) totals.set(h.id, 0);

  for (const ev of influenceEvents) {
    if (ev.fiefId !== fiefId) continue;
    const daysSince = Math.max(0, (now - ev.createdAt) / MS_PER_DAY);
    const decayed = ev.points * Math.pow(0.98, daysSince);
    totals.set(ev.houseId, (totals.get(ev.houseId) ?? 0) + decayed);
  }

  const totalInfluence = [...totals.values()].reduce((a, b) => a + b, 0);
  const shares: FiefControlShare[] = HOUSES.map((h) => {
    const influence = totals.get(h.id) ?? 0;
    return {
      houseId: h.id,
      influence,
      share: totalInfluence > 0 ? influence / totalInfluence : 0,
    };
  }).sort((a, b) => b.influence - a.influence);

  const leader = totalInfluence > 0 ? shares[0] : null;
  const runnerUp = shares[1];
  const contested =
    !!leader &&
    !!runnerUp &&
    leader.influence > 0 &&
    (leader.influence - runnerUp.influence) / leader.influence <= 0.15;

  return { fiefId, shares, leader, contested, totalInfluence };
}

export interface RankInfo {
  name: string;
  xp: number;
  floor: number;
  ceiling: number | null;
  nextName: string | null;
  progress: number; // 0-1 toward next rank, 1 if at max rank
}

const RANKS: { name: string; floor: number }[] = [
  { name: "Peasant", floor: 0 },
  { name: "Squire", floor: 100 },
  { name: "Knight", floor: 300 },
  { name: "Baron", floor: 700 },
  { name: "Lord", floor: 1500 },
  { name: "Warden", floor: 3000 },
  { name: "Hand of the Throne", floor: 6000 },
  { name: "Grand Maester of the Privy Council", floor: 12000 },
];

/** Lifetime, undecayed — individual rank reflects total contribution,
 * not currently-held territory. */
export function lifetimeXp(authorName: string, influenceEvents: InfluenceEvent[]): number {
  return influenceEvents
    .filter((e) => e.authorName === authorName)
    .reduce((sum, e) => sum + e.points, 0);
}

export function rankForXp(xp: number): RankInfo {
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) {
    if (xp >= RANKS[i].floor) idx = i;
  }
  const current = RANKS[idx];
  const next = RANKS[idx + 1] ?? null;
  const progress = next
    ? Math.min(1, (xp - current.floor) / (next.floor - current.floor))
    : 1;
  return {
    name: current.name,
    xp,
    floor: current.floor,
    ceiling: next ? next.floor : null,
    nextName: next ? next.name : null,
    progress,
  };
}

export function scoreBand(score: number | null): "high" | "mid" | "low" | "unrated" {
  if (score === null) return "unrated";
  if (score >= 4) return "high";
  if (score >= 3) return "mid";
  return "low";
}

export interface VerdictTier {
  value: 1 | 2 | 3 | 4 | 5;
  glyph: string;
  label: string;
}

/** Maps an average score to the nearest VERDICT_SCALE tier ("Fit for a
 * Knight" leads the display; the raw number is secondary — PRD register). */
export function tierForScore(score: number): VerdictTier {
  const clamped = Math.min(5, Math.max(1, score));
  const value = Math.round(clamped) as VerdictTier["value"];
  return VERDICT_SCALE.find((t) => t.value === value) as VerdictTier;
}
