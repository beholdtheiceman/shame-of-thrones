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

import { dedupeCrossSource, isDuplicate, DEDUP_RADIUS_M } from "./seeding";

describe("dedup", () => {
  const refuge: SeededThrone = {
    name: "Refuge WC", lat: 40.7128, lng: -74.006, category: "other",
    amenities: { accessible: true, babyChanging: false, genderNeutral: true, freeAccess: false, open24h: false },
    source: "refuge", sourceId: "1",
  };
  const osmClose: SeededThrone = { ...refuge, name: "OSM WC", lat: 40.71289, lng: -74.006, source: "osm", sourceId: "2" };
  const osmFar: SeededThrone = { ...refuge, name: "Far WC", lat: 40.7146, lng: -74.006, source: "osm", sourceId: "3" };

  it("exposes a 25m radius constant", () => {
    expect(DEDUP_RADIUS_M).toBe(25);
  });

  it("merges cross-source records within the radius, preferring Refuge metadata", () => {
    const out = dedupeCrossSource([refuge, osmClose, osmFar]);
    expect(out).toHaveLength(2);
    const merged = out.find((t) => t.lat === refuge.lat)!;
    expect(merged.source).toBe("refuge");
    expect(out.some((t) => t.sourceId === "3")).toBe(true);
  });

  it("isDuplicate is true only within the radius of an existing throne", () => {
    const existing = [{ lat: 40.7128, lng: -74.006 }];
    expect(isDuplicate({ lat: 40.71289, lng: -74.006 }, existing)).toBe(true);
    expect(isDuplicate({ lat: 40.7146, lng: -74.006 }, existing)).toBe(false);
  });
});
