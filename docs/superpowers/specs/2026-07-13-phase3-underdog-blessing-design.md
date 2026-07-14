# Phase 3 · Cycle C — Underdog Blessing (design)

**Date:** 2026-07-13
**Status:** approved, pre-implementation
**Roadmap:** Phase 3 (retention systems), item *Underdog Blessing balance mechanic*.

## Context

Phase 3 Cycles A (Standings) and B (Recognition) shipped 2026-07-13. Cycle C in
the roadmap bundles *Underdog Blessing* + *Notifications*. **Notifications is
split out into its own dedicated session** — it needs real push-delivery
infrastructure (web-push/VAPID, subscription storage, send path, opt-in
categories, rate limiting), the heaviest single item in Phase 3. This spec
covers **Underdog Blessing only**.

## Decision

A House trailing in the Realm earns a temporary Influence multiplier, applied at
award time and shown transparently (PRD §5.6). It is a self-correcting
rubber-band: earning more raises the House's share until it crosses back above
the threshold and the blessing lifts. No hysteresis in v1 (the oscillation is
mild and self-limiting; revisit if beta shows thrash).

## Behaviour

### The rule (server-enforced, pure)

- Config in `src/lib/game/rules.ts`:
  `UNDERDOG = { shareThreshold: 0.15, multiplier: 1.25 }`.
- A House whose **current Realm influence share < 0.15** earns **×1.25** on
  Influence; at or above the threshold, ×1. (Even share across 4 Houses is 0.25,
  so 0.15 is "clearly trailing.")
- `underdogMultiplier(share: number): number` → `multiplier` if
  `share < shareThreshold`, else `1`.

### Where it applies

- **Rating Influence only** this cycle: the `base` (verified/hearsay) and the
  `first_of_name` bonus in `src/lib/server/ratings.ts`.
- **Deferred:** confirmation awards in `src/lib/server/thrones.ts`
  (adder +25 / confirmer +3). Occasional, smaller volume; a clean follow-up.

### Composition with the new-account ramp

The blessing multiplies the **already-ramped** points, then rounds up:
`final = Math.ceil(rampedPoints(basePoints, age) * underdogMultiplier(share))`.
Multiplicative, so order relative to the ramp does not change the product;
`Math.ceil` keeps points integer and never zero, matching `rampedPoints`.

### Realm share at award time

The awarding House's share is its **current decayed Realm influence** (the same
`0.98^days` decay as the map and House Standings) divided by total Realm
influence, computed from all influence events that exist **before** this rating's
events are inserted.

To avoid the per-fief work `houseStandings` does (fiefs-led), factor a lean
helper `realmHouseShares(events, now): Map<HouseId, number>` in
`src/lib/standings.ts` returning each House's share. `houseStandings` is
refactored to use it (single source of truth); the award path uses it directly.

### Transparency (PRD requires it)

- `HouseStandingRow` (from `houseStandings`) gains **`blessed: boolean`**
  (`share < shareThreshold`). The Standings tab's House Standings shows a
  **"Blessed ×1.25"** tag on blessed Houses.
- `submitRating`'s return gains **`blessed: boolean`** (whether this rating's
  House was blessed at award time) so the client can note "Underdog Blessing
  applied (+25%)" in the rating feedback.

## Architecture

Read-mostly; one new query in the rating award path, no schema migration.

### Units

- **`src/lib/game/rules.ts`** *(modify)* — add `UNDERDOG` + `underdogMultiplier`.
- **`src/lib/standings.ts`** *(modify)* — add `realmHouseShares`; refactor
  `houseStandings` to use it; add `blessed` to `HouseStandingRow` (via
  `underdogMultiplier`/`UNDERDOG.shareThreshold`).
- **`src/lib/server/ratings.ts`** *(modify)* — load realm-wide influence events,
  compute the awarding House's share via `realmHouseShares`, apply
  `underdogMultiplier` to `base` and `firstBonus`; return `blessed`.
- **`src/lib/api.ts`** *(modify)* — `submitRating` result type gains `blessed`;
  `HouseStandingRow` already flows through `StandingsDTO` (via `standings.ts`),
  so `blessed` rides along.
- **`src/components/Standings.tsx`** *(modify)* — render the "Blessed ×1.25" tag
  on blessed House rows.
- **Rating feedback** *(modify — the component that shows the submit result)* —
  surface "Underdog Blessing applied" when `blessed`.
- **`src/lib/copy.tsx`** *(modify)* — plain-speech for the blessing label.

## Testing

- `underdogMultiplier`: `0.149 → 1.25`, `0.15 → 1`, `0.30 → 1`.
- `realmHouseShares`: shares sum to 1 (or all 0 on empty); decay respected.
- `houseStandings`: `blessed` true for a sub-threshold House, false otherwise.
- Integration (`src/test/ratings.test.ts`, real DB): seed the Realm so the
  awarding user's House is below 15% → a verified rating yields
  `ceil(10 × 1.25) = 13` and `blessed: true`; seed so the House is a leader →
  `10` and `blessed: false`.

## Out of scope (this cycle)

- Notifications (its own session).
- Blessing on confirmation awards (`thrones.ts`) — deferred.
- Hysteresis / anti-thrash tuning.
- Season soft-reset interactions.
