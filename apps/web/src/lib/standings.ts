import { HOUSES } from "./data";
import { underdogMultiplier } from "./game/rules";
import { fiefControl } from "./selectors";
import type { HouseId, InfluenceEvent } from "./types";

const DAY = 86_400_000;

export type WindowKey = "week" | "season" | "all";

/** Current calendar week, resetting Monday 00:00 UTC. */
export function weekWindow(now: number): { start: number; end: number } {
  const d = new Date(now);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const sinceMonday = (dow + 6) % 7; // Mon=0 .. Sun=6
  const midnightToday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const start = midnightToday - sinceMonday * DAY;
  return { start, end: start + 7 * DAY };
}

export const SEASON_LENGTH_DAYS = 56;
/** Monday 2026-01-05 00:00 UTC — aligns season starts to week boundaries. */
export const SEASON_GENESIS = Date.UTC(2026, 0, 5);

export function seasonWindow(now: number): { start: number; end: number; index: number } {
  const span = SEASON_LENGTH_DAYS * DAY;
  const index = Math.floor((now - SEASON_GENESIS) / span);
  const start = SEASON_GENESIS + index * span;
  return { start, end: start + span, index };
}

export function windowRange(window: WindowKey, now: number): { start: number; end: number } | null {
  if (window === "week") return weekWindow(now);
  if (window === "season") {
    const s = seasonWindow(now);
    return { start: s.start, end: s.end };
  }
  return null; // all-time: unbounded
}

export interface CouncilRow {
  name: string;
  houseId: HouseId;
  points: number;
  position: number;
}

export interface SmallCouncilResult {
  rows: CouncilRow[];
  viewerRow: CouncilRow | null;
}

export interface SmallCouncilOptions {
  window: WindowKey;
  houseFilter: HouseId | null;
  now: number;
  viewerName?: string;
}

const TOP_N = 50;

export function smallCouncil(
  events: InfluenceEvent[],
  opts: SmallCouncilOptions
): SmallCouncilResult {
  const { window, houseFilter, now, viewerName } = opts;
  const range = windowRange(window, now);

  const agg = new Map<
    string,
    { name: string; houseId: HouseId; points: number; earliest: number; latestAt: number }
  >();

  for (const ev of events) {
    if (range && (ev.createdAt < range.start || ev.createdAt >= range.end)) continue;
    if (houseFilter && ev.houseId !== houseFilter) continue;
    const cur = agg.get(ev.authorName);
    if (cur) {
      cur.points += ev.points;
      cur.earliest = Math.min(cur.earliest, ev.createdAt);
      if (ev.createdAt >= cur.latestAt) {
        cur.latestAt = ev.createdAt;
        cur.houseId = ev.houseId; // chip reflects the author's most recent House
      }
    } else {
      agg.set(ev.authorName, {
        name: ev.authorName,
        houseId: ev.houseId,
        points: ev.points,
        earliest: ev.createdAt,
        latestAt: ev.createdAt,
      });
    }
  }

  const sorted = [...agg.values()]
    .filter((r) => r.points > 0)
    .sort(
      (a, b) =>
        b.points - a.points || a.earliest - b.earliest || a.name.localeCompare(b.name)
    )
    .map((r, i) => ({ name: r.name, houseId: r.houseId, points: r.points, position: i + 1 }));

  const rows = sorted.slice(0, TOP_N);

  let viewerRow: CouncilRow | null = null;
  if (viewerName && !rows.some((r) => r.name === viewerName)) {
    viewerRow = sorted.find((r) => r.name === viewerName) ?? null;
  }

  return { rows, viewerRow };
}

export interface HouseStandingRow {
  houseId: HouseId;
  influence: number;
  share: number;
  fiefsLed: number;
  blessed: boolean;
}

/** Each House's current decayed Realm-influence share (0..1), summing to 1
 * (or all 0 when the Realm has no influence). Lean — no per-fief work. */
export function realmHouseShares(events: InfluenceEvent[], now: number): Map<HouseId, number> {
  const influence = new Map<HouseId, number>();
  for (const h of HOUSES) influence.set(h.id, 0);
  for (const ev of events) {
    const days = Math.max(0, (now - ev.createdAt) / DAY);
    influence.set(ev.houseId, (influence.get(ev.houseId) ?? 0) + ev.points * Math.pow(0.98, days));
  }
  const total = [...influence.values()].reduce((a, b) => a + b, 0);
  const shares = new Map<HouseId, number>();
  for (const h of HOUSES) shares.set(h.id, total > 0 ? (influence.get(h.id) ?? 0) / total : 0);
  return shares;
}

/** Houses ranked by current realm-wide Influence (same 0.98^days decay as the
 * map, summed across every fief). All four Houses are always returned. */
export function houseStandings(events: InfluenceEvent[], now: number): HouseStandingRow[] {
  const influence = new Map<HouseId, number>();
  const led = new Map<HouseId, number>();
  const shares = realmHouseShares(events, now);
  for (const h of HOUSES) {
    influence.set(h.id, 0);
    led.set(h.id, 0);
  }

  for (const ev of events) {
    const days = Math.max(0, (now - ev.createdAt) / DAY);
    const decayed = ev.points * Math.pow(0.98, days);
    influence.set(ev.houseId, (influence.get(ev.houseId) ?? 0) + decayed);
  }

  for (const fiefId of new Set(events.map((e) => e.fiefId))) {
    const ctrl = fiefControl(fiefId, events, now);
    if (ctrl.leader && ctrl.leader.influence > 0) {
      led.set(ctrl.leader.houseId, (led.get(ctrl.leader.houseId) ?? 0) + 1);
    }
  }

  // No House is an "underdog" on an empty Realm — there is no leader to trail.
  const total = [...influence.values()].reduce((a, b) => a + b, 0);
  return HOUSES.map((h) => {
    const inf = influence.get(h.id) ?? 0;
    const share = shares.get(h.id) ?? 0;
    return {
      houseId: h.id,
      influence: inf,
      share,
      fiefsLed: led.get(h.id) ?? 0,
      blessed: total > 0 && underdogMultiplier(share) !== 1,
    };
  }).sort((a, b) => b.influence - a.influence);
}
