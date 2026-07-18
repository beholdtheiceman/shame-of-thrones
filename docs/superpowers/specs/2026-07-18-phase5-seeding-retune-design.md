# Phase 5 · Sub-project A — Real-data seeding pipeline + hex re-tune (FINAL)

**Date:** 2026-07-18
**Status:** FINAL — approved. Supersedes the 2026-07-15 DRAFT. Ready for
writing-plans → implementation.

First buildable sub-project of ROADMAP "Phase 5 — Data seeding & launch ops":
turn the empty gray map into a real one for a launch city, and land the deferred
H3 res-9 → res-7 fief re-tune at the same time (both reshape fief data — do them
together to migrate fiefs once).

## Approved decisions
- **City-agnostic pipeline**, parameterized by city / bounding box. Build + test
  it city-agnostic now; pick the first city at run time (deferred — product call).
- **Sources: Refuge Restrooms API + OpenStreetMap `amenity=toilets` (Overpass)**,
  with cross-source dedup. Refuge is purpose-built (accessibility/gender-neutral
  flags); OSM adds coverage.
- **Seeded thrones = pre-Confirmed** — `status='verified'`, a `source` flag, no
  initial rating. Appear as real-but-unrated day one.
- **Wipe Phase-0 demo data before seeding** — clean beta. Owner-gated prod
  deletion, run by the owner via a guarded reset script.
- **Hex resolution: res-7 fixed** (PRD target; YAGNI on density-adaptive). Closes
  PRD open Q2 as "fixed for now."
- **Run surface: CLI scripts** (`seed:reset`, `seed:city`), run manually per city.

## Key grounding facts (from the codebase)
- **There is no `fiefs` table.** Fiefs are computed from H3; the only stored trace
  of fief identity is `influence_events.fief_id` (a text H3 cell). So the re-tune
  is a one-line constant change, and wiping demo data removes all res-9
  `influence_events` — **no res-9/res-7 reconciliation is needed.**
- `thrones.added_by` is `NOT NULL` (FK to `users`) and there are **no `source`
  columns** today. Seeding needs a small migration + a synthetic system user.
- `throneStatusEnum` = `rumored | verified`; "pre-Confirmed" maps to `verified`.
- `throneCategoryEnum` = `cafe | restaurant | park | transit | library | retail |
  municipal | gas_station | other`.
- `thrones.amenities` jsonb shape = `{ accessible, babyChanging, genderNeutral,
  freeAccess, open24h }` (all booleans, all required).
- `packages/core/src/geo.ts` exports `FIEF_RESOLUTION = 9`, `fiefIdForCoords`,
  `fiefBoundary`, `fiefCenter`, `haversineMeters`.
- Existing `apps/web/src/db/seed.ts` runs via `tsx` with a dotenv +
  deferred-import pattern (loads `.env.local`/`.env` before `db/client` reads
  `DATABASE_URL`). New scripts follow the same pattern.

## 1. Schema changes (one migration)
Add to `thrones`:
- `source` (text, nullable) — `"refuge" | "osm"`. **Presence IS the seeded flag**;
  user-added thrones keep `source = NULL`.
- `source_id` (text, nullable) — upstream record id, for idempotent re-runs.
- Partial unique index on `(source, source_id)` `WHERE source IS NOT NULL` — so
  re-runs / overlapping bboxes upsert instead of duplicating.

Seeded thrones are inserted with `status='verified'`,
`public_access_attested=true`, and `added_by =` a synthetic **system user**
(`googleSubject: 'source:system'`, `displayName: 'Realm Cartographer'`, some
house; created once, mirroring the existing `seed:` users). No ratings and no
influence events are created for seeded thrones — they render as real-but-unrated.

Rationale for system-user-as-author (vs. making `added_by` nullable): keeps the
`NOT NULL` FK and every downstream join/`addedBy` lookup intact.

## 2. Pipeline stages
CLI script `apps/web/src/db/seedCity.ts` (run via `tsx`). The two stages with real
logic — **normalize** and **dedup** — live in `@sot/core` as pure functions so
they unit-test without network or DB.

**Fetch** (in the script — I/O):
- Refuge Restrooms API: `GET /api/v1/restrooms/by_location` (lat/lng + radius) or
  the bounding-box search, paginated over the target area.
- OSM Overpass: `[out:json]; node["amenity"="toilets"](S,W,N,E); out;`.

