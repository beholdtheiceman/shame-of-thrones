import { describe, it, expect } from "vitest";
import { resolveBbox, parseSeedArgs, CITY_BBOX } from "./cityBbox";

describe("resolveBbox", () => {
  it("resolves a known city name to its bbox", () => {
    expect(resolveBbox({ city: "austin" })).toEqual(CITY_BBOX.austin);
  });
  it("parses an explicit --bbox 's,w,n,e'", () => {
    expect(resolveBbox({ bbox: "30.1,-97.9,30.5,-97.5" })).toEqual([30.1, -97.9, 30.5, -97.5]);
  });
  it("throws on an unknown city", () => {
    expect(() => resolveBbox({ city: "atlantis" })).toThrow(/unknown city/i);
  });
  it("throws when neither city nor bbox is given", () => {
    expect(() => resolveBbox({})).toThrow(/--city or --bbox/i);
  });
});

describe("parseSeedArgs", () => {
  it("reads flags into an options object", () => {
    const o = parseSeedArgs(["--city", "nyc", "--dry-run", "--source", "refuge,osm"]);
    expect(o).toEqual({ city: "nyc", dryRun: true, sources: ["refuge", "osm"] });
  });
  it("defaults sources to both and dryRun to false", () => {
    const o = parseSeedArgs(["--bbox", "1,2,3,4"]);
    expect(o).toEqual({ bbox: "1,2,3,4", dryRun: false, sources: ["refuge", "osm"] });
  });
});
