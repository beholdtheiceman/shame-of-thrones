export type HouseId = "flush" | "bidet" | "plunger" | "porcelain";

export interface House {
  id: HouseId;
  name: string;
  words: string;
  colorVar: string; // CSS custom property, e.g. "var(--house-flush)"
}

export type ThroneCategory =
  | "cafe"
  | "restaurant"
  | "park"
  | "transit"
  | "library"
  | "retail"
  | "municipal"
  | "gas_station"
  | "other";

export type ThroneStatus = "rumored" | "verified";

export interface Amenities {
  accessible: boolean;
  babyChanging: boolean;
  genderNeutral: boolean;
  freeAccess: boolean;
  open24h: boolean;
}

export interface Rating {
  id: string;
  throneId: string;
  authorName: string;
  houseId: HouseId;
  verdict: 1 | 2 | 3 | 4 | 5;
  tags: string[];
  testimony: string;
  verified: boolean; // proximity-passed vs. hearsay
  createdAt: number;
}

export interface Throne {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: ThroneCategory;
  status: ThroneStatus;
  amenities: Amenities;
  addedBy: string;
  addedAt: number;
  lastConfirmedAt: number;
}

export interface InfluenceEvent {
  id: string;
  fiefId: string; // H3 cell index
  houseId: HouseId;
  points: number;
  reason: "rating" | "first_of_name" | "new_throne" | "confirmation" | "hearsay" | "reversal";
  throneId: string;
  authorName: string;
  createdAt: number;
}

export interface LedgerEntry {
  id: string;
  createdAt: number;
  text: string; // pre-rendered dispatch text, may include ** for emphasis
}

export type BadgeId = "first_of_their_name" | "cartographer" | "nights_watch" | "oathkeeper";

export interface Profile {
  name: string;
  houseId: HouseId;
  joinedAt: number;
  badges: BadgeId[];
  lastHouseSwitchAt: number | null;
}
