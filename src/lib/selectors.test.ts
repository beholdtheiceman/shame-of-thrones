import { describe, expect, it } from "vitest";
import { fiefCardModel, fiefControl, lifetimeXp, rankForXp, throneScore, tierForScore } from "./selectors";
import type { InfluenceEvent, Rating } from "./types";

const DAY = 86_400_000;
const NOW = 1_750_000_000_000;

function rating(overrides: Partial<Rating>): Rating {
  return {
    id: "r1", throneId: "t1", authorName: "A", houseId: "flush",
    verdict: 3, tags: [], testimony: "", verified: true, createdAt: NOW,
    ...overrides,
  };
}

function event(overrides: Partial<InfluenceEvent>): InfluenceEvent {
  return {
    id: "i1", fiefId: "f1", houseId: "flush", points: 10,
    reason: "rating", throneId: "t1", authorName: "A", createdAt: NOW,
    ...overrides,
  };
}

describe("throneScore", () => {
  it("weights verified 3x hearsay", () => {
    const { score } = throneScore("t1", [
      rating({ id: "a", verdict: 5, verified: true }),
      rating({ id: "b", verdict: 1, verified: false }),
    ], NOW);
    // (3*5 + 1*1) / 4 = 4
    expect(score).toBeCloseTo(4.0, 5);
  });

  it("decays with a 60-day half-life", () => {
    const { score } = throneScore("t1", [
      rating({ id: "a", verdict: 5, createdAt: NOW - 60 * DAY }), // weight 1.5
      rating({ id: "b", verdict: 1, createdAt: NOW }),            // weight 3
    ], NOW);
    // (1.5*5 + 3*1) / 4.5 = 2.333...
    expect(score).toBeCloseTo(7 / 3, 5);
  });

  it("returns null with no ratings", () => {
    expect(throneScore("t1", [], NOW).score).toBeNull();
  });
});

describe("fiefControl", () => {
  it("decays influence 2%/day and picks the leader", () => {
    const control = fiefControl("f1", [
      event({ id: "a", houseId: "flush", points: 100, createdAt: NOW - 35 * DAY }),
      event({ id: "b", houseId: "bidet", points: 60, createdAt: NOW }),
    ], NOW);
    // flush: 100 * 0.98^35 ≈ 49.3 → bidet leads
    expect(control.leader?.houseId).toBe("bidet");
    expect(control.shares[0].influence).toBeCloseTo(60, 5);
    expect(control.shares[1].influence).toBeCloseTo(100 * Math.pow(0.98, 35), 5);
  });

  it("flags contested within 15%", () => {
    const control = fiefControl("f1", [
      event({ id: "a", houseId: "flush", points: 100 }),
      event({ id: "b", houseId: "bidet", points: 90 }),
    ], NOW);
    expect(control.contested).toBe(true);
  });

  it("is not contested at a 20% gap", () => {
    const control = fiefControl("f1", [
      event({ id: "a", houseId: "flush", points: 100 }),
      event({ id: "b", houseId: "bidet", points: 80 }),
    ], NOW);
    expect(control.contested).toBe(false);
  });
});

describe("ranks", () => {
  it("sums lifetime xp per author without decay", () => {
    const xp = lifetimeXp("A", [
      event({ id: "a", points: 10, createdAt: NOW - 400 * DAY }),
      event({ id: "b", points: 15 }),
      event({ id: "c", points: 99, authorName: "B" }),
    ]);
    expect(xp).toBe(25);
  });

  it("maps xp to ranks at documented floors", () => {
    expect(rankForXp(0).name).toBe("Peasant");
    expect(rankForXp(100).name).toBe("Squire");
    expect(rankForXp(299).name).toBe("Squire");
    expect(rankForXp(300).name).toBe("Knight");
    expect(rankForXp(12000).name).toBe("Grand Maester of the Privy Council");
    expect(rankForXp(12000).progress).toBe(1);
  });
});

describe("tierForScore", () => {
  it("rounds to the nearest tier", () => {
    expect(tierForScore(4.2).label).toBe("Fit for a Knight");
    expect(tierForScore(2.49).label).toBe("Peasant's Privy");
    expect(tierForScore(2.5).label).toBe("Soldier's Rest");
    expect(tierForScore(4.5).label).toBe("The Iron Throne");
    expect(tierForScore(1.0).label).toBe("The Dungeon");
  });

  it("clamps out-of-range scores", () => {
    expect(tierForScore(0.2).value).toBe(1);
    expect(tierForScore(9).value).toBe(5);
  });

  it("returns the glyph for display", () => {
    expect(tierForScore(4.2).glyph).toBe("🏰");
  });
});

describe("fiefCardModel", () => {
  it("maps shares to integer percents, sorted desc, all four Houses", () => {
    const control = fiefControl("f1", [
      event({ id: "a", houseId: "flush", points: 42 }),
      event({ id: "b", houseId: "bidet", points: 38 }),
      event({ id: "c", houseId: "plunger", points: 20 }),
    ], NOW);
    const model = fiefCardModel(control);
    expect(model.held).toBe(true);
    expect(model.leaderHouseId).toBe("flush");
    expect(model.rows.map((r) => r.houseId)).toEqual([
      "flush", "bidet", "plunger", "porcelain",
    ]);
    expect(model.rows.map((r) => r.percent)).toEqual([42, 38, 20, 0]);
  });

  it("flags contested fiefs", () => {
    const control = fiefControl("f1", [
      event({ id: "a", houseId: "flush", points: 50 }),
      event({ id: "b", houseId: "bidet", points: 48 }),
    ], NOW);
    expect(fiefCardModel(control).contested).toBe(true);
  });

  it("renders the empty state for missing or zero-influence fiefs", () => {
    for (const model of [fiefCardModel(null), fiefCardModel(fiefControl("f9", [], NOW))]) {
      expect(model.held).toBe(false);
      expect(model.leaderHouseId).toBeNull();
      expect(model.contested).toBe(false);
      expect(model.rows).toHaveLength(4);
      expect(model.rows.every((r) => r.percent === 0)).toBe(true);
    }
  });
});
