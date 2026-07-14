import { describe, expect, it } from "vitest";
import { UNDERDOG, underdogMultiplier } from "./game/rules";
import type { HouseId, InfluenceEvent } from "./types";
import {
  houseStandings,
  realmHouseShares,
  seasonWindow,
  smallCouncil,
  weekWindow,
  windowRange,
} from "./standings";

const DAY = 86_400_000;
// Thursday 2026-07-16 12:00:00 UTC
const NOW = Date.UTC(2026, 6, 16, 12, 0, 0);

function event(overrides: Partial<InfluenceEvent>): InfluenceEvent {
  return {
    id: "i1", fiefId: "f1", houseId: "flush", points: 10,
    reason: "rating", throneId: "t1", authorName: "Alice", createdAt: NOW,
    ...overrides,
  };
}

describe("weekWindow", () => {
  it("starts Monday 00:00 UTC and spans 7 days", () => {
    const { start, end } = weekWindow(NOW);
    // Monday of that week is 2026-07-13 00:00 UTC
    expect(start).toBe(Date.UTC(2026, 6, 13));
    expect(end).toBe(Date.UTC(2026, 6, 20));
  });

  it("puts Monday 00:00 itself in the current week", () => {
    const monday = Date.UTC(2026, 6, 13);
    expect(weekWindow(monday).start).toBe(monday);
  });

  it("puts Sunday 23:59 in the same week (not the next)", () => {
    const sundayNight = Date.UTC(2026, 6, 19, 23, 59);
    expect(weekWindow(sundayNight).start).toBe(Date.UTC(2026, 6, 13));
  });
});

describe("seasonWindow", () => {
  it("returns 56-day windows aligned to the genesis Monday", () => {
    const { start, end, index } = seasonWindow(NOW);
    expect((end - start) / DAY).toBe(56);
    expect(Number.isInteger(index)).toBe(true);
    expect(start).toBeLessThanOrEqual(NOW);
    expect(end).toBeGreaterThan(NOW);
  });
});

describe("windowRange", () => {
  it("returns null for all-time (no bounds)", () => {
    expect(windowRange("all", NOW)).toBeNull();
  });
  it("returns the week bounds for week", () => {
    expect(windowRange("week", NOW)).toEqual(weekWindow(NOW));
  });
});

describe("smallCouncil", () => {
  const base = { now: NOW, houseFilter: null as HouseId | null, viewerName: undefined };

  it("sums a user's points within the window and ranks desc", () => {
    const events = [
      event({ authorName: "Alice", points: 30, createdAt: NOW - 1 * DAY }),
      event({ authorName: "Bob", points: 50, createdAt: NOW - 1 * DAY }),
      event({ authorName: "Alice", points: 15, createdAt: NOW - 2 * DAY }),
    ];
    const { rows } = smallCouncil(events, { ...base, window: "week" });
    expect(rows.map((r) => [r.name, r.points, r.position])).toEqual([
      ["Bob", 50, 1],
      ["Alice", 45, 2],
    ]);
  });

  it("excludes events outside the window", () => {
    const events = [
      event({ authorName: "Alice", points: 30, createdAt: NOW - 1 * DAY }),
      event({ authorName: "Old", points: 999, createdAt: NOW - 30 * DAY }),
    ];
    const { rows } = smallCouncil(events, { ...base, window: "week" });
    expect(rows.map((r) => r.name)).toEqual(["Alice"]);
  });

  it("nets out reversal events per author and drops non-positive totals", () => {
    const events = [
      event({ authorName: "Alice", points: 40, createdAt: NOW - 1 * DAY }),
      event({ authorName: "Alice", points: -40, reason: "reversal", createdAt: NOW - 1 * DAY }),
      event({ authorName: "Bob", points: 10, createdAt: NOW - 1 * DAY }),
    ];
    const { rows } = smallCouncil(events, { ...base, window: "week" });
    expect(rows.map((r) => r.name)).toEqual(["Bob"]); // Alice netted to 0
  });

  it("restricts population by house filter", () => {
    const events = [
      event({ authorName: "Alice", houseId: "flush", points: 30, createdAt: NOW - 1 * DAY }),
      event({ authorName: "Bob", houseId: "bidet", points: 50, createdAt: NOW - 1 * DAY }),
    ];
    const { rows } = smallCouncil(events, { ...base, window: "week", houseFilter: "flush" });
    expect(rows.map((r) => r.name)).toEqual(["Alice"]);
  });

  it("tie-breaks equal points by earliest contribution then name", () => {
    const events = [
      event({ authorName: "Zed", points: 20, createdAt: NOW - 1 * DAY }),
      event({ authorName: "Amy", points: 20, createdAt: NOW - 2 * DAY }),
    ];
    const { rows } = smallCouncil(events, { ...base, window: "week" });
    expect(rows.map((r) => r.name)).toEqual(["Amy", "Zed"]); // Amy earned earlier
  });

  it("all-time equals the lifetime point sum regardless of date", () => {
    const events = [
      event({ authorName: "Alice", points: 30, createdAt: NOW - 300 * DAY }),
      event({ authorName: "Alice", points: 20, createdAt: NOW }),
    ];
    const { rows } = smallCouncil(events, { ...base, window: "all" });
    expect(rows).toEqual([{ name: "Alice", houseId: "flush", points: 50, position: 1 }]);
  });

  it("pins the viewer's true position when off the top-50 list", () => {
    const events = Array.from({ length: 55 }, (_, i) =>
      event({ authorName: `U${String(i).padStart(2, "0")}`, points: 1000 - i, createdAt: NOW - 1 * DAY })
    );
    const { rows, viewerRow } = smallCouncil(events, { ...base, window: "week", viewerName: "U54" });
    expect(rows).toHaveLength(50);
    expect(viewerRow).toEqual({ name: "U54", houseId: "flush", points: 946, position: 55 });
  });

  it("returns viewerRow null when the viewer is already in the top list", () => {
    const events = [event({ authorName: "Alice", points: 30, createdAt: NOW - 1 * DAY })];
    const { viewerRow } = smallCouncil(events, { ...base, window: "week", viewerName: "Alice" });
    expect(viewerRow).toBeNull();
  });
});

