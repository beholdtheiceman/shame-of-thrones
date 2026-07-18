import type { ThroneCategory, Amenities } from "./types";

export type ThroneSource = "refuge" | "osm";

export interface SeededThrone {
  name: string;
  lat: number;
  lng: number;
  category: ThroneCategory;
  amenities: Amenities;
  source: ThroneSource;
  sourceId: string;
}

const NO_AMENITIES: Amenities = {
  accessible: false, babyChanging: false, genderNeutral: false, freeAccess: false, open24h: false,
};

// --- Refuge Restrooms API (https://www.refugerestrooms.org/api/docs/) ---
export interface RefugeRaw {
  id: number;
  name: string;
  latitude: string | number;
  longitude: string | number;
  accessible?: boolean;
  unisex?: boolean;
  changing_table?: boolean;
}

export function normalizeRefuge(raw: RefugeRaw): SeededThrone {
  return {
    name: raw.name?.trim() || "Public restroom",
    lat: Number(raw.latitude),
    lng: Number(raw.longitude),
    category: "other", // Refuge carries no venue type
    amenities: {
      ...NO_AMENITIES,
      accessible: raw.accessible === true,
      genderNeutral: raw.unisex === true,
      babyChanging: raw.changing_table === true,
    },
    source: "refuge",
    sourceId: String(raw.id),
  };
}

// --- OSM Overpass node (amenity=toilets) ---
export interface OsmNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

export function normalizeOsm(node: OsmNode): SeededThrone {
  const tags = node.tags ?? {};
  return {
    name: tags.name?.trim() || "Public restroom",
    lat: node.lat,
    lng: node.lon,
    category: "other",
    amenities: {
      ...NO_AMENITIES,
      accessible: tags.wheelchair === "yes",
      babyChanging: tags.changing_table === "yes",
      genderNeutral: tags.unisex === "yes" || typeof tags.gender === "string",
      freeAccess: tags.fee === "no",
      open24h: tags.opening_hours === "24/7",
    },
    source: "osm",
    sourceId: String(node.id),
  };
}
