# Phase 5 · Sub-project A — Real-data seeding pipeline + hex re-tune (DRAFT design)

**Date:** 2026-07-15
**Status:** DRAFT — brainstorm started, paused on session cost before completion.
Two foundational decisions locked; remaining decisions have proposed defaults to
confirm next session. **Do not implement until this is finalized + approved.**

This is the first buildable sub-project of ROADMAP "Phase 5 — Data seeding & launch
ops": turn the empty gray map into a real one for a launch city, and land the deferred
H3 res-9 → res-7 fief re-tune at the same time (both shape fief data — do them together
to avoid migrating fiefs twice).

## Locked decisions (this session)
- **City-agnostic pipeline** — parameterized by city / bounding box; run per-city on
  demand, pick a first city to actually run it on.
- **Data sources: Refuge Restrooms API + OpenStreetMap `amenity=toilets` (Overpass)**,
  with cross-source dedup. Refuge is purpose-built (accessibility/gender-neutral flags);
  OSM adds coverage.

## Proposed architecture (to confirm)
A CLI seed pipeline (not an API endpoint), staged:
1. **Fetch** — query Refuge Restrooms API + OSM Overpass by the target bounding box.
2. **Normalize** — map each source's records to a common throne shape (name, lat/lng,
   venue category, accessibility flags, `source` + `sourceId`).
3. **Dedup** — merge records within ~25m (same physical restroom across sources; prefer
   Refuge metadata, OSM fallback); also dedup against existing DB thrones.
4. **Derive fiefs** — compute H3 **res-7** cells covering all seeded thrones; create fief
   rows (this IS the re-tune).
5. **Load** — idempotent upsert keyed by `source+sourceId` (or a stable location hash) so
   re-runs don't duplicate.

## Hex re-tune (res-9 → res-7)
Change the H3 resolution constant for fiefs from 9 to 7. Existing prod fiefs are res-9
(phase-0 demo seed). Re-derive all fiefs at res-7 from throne locations. The influence
ledger is append-only and tied to thrones (fief membership is computed via H3), so
re-deriving fiefs recomputes membership — but existing demo influence/fiefs must be
reconciled or wiped (see open decisions).

## Open decisions (proposed defaults — confirm next session)
- **Seeded throne verification status** — seed as pre-"Confirmed" with a `seeded`/`source`
  flag and no initial rating (appear as real-but-unrated), vs "Rumored" needing user
  confirmation. *Proposed: pre-Confirmed + seeded flag.*
- **Existing phase-0 demo data** — wipe demo thrones/fiefs/influence before loading real
  data (clean beta) vs keep alongside. *Proposed: wipe demo data before seeding.*
  ⚠️ Prod data deletion — owner-gated.
- **Hex resolution** — res-7 fixed (PRD target) vs density-adaptive (PRD open Q2).
  *Proposed: res-7 fixed (YAGNI on adaptive for now).*
- **Run surface** — a CLI script (`npm run seed:city -- --city … | --bbox …`), run
  manually per city. *Proposed: yes, CLI.*

## Testing
- Unit tests for normalize + dedup (fixture records from both sources).
- `--dry-run` (fetch + normalize + dedup, print counts, no DB write).
- First run against a small bbox; verify throne/fief counts + on-map render before a full-city run.

## Out of scope (later Phase 5 sub-projects)
Closed-beta invite/cohort system, success-metrics instrumentation, launch-city choice
(product), trademark clearance (legal, blocks public beta). See ROADMAP Phase 5.

## Next steps
1. Confirm the 4 open decisions + pick the first launch city.
2. Finalize this spec → writing-plans → implement (fresh session recommended; the build
   is a real chunk of work).