**Normalize** (`@sot/core`, pure) — each raw record → common `SeededThrone`:
```ts
{ name: string; lat: number; lng: number;
  category: ThroneCategory; amenities: Amenities;
  source: "refuge" | "osm"; sourceId: string }
```
- **category** → existing enum; unknown → `other`. Refuge carries no venue type →
  `other`. OSM maps from tags where possible (e.g. node inside/tagged park/transit),
  else `other`.
- **amenities** → existing jsonb shape, defaulting missing flags to `false`:
  - Refuge: `accessible`→`accessible`, `unisex`→`genderNeutral`,
    `changing_table`→`babyChanging`. (`freeAccess`/`open24h` unknown → `false`.)
  - OSM: `wheelchair=yes`→`accessible`, `changing_table=yes`→`babyChanging`,
    `unisex=yes`/`gender=*`→`genderNeutral`, `fee=no`→`freeAccess`,
    `opening_hours=24/7`→`open24h`.
- **name**: Refuge `name`; OSM `tags.name` else a synthesized label
  (e.g. "Public restroom").

**Dedup** (`@sot/core` pure helpers, using existing `haversineMeters`):
- `DEDUP_RADIUS_M = 25` (named constant, tunable after eyeballing a real city).
- **Cross-source**: records within `DEDUP_RADIUS_M` are the same physical restroom
  → merge, preferring Refuge metadata, OSM as fallback.
- **Against existing DB**: `isDuplicate(candidate, existing[])` skips any candidate
  within `DEDUP_RADIUS_M` of a throne already in the DB. The DB read happens in the
  script; the comparison is the pure helper.

**Load**: idempotent upsert keyed on `(source, source_id)` — insert new, update the
lightweight fields (name/category/amenities) on conflict. Never touches ratings or
influence.

## 3. Hex re-tune + wipe
**Re-tune** — one line: `FIEF_RESOLUTION = 9 → 7` in `geo.ts`, and rewrite the
comment (the "9 for demo density" rationale is retired; res-7 ≈ 1–2km edge, PRD
target). Nothing else in code changes — fiefs are computed. Update any
characterization/selector test fixtures that hardcode res-9 cell IDs.

**Wipe** — a guarded reset the owner runs (owner-gated prod deletion):
- `npm run seed:reset -- [--yes]`, `apps/web/src/db/seedReset.ts`.
- Dry-run by default: prints a count summary of what it would delete. `--yes`
  executes, in one transaction, in FK-safe order:
  `influence_events` → `ratings` → `photos` → any `reports`/`review_queue` rows
  referencing them → `thrones` → the `seed:*` demo users. `ledger_entries` cleared.
- **Preserves** real Google-authed users and the `source:system` user.

**Owner-driven cutover sequence:**
1. Merge code (migration + res-7 + pipeline) → deploy.
2. Apply migration (adds `source` columns).
3. Owner runs `seed:reset --yes` (removes res-9 demo thrones/fiefs/influence).
4. Owner runs `seed:city --city … | --bbox …` → real thrones; fiefs now derived at
   res-7. Demo influence is already gone, so no res-9/res-7 mixing.

## 4. CLI surface
Two scripts in `apps/web/package.json`, both using the `seed.ts` dotenv +
deferred-import pattern:
- `seed:reset -- [--yes]` — Section 3 guarded wipe.
- `seed:city -- --city <name> | --bbox <s,w,n,e> [--dry-run] [--source refuge,osm]`
  - `--city` → bbox via a small built-in lookup (NYC/Chicago/Austin …).
  - `--bbox` → any area (escape hatch).
  - `--dry-run` → fetch + normalize + dedup, print counts (fetched per source,
    after cross-source dedup, after DB dedup, would-insert), **no DB writes**.
  - `--source` → limit to a subset of sources (default both).

## Testing
- **Unit (`@sot/core`, pure):** `normalize` for both sources from fixture raw
  records (Refuge JSON + Overpass JSON), covering category/amenity mapping and
  missing-field defaults; `dedup` cross-source merge (Refuge-preferred) and
  `isDuplicate`, with fixtures straddling the 25m boundary.
- **Manual gate before a full-city run:** `--dry-run` on a small bbox →
  sanity-check counts → tiny live run → verify thrones + res-7 fiefs render on the
  map → full city.
- **Green gate:** apps/web vitest + @sot/core suites pass (fix any res-9 fixtures);
  tsc clean; `next build` ok.

## Out of scope (later Phase 5 sub-projects)
Closed-beta invite/cohort system, success-metrics instrumentation, launch-city
product choice, trademark clearance (legal, blocks public beta). See ROADMAP
Phase 5.
