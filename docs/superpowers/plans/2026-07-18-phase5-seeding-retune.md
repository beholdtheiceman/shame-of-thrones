# Phase 5 Seeding Pipeline + Hex Re-tune Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed real restroom data (Refuge Restrooms + OpenStreetMap) into the DB for a launch city via CLI, and re-tune the H3 fief resolution from res-9 to res-7.

**Architecture:** Pure, unit-tested normalize + dedup logic lives in `@sot/core`. Two `tsx` CLI scripts under `apps/web/src/db/` do the I/O: `seedReset.ts` (guarded owner-run wipe of demo data) and `seedCity.ts` (fetch → normalize → dedup → idempotent upsert). The re-tune is a one-line constant change; because the demo wipe removes all res-9 `influence_events` before any real data loads, no res-9/res-7 reconciliation is needed.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres/Neon), h3-js, vitest, tsx, Next.js (apps/web), npm workspaces (`@sot/core`).

**Spec:** `docs/superpowers/specs/2026-07-18-phase5-seeding-retune-design.md`

---

## File Structure

**Create:**
- `packages/core/src/seeding.ts` — pure normalize + dedup logic and `SeededThrone` type. One responsibility: transform raw source records into deduped throne candidates.
- `packages/core/src/seeding.test.ts` — unit tests for normalize + dedup.
- `apps/web/src/db/seedCity.ts` — the fetch/upsert CLI script (I/O glue).
- `apps/web/src/db/seedReset.ts` — the guarded demo-wipe CLI script (I/O glue).
- `apps/web/src/db/cityBbox.ts` — pure city-name → bbox lookup + CLI arg parsing.
- `apps/web/src/db/cityBbox.test.ts` — unit tests for the lookup + arg parser.

**Modify:**
- `packages/core/src/geo.ts` — change `FIEF_RESOLUTION` 9 → 7; rewrite the comment.
- `packages/core/src/index.ts` — `export * from "./seeding"`.
- `apps/web/src/db/schema.ts` — add `source`, `source_id` columns + partial unique index to `thrones`.
- `apps/web/package.json` — add `seed:city` and `seed:reset` scripts.
- Any core test fixture that hardcodes a res-9 H3 cell id (found in Task 3).

---

## Task 1: `SeededThrone` type + normalize logic (core)

**Files:**
- Create: `packages/core/src/seeding.ts`
- Test: `packages/core/src/seeding.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/seeding.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/seeding.test.ts`
Expected: FAIL — cannot resolve `./seeding` / `normalizeRefuge is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/seeding.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/seeding.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/seeding.ts packages/core/src/seeding.test.ts
git commit -m "feat(seeding): normalize Refuge + OSM records to SeededThrone"
```

---

## Task 2: dedup logic (core)

**Files:**
- Modify: `packages/core/src/seeding.ts`
- Test: `packages/core/src/seeding.test.ts` (add a `describe`)

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/seeding.test.ts`:

```ts
import { dedupeCrossSource, isDuplicate, DEDUP_RADIUS_M } from "./seeding";

