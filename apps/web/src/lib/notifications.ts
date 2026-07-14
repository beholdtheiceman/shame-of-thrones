import { HOUSE_BY_ID } from "./data";
import type { FiefControl } from "./selectors";
import type { HouseId } from "./types";

export type NotificationCategory = "contested" | "banner_fallen" | "season_start";

export interface NotificationPrefs {
  contested?: boolean;
  banner_fallen?: boolean;
  season_start?: boolean;
}

export interface NotificationCandidate {
  userId: string;
  category: Exclude<NotificationCategory, "season_start">;
  title: string;
  body: string;
  link: string;
}

export interface ExistingNotificationKey {
  userId: string;
  category: NotificationCategory;
  link: string | null;
}

export interface NotificationsForInput {
  before: FiefControl;
  after: FiefControl;
  flipped: boolean;
  fiefId: string;
  contributorsByHouse: Partial<Record<HouseId, string[]>>;
  actingUserId: string;
  prefsByUser: Record<string, NotificationPrefs | undefined>;
  existingWithin24h: ExistingNotificationKey[];
}

/** Pure recipient selection for the rating-triggered notification categories. */
export function notificationsFor({
  before,
  after,
  flipped,
  fiefId,
  contributorsByHouse,
  actingUserId,
  prefsByUser,
  existingWithin24h,
}: NotificationsForInput): NotificationCandidate[] {
  const existing = new Set(
    existingWithin24h.map((row) => `${row.userId}\u0000${row.category}\u0000${row.link ?? ""}`)
  );
  const rows: NotificationCandidate[] = [];

  function addForHouses(
    houses: HouseId[],
    category: NotificationCandidate["category"],
    title: string,
    body: string
  ) {
    const recipients = new Set(houses.flatMap((houseId) => contributorsByHouse[houseId] ?? []));
    for (const userId of recipients) {
      if (userId === actingUserId) continue;
      if (prefsByUser[userId]?.[category] === false) continue;
      const key = `${userId}\u0000${category}\u0000${fiefId}`;
      if (existing.has(key)) continue;
      existing.add(key);
      rows.push({ userId, category, title, body, link: fiefId });
    }
  }

  if (flipped && before.leader) {
    const lostHouse = before.leader.houseId;
    addForHouses(
      [lostHouse],
      "banner_fallen",
      "A Banner Has Fallen",
      `${HOUSE_BY_ID[lostHouse].name} has lost a fief. Rally your House.`
    );
  }

  if (after.contested && !before.contested && after.leader) {
    const runnerUp = after.shares.find((share) => share.houseId !== after.leader?.houseId);
    if (runnerUp) {
      addForHouses(
        [after.leader.houseId, runnerUp.houseId],
        "contested",
        "A Fief Is Contested",
        `${HOUSE_BY_ID[after.leader.houseId].name} and ${HOUSE_BY_ID[runnerUp.houseId].name} are locked in a close struggle.`
      );
    }
  }

  return rows;
}