describe("houseStandings", () => {
  it("ranks Houses by current decayed realm-wide influence with shares", () => {
    const events = [
      event({ houseId: "flush", fiefId: "f1", points: 100, createdAt: NOW }),
      event({ houseId: "bidet", fiefId: "f1", points: 300, createdAt: NOW }),
    ];
    const rows = houseStandings(events, NOW);
    expect(rows).toHaveLength(4); // all Houses always present
    expect(rows[0].houseId).toBe("bidet");
    expect(rows[0].share).toBeCloseTo(0.75, 5);
    expect(rows[1].houseId).toBe("flush");
    expect(rows[1].share).toBeCloseTo(0.25, 5);
  });

  it("counts fiefs led per House", () => {
    const events = [
      // f1: bidet leads
      event({ houseId: "bidet", fiefId: "f1", points: 100, createdAt: NOW }),
      event({ houseId: "flush", fiefId: "f1", points: 10, createdAt: NOW }),
      // f2: flush leads
      event({ houseId: "flush", fiefId: "f2", points: 100, createdAt: NOW }),
    ];
    const rows = houseStandings(events, NOW);
    const byId = Object.fromEntries(rows.map((r) => [r.houseId, r]));
    expect(byId.bidet.fiefsLed).toBe(1);
    expect(byId.flush.fiefsLed).toBe(1);
    expect(byId.plunger.fiefsLed).toBe(0);
  });

  it("returns an honest zero state when there is no influence", () => {
    const rows = houseStandings([], NOW);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.influence === 0 && r.share === 0 && r.fiefsLed === 0)).toBe(true);
  });
});

describe("underdogMultiplier", () => {
  it("boosts a House below the share threshold", () => {
    expect(underdogMultiplier(0.149)).toBe(UNDERDOG.multiplier);
  });
  it("does not boost at or above the threshold", () => {
    expect(underdogMultiplier(UNDERDOG.shareThreshold)).toBe(1);
    expect(underdogMultiplier(0.30)).toBe(1);
  });
});

describe("realmHouseShares", () => {
  it("returns each House's decayed share, summing to 1", () => {
    const events = [
      event({ houseId: "flush", points: 100, createdAt: NOW }),
      event({ houseId: "bidet", points: 300, createdAt: NOW }),
    ];
    const shares = realmHouseShares(events, NOW);
    expect(shares.get("flush")).toBeCloseTo(0.25, 5);
    expect(shares.get("bidet")).toBeCloseTo(0.75, 5);
    const total = [...shares.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 5);
  });
  it("is all zero on empty input", () => {
    const shares = realmHouseShares([], NOW);
    expect([...shares.values()].every((s) => s === 0)).toBe(true);
  });
});

describe("houseStandings blessed flag", () => {
  it("marks a sub-threshold House blessed and a dominant House not", () => {
    const events = [
      event({ houseId: "bidet", fiefId: "f1", points: 1000, createdAt: NOW }),
      event({ houseId: "flush", fiefId: "f1", points: 10, createdAt: NOW }),
    ];
    const rows = houseStandings(events, NOW);
    const byId = Object.fromEntries(rows.map((r) => [r.houseId, r]));
    expect(byId.flush.blessed).toBe(true);
    expect(byId.bidet.blessed).toBe(false);
  });
});