describe("dedup", () => {
  const refuge: SeededThrone = {
    name: "Refuge WC", lat: 40.7128, lng: -74.006, category: "other",
    amenities: { accessible: true, babyChanging: false, genderNeutral: true, freeAccess: false, open24h: false },
    source: "refuge", sourceId: "1",
  };
  // ~10m away — same physical restroom
  const osmClose: SeededThrone = { ...refuge, name: "OSM WC", lat: 40.71289, lng: -74.006, source: "osm", sourceId: "2" };
  // ~200m away — distinct
  const osmFar: SeededThrone = { ...refuge, name: "Far WC", lat: 40.7146, lng: -74.006, source: "osm", sourceId: "3" };

  it("exposes a 25m radius constant", () => {
    expect(DEDUP_RADIUS_M).toBe(25);
  });

  it("merges cross-source records within the radius, preferring Refuge metadata", () => {
    const out = dedupeCrossSource([refuge, osmClose, osmFar]);
    expect(out).toHaveLength(2);
    const merged = out.find((t) => t.lat === refuge.lat)!;
    expect(merged.source).toBe("refuge"); // Refuge preferred on merge
    expect(out.some((t) => t.sourceId === "3")).toBe(true); // far one kept
  });

  it("isDuplicate is true only within the radius of an existing throne", () => {
    const existing = [{ lat: 40.7128, lng: -74.006 }];
    expect(isDuplicate({ lat: 40.71289, lng: -74.006 }, existing)).toBe(true);
    expect(isDuplicate({ lat: 40.7146, lng: -74.006 }, existing)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/seeding.test.ts`
Expected: FAIL — `dedupeCrossSource is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `packages/core/src/seeding.ts` (import `haversineMeters` at top):

```ts
import { haversineMeters } from "./geo";

export const DEDUP_RADIUS_M = 25;

const SOURCE_RANK: Record<ThroneSource, number> = { refuge: 0, osm: 1 }; // lower = preferred

/**
 * Collapse records that describe the same physical restroom (within
 * DEDUP_RADIUS_M) across sources. On a merge, the Refuge record wins
 * (purpose-built metadata); OSM is the fallback.
 */
export function dedupeCrossSource(records: SeededThrone[]): SeededThrone[] {
  const kept: SeededThrone[] = [];
  for (const rec of records) {
    const dupeIdx = kept.findIndex(
      (k) => haversineMeters({ lat: k.lat, lng: k.lng }, { lat: rec.lat, lng: rec.lng }) <= DEDUP_RADIUS_M
    );
    if (dupeIdx === -1) {
      kept.push(rec);
    } else if (SOURCE_RANK[rec.source] < SOURCE_RANK[kept[dupeIdx].source]) {
      kept[dupeIdx] = rec; // prefer the higher-ranked source
    }
  }
  return kept;
}

/** True if `candidate` sits within DEDUP_RADIUS_M of any already-present throne. */
export function isDuplicate(
  candidate: { lat: number; lng: number },
  existing: { lat: number; lng: number }[]
): boolean {
  return existing.some((e) => haversineMeters(e, candidate) <= DEDUP_RADIUS_M);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/seeding.test.ts`
Expected: PASS (all tests, including the 4 new).

- [ ] **Step 5: Export from the core barrel**

Add to `packages/core/src/index.ts`:

```ts
export * from "./seeding";
```

- [ ] **Step 6: Run the full core suite**

Run: `cd packages/core && npx vitest run`
Expected: PASS (existing 61 + new).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/seeding.ts packages/core/src/seeding.test.ts packages/core/src/index.ts
git commit -m "feat(seeding): cross-source + DB dedup helpers (25m radius)"
```

---

## Task 3: Hex re-tune (res-9 → res-7)

**Files:**
- Modify: `packages/core/src/geo.ts:7`
- Modify: any core test fixture with a hardcoded res-9 cell id (found below).

- [ ] **Step 1: Find hardcoded res-9 cell ids**

Run: `cd packages/core && grep -rn "89\|resolution\|latLngToCell\|FIEF_RESOLUTION" src/*.test.ts`
Note: res-9 H3 indexes begin `89...`; res-7 begin `87...`. Any test asserting a literal `89...` cell id, or a fief-count that assumes res-9 granularity, must be updated. If a test calls `fiefIdForCoords(...)` and compares against a fixed string, recompute the expected value after Step 2.

- [ ] **Step 2: Change the constant**

In `packages/core/src/geo.ts`, replace lines 3–7:

```ts
// Resolution 7 (~1-2km edge) — the PRD target for full-city coverage.
// Fiefs are computed from H3, not stored, so this constant alone tunes
// fief granularity. (Was res-9 for the single-neighborhood demo seed.)
export const FIEF_RESOLUTION = 7;
```

- [ ] **Step 3: Run the core suite; fix fixtures**

Run: `cd packages/core && npx vitest run`
Expected: Any failure is a stale res-9 fixture. For each, recompute the expected cell id by running the same `latLngToCell(lat, lng, 7)` the code uses (or replace a brittle literal-cell assertion with a structural one, e.g. `expect(fiefIdForCoords(a) !== fiefIdForCoords(farAway))`). Re-run until green.

- [ ] **Step 4: Verify the web suite still passes**

Run: `cd apps/web && npx vitest run`
Expected: PASS. Selectors/standings compute fiefs via `fiefIdForCoords`, so they follow the constant; fix any res-9 literal the same way as Step 3.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/geo.ts packages/core/src/*.test.ts apps/web/src
git commit -m "feat(fief): re-tune H3 resolution res-9 -> res-7 (PRD target)"
```

---

## Task 4: Schema migration — `source` columns

**Files:**
- Modify: `apps/web/src/db/schema.ts` (the `thrones` table, ~line 67)

- [ ] **Step 1: Add the columns + partial unique index**

In `apps/web/src/db/schema.ts`, add `source` and `source_id` columns to the `thrones` table and convert it to the second-arg form for the index. Ensure `uniqueIndex` is imported from `drizzle-orm/pg-core` and `sql` from `drizzle-orm`.

```ts
export const thrones = pgTable(
  "thrones",
  {
    // ...existing columns unchanged...
    hiddenBy: uuid("hidden_by").references(() => users.id),
    source: text("source"),          // "refuge" | "osm"; NULL = user-added
    sourceId: text("source_id"),     // upstream record id
  },
  (t) => [
    uniqueIndex("thrones_source_unique")
      .on(t.source, t.sourceId)
      .where(sql`${t.source} is not null`),
  ]
);
```

- [ ] **Step 2: Generate the migration**

Run: `cd apps/web && npm run db:generate`
Expected: a new file under `apps/web/drizzle/` (e.g. `0007_*.sql`) adding two columns + the partial unique index. Open it and confirm it is `ADD COLUMN` (not a table rebuild) and includes `WHERE "source" is not null`.

- [ ] **Step 3: Apply to the TEST db (per project rule: migrate BOTH dbs)**

Run (uses `.env.test`): `cd apps/web && npx dotenv -e .env.test -- drizzle-kit migrate`
Expected: migration applied to the test Neon branch. (PROD migration is owner-run at cutover — do NOT apply to prod here.)

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/db/schema.ts apps/web/drizzle
git commit -m "feat(db): add source/source_id to thrones for idempotent seeding (migration 0007)"
```

---

## Task 5: City bbox lookup + arg parsing (pure, testable)

**Files:**
- Create: `apps/web/src/db/cityBbox.ts`
- Test: `apps/web/src/db/cityBbox.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/db/cityBbox.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/db/cityBbox.test.ts`
Expected: FAIL — cannot resolve `./cityBbox`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/web/src/db/cityBbox.ts
import type { ThroneSource } from "@sot/core";

// bbox tuple = [south, west, north, east]
export type Bbox = [number, number, number, number];

export const CITY_BBOX: Record<string, Bbox> = {
  // Small, dense cores — expand or add cities as needed.
  nyc: [40.700, -74.020, 40.788, -73.940],      // Manhattan (lower/mid)
  chicago: [41.850, -87.660, 41.920, -87.600],  // Loop + near north
  austin: [30.240, -97.760, 30.300, -97.720],   // Downtown
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
  throw new Error("provide --city <name> or --bbox 's,w,n,e'");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/db/cityBbox.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/db/cityBbox.ts apps/web/src/db/cityBbox.test.ts
git commit -m "feat(seeding): city->bbox lookup + seed CLI arg parser"
```

---

## Task 6: `seedCity.ts` fetch + upsert script (I/O glue)

**Files:**
- Create: `apps/web/src/db/seedCity.ts`

This is I/O glue verified via the manual `--dry-run` gate, not a unit test. It reuses the pure functions from Tasks 1, 2, 5. Follow the exact dotenv + deferred-import pattern from `seed.ts`.

- [ ] **Step 1: Write the script**

```ts
// apps/web/src/db/seedCity.ts
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import type { Bbox } from "./cityBbox";

const SYSTEM_GOOGLE_SUBJECT = "source:system";

async function fetchRefuge(bbox: Bbox) {
  const [s, w, n, e] = bbox;
  const results: unknown[] = [];
  // Refuge has no bbox endpoint; query by the bbox center, then filter to the
  // bbox. Paginated (per_page max 100). Stop when a page returns nothing.
  const lat = (s + n) / 2, lng = (w + e) / 2;
  for (let page = 1; page <= 20; page++) {
    const url = `https://www.refugerestrooms.org/api/v1/restrooms/by_location?lat=${lat}&lng=${lng}&per_page=100&page=${page}`;
    const res = await fetch(url, { headers: { "User-Agent": "shame-of-thrones-seed" } });
    if (!res.ok) throw new Error(`Refuge ${res.status}`);
    const batch = (await res.json()) as Array<{ latitude: string; longitude: string }>;
    if (batch.length === 0) break;
    for (const r of batch) {
      const rl = Number(r.latitude), rg = Number(r.longitude);
      if (rl >= s && rl <= n && rg >= w && rg <= e) results.push(r);
    }
  }
  return results;
}

async function fetchOsm(bbox: Bbox) {
  const [s, w, n, e] = bbox;
  const q = `[out:json][timeout:60];node["amenity"="toilets"](${s},${w},${n},${e});out;`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST", body: `data=${encodeURIComponent(q)}`,
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "shame-of-thrones-seed" },
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const json = (await res.json()) as { elements: unknown[] };
  return json.elements;
}

async function main() {
  const { db, pool } = await import("./client");
  const { thrones, users } = await import("./schema");
  const { eq } = await import("drizzle-orm");
  const {
    normalizeRefuge, normalizeOsm, dedupeCrossSource, isDuplicate,
    type SeededThrone, type RefugeRaw, type OsmNode,
  } = await import("@sot/core");
  const { parseSeedArgs, resolveBbox } = await import("./cityBbox");

  const opts = parseSeedArgs(process.argv.slice(2));
  const bbox = resolveBbox(opts);

  // 1. Fetch
  const raw: SeededThrone[] = [];
  if (opts.sources.includes("refuge")) {
    const rf = (await fetchRefuge(bbox)) as RefugeRaw[];
    raw.push(...rf.map(normalizeRefuge));
    console.log(`refuge: ${rf.length} in bbox`);
  }
  if (opts.sources.includes("osm")) {
    const os = (await fetchOsm(bbox)) as OsmNode[];
    raw.push(...os.map(normalizeOsm));
    console.log(`osm: ${os.length} nodes`);
  }

  // 2. Cross-source dedup
  const deduped = dedupeCrossSource(raw.filter((t) => Number.isFinite(t.lat) && Number.isFinite(t.lng)));
  console.log(`after cross-source dedup: ${deduped.length}`);

  // 3. Dedup against existing DB thrones
  const existing = await db.select({ lat: thrones.lat, lng: thrones.lng }).from(thrones);
  const fresh = deduped.filter((t) => !isDuplicate(t, existing));
  console.log(`would insert (new vs DB): ${fresh.length}`);

  if (opts.dryRun) {
    console.log("--dry-run: no DB writes.");
    await pool.end();
    return;
  }

  // 4. Ensure the system author user exists
  let [sys] = await db.select({ id: users.id }).from(users).where(eq(users.googleSubject, SYSTEM_GOOGLE_SUBJECT));
  if (!sys) {
    [sys] = await db.insert(users)
      .values({ googleSubject: SYSTEM_GOOGLE_SUBJECT, displayName: "Realm Cartographer", houseId: "flush" })
      .returning({ id: users.id });
  }

  // 5. Idempotent upsert keyed on (source, source_id)
  let count = 0;
  for (const t of fresh) {
    await db.insert(thrones).values({
      name: t.name, lat: t.lat, lng: t.lng, category: t.category, status: "verified",
      publicAccessAttested: true, amenities: t.amenities, addedBy: sys.id,
      source: t.source, sourceId: t.sourceId,
    })
      .onConflictDoUpdate({
        target: [thrones.source, thrones.sourceId],
        set: { name: t.name, category: t.category, amenities: t.amenities },
      });
    count++;
  }
  console.log(`done. upserted ${count} source-authored thrones.`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add the npm script**

In `apps/web/package.json` scripts, add:

```json
"seed:city": "tsx src/db/seedCity.ts",
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: clean. (If `onConflictDoUpdate` on a partial index complains, confirm the target columns match the index; the partial `WHERE` is enforced by Postgres — Drizzle only needs the column list.)

- [ ] **Step 4: Manual dry-run gate against a small bbox**

Run: `cd apps/web && npm run seed:city -- --bbox 30.26,-97.75,30.28,-97.73 --dry-run`
Expected: prints per-source counts, post-dedup counts, and "would insert" — **no DB writes**. Sanity-check the numbers are plausible (non-zero, not absurdly large).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/db/seedCity.ts apps/web/package.json
git commit -m "feat(seeding): seed:city CLI — fetch Refuge+OSM, dedup, idempotent upsert"
```

---

## Task 7: `seedReset.ts` guarded demo-wipe script (I/O glue)

**Files:**
- Create: `apps/web/src/db/seedReset.ts`

Owner-run, dry-run-by-default, `--yes` to execute. Deletes in FK-safe order inside one transaction.

- [ ] **Step 1: Confirm the child-table export names**

Run: `cd apps/web && grep -n "export const.*pgTable" src/db/schema.ts`
Confirm the exact exported identifiers for the tables referencing `thrones`/`ratings` (expected: `photos`, `reports`, `reviewQueue`, `influenceEvents`, `ratings`, `ledgerEntries`, `users`). Use those exact names in Step 2's imports. If any table has an FK child not listed, add its `delete` before its parent.

- [ ] **Step 2: Write the script**

```ts
// apps/web/src/db/seedReset.ts
import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  const { db, pool } = await import("./client");
  const {
    influenceEvents, ratings, photos, reports, reviewQueue, thrones, ledgerEntries, users,
  } = await import("./schema");
  const { like, count } = await import("drizzle-orm");

  const execute = process.argv.includes("--yes");

  // Count what we would delete (all pre-seed demo data).
  const [{ v: nThrones }] = await db.select({ v: count() }).from(thrones);
  const [{ v: nInfluence }] = await db.select({ v: count() }).from(influenceEvents);
  const [{ v: nRatings }] = await db.select({ v: count() }).from(ratings);
  const [{ v: nSeedUsers }] = await db.select({ v: count() }).from(users).where(like(users.googleSubject, "seed:%"));

  console.log("Demo-data reset would delete:");
  console.log(`  influence_events: ${nInfluence}`);
  console.log(`  ratings:          ${nRatings}`);
  console.log(`  thrones:          ${nThrones}`);
  console.log(`  seed:* users:     ${nSeedUsers}`);
  console.log("  + photos/reports/review_queue referencing the above, + all ledger_entries");
  console.log("  PRESERVES real Google users and the source:system user.");

  if (!execute) {
    console.log("\nDry-run (default). Re-run with --yes to execute.");
    await pool.end();
    return;
  }

  await db.transaction(async (tx) => {
    // FK-safe order: children first.
    await tx.delete(influenceEvents);
    await tx.delete(ratings);
    await tx.delete(reports);
    await tx.delete(reviewQueue);
    await tx.delete(photos);
    await tx.delete(thrones);
    await tx.delete(ledgerEntries);
    await tx.delete(users).where(like(users.googleSubject, "seed:%"));
  });
  console.log("\nDone. Demo data wiped.");
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Add the npm script**

In `apps/web/package.json` scripts, add:

```json
"seed:reset": "tsx src/db/seedReset.ts",
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Manual dry-run gate (against the TEST db)**

Run (safe — counts only, no `--yes`): `cd apps/web && npx dotenv -e .env.test -- tsx src/db/seedReset.ts`
Expected: prints the deletion summary and "Dry-run (default)". No writes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/db/seedReset.ts apps/web/package.json
git commit -m "feat(seeding): seed:reset CLI — guarded, dry-run-default demo wipe"
```

---

## Task 8: Green gate + integration verify

- [ ] **Step 1: Full core suite**

Run: `cd packages/core && npm run test`
Expected: PASS (existing 61 + seeding + dedup tests).

- [ ] **Step 2: Full web suite**

Run: `cd apps/web && npm run test`
Expected: PASS (existing 137 + cityBbox tests).

- [ ] **Step 3: Typecheck both**

Run: `cd packages/core && npx tsc --noEmit && cd ../../apps/web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Production build**

Run: `cd apps/web && npm run build`
Expected: `next build` succeeds.

- [ ] **Step 5: End-to-end dry-run against a real small bbox**

Run: `cd apps/web && npm run seed:city -- --city austin --dry-run`
Expected: real per-source counts from Refuge + Overpass, post-dedup and would-insert numbers. Confirms live API shapes match the normalize types. (If a source's JSON shape differs from the `RefugeRaw`/`OsmNode` interfaces, fix the interface + normalize and re-run Task 1's tests.)

- [ ] **Step 6: Commit any fixups; the feature is code-complete**

```bash
git add -A
git commit -m "test(seeding): green gate — core+web suites, tsc, build, live dry-run"
```

---

## Post-implementation (owner-run, NOT part of this plan's automated steps)

These run at the production cutover, by the owner (prod deletion + prod migration are owner-gated):

1. Merge to `main` + deploy (Vercel).
2. Owner applies migration 0007 to prod: `npm run db:migrate` (with prod env).
3. Owner runs `npm run seed:reset -- --yes` (wipes res-9 demo data).
4. Owner runs `npm run seed:city -- --city <chosen>` (or `--bbox …`) → real thrones; fiefs derived at res-7.
5. Verify `/api/health` still ok and thrones + res-7 fiefs render on the map.

---

## Self-Review notes (author)

- **Spec coverage:** schema §1 → Task 4; pipeline stages §2 (normalize/dedup/load) → Tasks 1, 2, 6; hex re-tune §3 → Task 3; wipe §3 → Task 7; CLI §4 → Tasks 5, 6, 7; testing → Tasks 1, 2, 5, 8. All sections covered.
- **Type consistency:** `SeededThrone`, `ThroneSource`, `RefugeRaw`, `OsmNode`, `Bbox`, `SeedOptions`, `DEDUP_RADIUS_M`, `dedupeCrossSource`, `isDuplicate`, `resolveBbox`, `parseSeedArgs` used consistently across Tasks 1/2/5/6.
- **Owner-gated safety:** prod migration + prod wipe + prod seed are all in the owner-run post-implementation section, never in an automated step. Test-db operations use `dotenv -e .env.test`.
