import type { ThroneSource } from "@sot/core";

// bbox tuple = [south, west, north, east]
export type Bbox = [number, number, number, number];

export const CITY_BBOX: Record<string, Bbox> = {
  nyc: [40.700, -74.020, 40.788, -73.940],      // Manhattan (lower/mid)
  chicago: [41.850, -87.660, 41.920, -87.600],  // Loop + near north
  austin: [30.240, -97.760, 30.300, -97.720],   // Downtown
  raleigh: [35.750, -78.680, 35.820, -78.600],  // Downtown + inner ring (launch city)
};

export interface SeedOptions {
  city?: string;
  bbox?: string;
  dryRun: boolean;
  sources: ThroneSource[];
}

export function parseSeedArgs(argv: string[]): SeedOptions {
  const opts: SeedOptions = { dryRun: false, sources: ["refuge", "osm"] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--city") opts.city = argv[++i];
    else if (a === "--bbox") opts.bbox = argv[++i];
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--source") opts.sources = argv[++i].split(",") as ThroneSource[];
  }
  return opts;
}

export function resolveBbox(opts: { city?: string; bbox?: string }): Bbox {
  if (opts.bbox) {
    const parts = opts.bbox.split(",").map(Number);
    if (parts.length !== 4 || parts.some(Number.isNaN)) throw new Error("--bbox must be 's,w,n,e'");
    return parts as Bbox;
  }
  if (opts.city) {
    const b = CITY_BBOX[opts.city.toLowerCase()];
    if (!b) throw new Error(`unknown city "${opts.city}" — pass --bbox 's,w,n,e' instead`);
    return b;
  }
  throw new Error("provide --city or --bbox 's,w,n,e'");
}
