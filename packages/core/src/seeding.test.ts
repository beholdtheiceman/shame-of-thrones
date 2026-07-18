import { describe, it, expect } from "vitest";
import { normalizeRefuge, normalizeOsm, type SeededThrone } from "./seeding";

describe("normalizeRefuge", () => {
  it("maps a Refuge record to a SeededThrone with amenity + category defaults", () => {
    const raw = {
      id: 42, name: "City Hall Restroom", latitude: "40.7128", longitude: "-74.0060",
      accessible: true, unisex: true, changing_table: false,
    };
    const t = normalizeRefuge(raw);
    expect(t).toEqual<SeededThrone>({
      name: "City Hall Restroom", lat: 40.7128, lng: -74.006,
      category: "other",
      amenities: { accessible: true, babyChanging: false, genderNeutral: true, freeAccess: false, open24h: false },
      source: "refuge", sourceId: "42",
    });
  });
});

describe("normalizeOsm", () => {
  it("maps an OSM node, reading amenities from tags with false defaults", () => {
    const node = {
      type: "node", id: 999, lat: 41.8781, lon: -87.6298,
      tags: { amenity: "toilets", name: "Millennium Park WC", wheelchair: "yes", fee: "no", "opening_hours": "24/7" },
    };
    const t = normalizeOsm(node);
    expect(t).toEqual<SeededThrone>({
      name: "Millennium Park WC", lat: 41.8781, lng: -87.6298,
      category: "other",
      amenities: { accessible: true, babyChanging: false, genderNeutral: false, freeAccess: true, open24h: true },
      source: "osm", sourceId: "999",
    });
  });

  it("synthesizes a name when the OSM node has no name tag", () => {
    const node = { type: "node", id: 7, lat: 30.2672, lon: -97.7431, tags: { amenity: "toilets" } };
    expect(normalizeOsm(node).name).toBe("Public restroom");
  });
});
