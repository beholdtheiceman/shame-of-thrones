import { describe, expect, it } from "vitest";
import { notificationsFor, type NotificationsForInput } from "./notifications";
import type { FiefControl } from "./selectors";
import type { HouseId } from "./types";

function control({
  leader = "flush",
  runnerUp = "bidet",
  contested = false,
}: {
  leader?: HouseId | null;
  runnerUp?: HouseId;
  contested?: boolean;
} = {}): FiefControl {
  const order = ([leader, runnerUp, "plunger", "porcelain"] as (HouseId | null)[])
    .filter((houseId): houseId is HouseId => houseId !== null)
    .filter((houseId, index, all) => all.indexOf(houseId) === index);
  const shares = order.map((houseId, index) => ({
    houseId,
    influence: index === 0 ? 100 : index === 1 ? 90 : 0,
    share: index === 0 ? 0.53 : index === 1 ? 0.47 : 0,
  }));
  return {
    fiefId: "fief-1",
    shares,
    leader: leader ? shares.find((share) => share.houseId === leader) ?? null : null,
    contested,
    totalInfluence: leader ? 190 : 0,
  };
}

function input(overrides: Partial<NotificationsForInput> = {}): NotificationsForInput {
  return {
    before: control(),
    after: control(),
    flipped: false,
    fiefId: "fief-1",
    contributorsByHouse: { flush: ["flush-user"], bidet: ["bidet-user"] },
    actingUserId: "actor",
    prefsByUser: {},
    existingWithin24h: [],
    ...overrides,
  };
}

describe("notificationsFor", () => {
  it("notifies leader and runner-up contributors when a fief becomes contested", () => {
    const rows = notificationsFor(input({ after: control({ contested: true }) }));
    expect(rows.map((row) => [row.userId, row.category])).toEqual([
      ["flush-user", "contested"],
      ["bidet-user", "contested"],
    ]);
  });

  it("notifies contributors to the losing House on a flip and excludes the actor", () => {
    const rows = notificationsFor(input({
      flipped: true,
      after: control({ leader: "bidet", runnerUp: "flush" }),
      contributorsByHouse: { flush: ["flush-user", "actor"] },
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: "flush-user", category: "banner_fallen", link: "fief-1" });
  });

  it("creates nothing when no notification transition occurs", () => {
    expect(notificationsFor(input())).toEqual([]);
  });

  it("dedupes an existing user/category/fief notification", () => {
    const rows = notificationsFor(input({
      after: control({ contested: true }),
      existingWithin24h: [{ userId: "flush-user", category: "contested", link: "fief-1" }],
    }));
    expect(rows.map((row) => row.userId)).toEqual(["bidet-user"]);
  });

  it("filters users who disabled the category while missing prefs default on", () => {
    const rows = notificationsFor(input({
      after: control({ contested: true }),
      prefsByUser: { "flush-user": { contested: false } },
    }));
    expect(rows.map((row) => row.userId)).toEqual(["bidet-user"]);
  });

  it("does not create banner_fallen without a previous leader", () => {
    expect(notificationsFor(input({
      before: control({ leader: null }),
      after: control({ leader: "bidet" }),
      flipped: true,
    }))).toEqual([]);
  });
});
