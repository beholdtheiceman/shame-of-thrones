import type { Equipped } from "./cosmetics";
import type { FiefControl, RankInfo } from "./selectors";
import type { CouncilRow, HouseStandingRow, WindowKey } from "./standings";
import type { Amenities, HouseId, LedgerEntry, Rating, ThroneCategory } from "./types";

export interface NotifyPrefsDTO {
  contested: boolean;
  banner_fallen: boolean;
  season_start: boolean;
}

export interface NotificationDTO {
  id: string;
  category: "contested" | "banner_fallen" | "season_start";
  title: string;
  body: string;
  link: string | null;
  createdAt: number;
  readAt: number | null;
}

export interface NotificationsDTO {
  notifications: NotificationDTO[];
  unreadCount: number;
}

export interface ThroneDTO {
  id: string; name: string; lat: number; lng: number;
  category: ThroneCategory; status: "rumored" | "verified";
  amenities: Amenities; addedBy: string; addedAt: number; lastConfirmedAt: number;
  fiefId: string; score: number | null; ratingCount: number; photoCount: number;
}

export interface RealmDTO {
  thrones: ThroneDTO[];
  ratings: Rating[];
  fiefs: FiefControl[];
  ledger: LedgerEntry[];
}

export interface MeDTO {
  profile: {
    id: string; name: string; houseId: HouseId; joinedAt: number;
    badges: string[]; notifyPrefs: NotifyPrefsDTO; lastHouseSwitchAt: number | null;
  } | null;
  rank?: RankInfo;
  streak?: { weeks: number; thisWeekActive: boolean };
  ageGate?: { confirmed: boolean; locked: boolean };
  cosmetics?: { owned: string[]; equipped: Equipped };
}

export interface StandingsDTO {
  council: { rows: CouncilRow[]; viewerRow: CouncilRow | null };
  houses: HouseStandingRow[];
  window: { key: WindowKey; start: number | null; end: number | null; seasonIndex?: number };
}
