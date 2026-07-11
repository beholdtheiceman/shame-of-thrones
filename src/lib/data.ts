import type {
  House,
  HouseId,
  InfluenceEvent,
  LedgerEntry,
  Rating,
  Throne,
} from "./types";
import { fiefIdForCoords } from "./geo";

export const REALM_NAME = "King's Landing — Flatiron & Midtown";
export const REALM_CENTER: [number, number] = [40.746, -73.9895];
export const REALM_ZOOM = 14;

export const HOUSES: House[] = [
  {
    id: "flush",
    name: "House Flush",
    words: "A Royal Flush Beats a Full House",
    colorVar: "var(--house-flush)",
  },
  {
    id: "bidet",
    name: "House Bidet",
    words: "Cleanliness Is Coming",
    colorVar: "var(--house-bidet)",
  },
  {
    id: "plunger",
    name: "House Plunger",
    words: "We Do Not Clog",
    colorVar: "var(--house-plunger)",
  },
  {
    id: "porcelain",
    name: "House Porcelain",
    words: "Ours Is the Fury of Bleach",
    colorVar: "var(--house-porcelain)",
  },
];

export const HOUSE_BY_ID: Record<HouseId, House> = Object.fromEntries(
  HOUSES.map((h) => [h.id, h])
) as Record<HouseId, House>;

export const VERDICT_SCALE = [
  { value: 1 as const, glyph: "⚔️", label: "The Dungeon" },
  { value: 2 as const, glyph: "💀", label: "Peasant's Privy" },
  { value: 3 as const, glyph: "🛡️", label: "Soldier's Rest" },
  { value: 4 as const, glyph: "🏰", label: "Fit for a Knight" },
  { value: 5 as const, glyph: "👑", label: "The Iron Throne" },
];

export const THRONE_CATEGORY_LABEL: Record<string, string> = {
  cafe: "Café",
  restaurant: "Restaurant",
  park: "Park",
  transit: "Transit Station",
  library: "Library",
  retail: "Retail",
  municipal: "Municipal Building",
  gas_station: "Gas Station",
  other: "Other",
};

const day = 86_400_000;
const now = Date.now();

function baseAmenities(overrides: Partial<Throne["amenities"]> = {}) {
  return {
    accessible: true,
    babyChanging: false,
    genderNeutral: false,
    freeAccess: true,
    open24h: false,
    ...overrides,
  };
}

export const SEED_THRONES: Throne[] = [
  {
    id: "throne-bryant-park",
    name: "Bryant Park Comfort Station",
    lat: 40.7536,
    lng: -73.9832,
    category: "park",
    status: "verified",
    amenities: baseAmenities({ babyChanging: true, genderNeutral: true }),
    addedBy: "grand_maester_glenn",
    addedAt: now - 210 * day,
    lastConfirmedAt: now - 2 * day,
  },
  {
    id: "throne-nypl",
    name: "NYPL Schwarzman Building",
    lat: 40.7532,
    lng: -73.9822,
    category: "library",
    status: "verified",
    amenities: baseAmenities({ accessible: true }),
    addedBy: "lady_bathsheba",
    addedAt: now - 180 * day,
    lastConfirmedAt: now - 9 * day,
  },
  {
    id: "throne-union-square",
    name: "Union Square Park Restroom",
    lat: 40.7359,
    lng: -73.9911,
    category: "park",
    status: "verified",
    amenities: baseAmenities({ genderNeutral: true }),
    addedBy: "knight_errant_kai",
    addedAt: now - 160 * day,
    lastConfirmedAt: now - 5 * day,
  },
  {
    id: "throne-madison-square",
    name: "Madison Square Park Restroom",
    lat: 40.7424,
    lng: -73.9878,
    category: "park",
    status: "verified",
    amenities: baseAmenities(),
    addedBy: "squire_pat",
    addedAt: now - 140 * day,
    lastConfirmedAt: now - 40 * day,
  },
  {
    id: "throne-grand-central",
    name: "Grand Central Dining Concourse",
    lat: 40.7527,
    lng: -73.9772,
    category: "transit",
    status: "verified",
    amenities: baseAmenities({ freeAccess: false, open24h: true }),
    addedBy: "hand_of_the_throne_reyna",
    addedAt: now - 200 * day,
    lastConfirmedAt: now - 1 * day,
  },
  {
    id: "throne-penn-station",
    name: "Penn Station — Amtrak Level",
    lat: 40.7506,
    lng: -73.9935,
    category: "transit",
    status: "verified",
    amenities: baseAmenities({ freeAccess: false, open24h: true }),
    addedBy: "widow_of_the_westside",
    addedAt: now - 220 * day,
    lastConfirmedAt: now - 3 * day,
  },
  {
    id: "throne-chelsea-market",
    name: "Chelsea Market Restrooms",
    lat: 40.7424,
    lng: -74.0061,
    category: "retail",
    status: "verified",
    amenities: baseAmenities({ babyChanging: true }),
    addedBy: "ser.aldric_ii",
    addedAt: now - 120 * day,
    lastConfirmedAt: now - 12 * day,
  },
  {
    id: "throne-steeping-kettle",
    name: "The Steeping Kettle Café",
    lat: 40.7411,
    lng: -73.9897,
    category: "cafe",
    status: "verified",
    amenities: baseAmenities({ freeAccess: false }),
    addedBy: "squire_pat",
    addedAt: now - 60 * day,
    lastConfirmedAt: now - 20 * day,
  },
  {
    id: "throne-macys",
    name: "Macy's Herald Square — 8th Floor",
    lat: 40.7505,
    lng: -73.9878,
    category: "retail",
    status: "verified",
    amenities: baseAmenities({ accessible: true, babyChanging: true }),
    addedBy: "lady_bathsheba",
    addedAt: now - 95 * day,
    lastConfirmedAt: now - 30 * day,
  },
  {
    id: "throne-stuyvesant-square",
    name: "Stuyvesant Square Park",
    lat: 40.7346,
    lng: -73.9847,
    category: "park",
    status: "rumored",
    amenities: baseAmenities({ freeAccess: true }),
    addedBy: "knight_errant_kai",
    addedAt: now - 3 * day,
    lastConfirmedAt: now - 3 * day,
  },
];

function rating(
  id: string,
  throneId: string,
  authorName: string,
  houseId: HouseId,
  verdict: 1 | 2 | 3 | 4 | 5,
  tags: string[],
  testimony: string,
  daysAgo: number,
  verified = true
): Rating {
  return {
    id,
    throneId,
    authorName,
    houseId,
    verdict,
    tags,
    testimony,
    verified,
    createdAt: now - daysAgo * day,
  };
}

export const SEED_RATINGS: Rating[] = [
  rating(
    "r1",
    "throne-bryant-park",
    "grand_maester_glenn",
    "bidet",
    4,
    ["Clean", "Stocked", "Hot water"],
    "The Realm's finest public convenience. A destination in its own right.",
    2
  ),
  rating(
    "r2",
    "throne-bryant-park",
    "lady_bathsheba",
    "bidet",
    5,
    ["Clean", "Hidden gem"],
    "Attendants keep it spotless. Worthy of the Iron Throne.",
    6
  ),
  rating(
    "r3",
    "throne-nypl",
    "lady_bathsheba",
    "bidet",
    4,
    ["Clean", "Stocked"],
    "Quiet, marble, dignified. As a library privy should be.",
    9
  ),
  rating(
    "r4",
    "throne-nypl",
    "hand_of_the_throne_reyna",
    "flush",
    3,
    ["Line too long"],
    "Fine facilities, poor logistics during peak hours.",
    14
  ),
  rating(
    "r5",
    "throne-union-square",
    "knight_errant_kai",
    "flush",
    2,
    ["Door lock broken", "Smells like defeat"],
    "Held the line, but only just.",
    5
  ),
  rating(
    "r6",
    "throne-union-square",
    "squire_pat",
    "flush",
    3,
    ["Clean"],
    "Recently improved. The Realm remembers its former shame.",
    18
  ),
  rating(
    "r7",
    "throne-madison-square",
    "squire_pat",
    "plunger",
    3,
    ["Stocked"],
    "Soldier's Rest, exactly as advertised.",
    40
  ),
  rating(
    "r8",
    "throne-grand-central",
    "hand_of_the_throne_reyna",
    "flush",
    4,
    ["Clean", "Hot water"],
    "Commuter royalty deserves commuter plumbing. Delivered.",
    1
  ),
  rating(
    "r9",
    "throne-penn-station",
    "widow_of_the_westside",
    "porcelain",
    1,
    ["Smells like defeat", "No soap (a war crime)"],
    "Abandon all hope, ye who enter the Amtrak level.",
    3
  ),
  rating(
    "r10",
    "throne-penn-station",
    "ser.aldric_ii",
    "porcelain",
    2,
    ["Line too long", "Smells like defeat"],
    "Every commuter's daily penance.",
    11,
    false
  ),
  rating(
    "r11",
    "throne-chelsea-market",
    "ser.aldric_ii",
    "porcelain",
    4,
    ["Clean", "Hidden gem"],
    "Tucked past the lobster stand, worth the detour.",
    12
  ),
  rating(
    "r12",
    "throne-steeping-kettle",
    "squire_pat",
    "plunger",
    3,
    ["Stocked", "Hot water"],
    "Order a scone first, or the barista side-eyes you.",
    20
  ),
  rating(
    "r13",
    "throne-macys",
    "lady_bathsheba",
    "bidet",
    3,
    ["Clean"],
    "Surprisingly regal for a department store.",
    30
  ),
];

function influenceEvent(
  id: string,
  throne: Throne,
  houseId: HouseId,
  points: number,
  reason: InfluenceEvent["reason"],
  authorName: string,
  daysAgo: number
): InfluenceEvent {
  return {
    id,
    fiefId: fiefIdForCoords(throne.lat, throne.lng),
    houseId,
    points,
    reason,
    throneId: throne.id,
    authorName,
    createdAt: now - daysAgo * day,
  };
}

const byId = Object.fromEntries(SEED_THRONES.map((t) => [t.id, t]));

export const SEED_INFLUENCE: InfluenceEvent[] = [
  influenceEvent("i1", byId["throne-bryant-park"], "bidet", 10, "rating", "grand_maester_glenn", 2),
  influenceEvent("i2", byId["throne-bryant-park"], "bidet", 10, "rating", "lady_bathsheba", 6),
  influenceEvent("i3", byId["throne-bryant-park"], "bidet", 25, "new_throne", "grand_maester_glenn", 210),
  influenceEvent("i4", byId["throne-nypl"], "bidet", 10, "rating", "lady_bathsheba", 9),
  influenceEvent("i5", byId["throne-nypl"], "flush", 10, "rating", "hand_of_the_throne_reyna", 14),
  influenceEvent("i6", byId["throne-nypl"], "flush", 25, "new_throne", "hand_of_the_throne_reyna", 180),
  influenceEvent("i7", byId["throne-union-square"], "flush", 10, "rating", "knight_errant_kai", 5),
  influenceEvent("i8", byId["throne-union-square"], "flush", 10, "rating", "squire_pat", 18),
  influenceEvent("i9", byId["throne-madison-square"], "plunger", 10, "rating", "squire_pat", 40),
  influenceEvent("i10", byId["throne-madison-square"], "plunger", 25, "new_throne", "squire_pat", 140),
  influenceEvent("i11", byId["throne-grand-central"], "flush", 10, "rating", "hand_of_the_throne_reyna", 1),
  influenceEvent("i12", byId["throne-grand-central"], "flush", 25, "new_throne", "hand_of_the_throne_reyna", 200),
  influenceEvent("i13", byId["throne-penn-station"], "porcelain", 10, "rating", "widow_of_the_westside", 3),
  influenceEvent("i14", byId["throne-penn-station"], "porcelain", 2, "hearsay", "ser.aldric_ii", 11),
  influenceEvent("i15", byId["throne-chelsea-market"], "porcelain", 10, "rating", "ser.aldric_ii", 12),
  influenceEvent("i16", byId["throne-chelsea-market"], "porcelain", 25, "new_throne", "ser.aldric_ii", 120),
  influenceEvent("i17", byId["throne-steeping-kettle"], "plunger", 10, "rating", "squire_pat", 20),
  influenceEvent("i18", byId["throne-macys"], "bidet", 10, "rating", "lady_bathsheba", 30),
  influenceEvent("i19", byId["throne-macys"], "flush", 3, "confirmation", "hand_of_the_throne_reyna", 30),
];

export const SEED_LEDGER: LedgerEntry[] = [
  { id: "l1", createdAt: now - 1 * day, text: "**Fief near Grand Central** holds firm under **House Flush**." },
  { id: "l2", createdAt: now - 2 * day, text: "**grand_maester_glenn** struck a banner at **Bryant Park Comfort Station**." },
  { id: "l3", createdAt: now - 3 * day, text: "**House Porcelain** rallies at **Penn Station** — a grim outpost, bravely held." },
  { id: "l4", createdAt: now - 9 * day, text: "**House Bidet** and **House Flush** remain locked in contest near the **Library Fief**." },
  { id: "l5", createdAt: now - 12 * day, text: "**ser.aldric_ii** earns favor confirming **Chelsea Market Restrooms** still stands." },
  { id: "l6", createdAt: now - 18 * day, text: "**House Flush** reinforces **Union Square** after a season of neglect." },
];
