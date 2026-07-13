# Phase 3 · Cycle B — Recognition (design)

**Date:** 2026-07-13
**Status:** approved, pre-implementation
**Roadmap:** Phase 3 (retention systems), items *Titles & badges* and *Streaks*.

## Context

Phase 3 Cycle A (Standings) shipped 2026-07-13. Cycle B is Recognition:
reward the individual for behaviour over time. Cycle C (Underdog Blessing +
notifications) remains.

Existing infrastructure:
- `users.badges` — a jsonb `string[]`, default `[]`.
- `BadgeId = "first_of_their_name" | "cartographer"` (`src/lib/types.ts`).
- Award logic is **scattered and imperative**: `first_of_their_name` is written
  in `src/lib/server/ratings.ts` on a user's first verified rating;
  `cartographer` in `src/lib/server/thrones.ts` on first throne added.
- Display: `ProfilePanel.tsx` maps `BadgeId → {icon,title,desc}` via `BADGE_META`
  and renders `profile.badges`.
- **No streak infrastructure. No currency system.**

## Decisions locked in brainstorming

### D1 — Badges become computed-on-read (retire the imperative writes)

A single pure selector derives all badges from the user's data on profile read,
replacing the scattered imperative `users.badges` writes.

**Why:** adding more badges the imperative way multiplies scattered write sites,
needs a per-user backfill for existing accounts, and risks award races.
Computing on read unifies the logic in one testable place, auto-backfills every
existing user, and needs no migration. Night's Watch and Oathkeeper are
naturally computed anyway.

The `users.badges` column is **kept** (no migration) but is **no longer the
source of truth**; the imperative writes in `ratings.ts` and `thrones.ts` are
removed (their Influence logic is untouched).

### D2 — Badge scope: add Night's Watch + Oathkeeper; defer Breaker of Chains

Ship four badges total:
- `first_of_their_name` — ≥1 verified rating (ever)
- `cartographer` — ≥1 throne added (ever)
- `nights_watch` — any rating created with **UTC hour in [0,5)**
- `oathkeeper` — current streak ≥ **4** weeks

**Defer Breaker of Chains** ("reported a throne requiring purchase that actually
doesn't"): it needs a validated moderation-outcome signal that does not exist.
Building it is its own mini-feature touching the moderation pipeline.

### D3 — Streaks: track + display; defer protection

- **Definition:** consecutive **Mon 00:00 UTC weeks** (reusing `weekWindow` from
  `standings.ts`) with **≥1 verified rating**. Verified ratings are the
  core-loop contribution and keep the signal computable from one source.
- **Defer streak protection.** The PRD's protection is purchasable with *earned
  currency*, and no currency economy exists. Revisit when one lands.

## Detailed behaviour

### Streak (`currentStreak`)

`currentStreak(ratings, now) → { weeks: number; thisWeekActive: boolean }`

- A week is "active" for a user if they have ≥1 rating with `verified === true`
  whose `createdAt` falls in that Mon-00:00-UTC week.
- `thisWeekActive` = whether the current week is active.
- `weeks` = the length of the run of consecutive active weeks ending at the
  current week if it is active, otherwise ending at last week. If neither the
  current nor the previous week is active, `weeks = 0`.
  - Example: active this week + the 3 weeks before → `weeks = 4`,
    `thisWeekActive = true`.
  - Example: inactive this week but active the previous 2 weeks → `weeks = 2`,
    `thisWeekActive = false` (streak alive but "at risk").
  - Example: inactive this week and last week → `weeks = 0`.

### Badges (`earnedBadges`)

`earnedBadges({ ratings, thronesAdded, streakWeeks, now }) → BadgeId[]`

- `first_of_their_name` if any rating is `verified`.
- `cartographer` if `thronesAdded > 0`.
- `nights_watch` if any rating has `new Date(r.createdAt).getUTCHours() < 5`.
- `oathkeeper` if `streakWeeks >= OATHKEEPER_WEEKS` (= 4).
- Returned in a stable, defined order.

`ratings` here are the calling user's own ratings; `thronesAdded` is the count
of thrones that user added (visible or not — authorship, not visibility).

### Server (mePayload)

`src/lib/server/profile.ts` `mePayload(userId)` currently returns
`badges: user.badges`. It changes to:
- load the user's ratings and their thrones-added count,
- compute `streak = currentStreak(ratings, now)` and
  `badges = earnedBadges({ ratings, thronesAdded, streakWeeks: streak.weeks, now })`,
- return the computed `badges` plus `streak`.

### Client / display

- `BadgeId` gains `"nights_watch" | "oathkeeper"`.
- `MeDTO` (`src/lib/api.ts`): `badges` is the computed list; add
  `streak: { weeks: number; thisWeekActive: boolean }`.
- `ProfilePanel.tsx`: extend `BADGE_META` with the two new badges (themed
  icon/title/desc); add a streak indicator — e.g. "🔥 {weeks}-week streak", and
  when `weeks > 0 && !thisWeekActive` an "at risk — rate this week to keep it"
  hint; when `weeks === 0`, a gentle prompt or nothing.
- Plain-speech (`copy.tsx`): badge titles stay **themed** (game identity, per the
  Phase 2 rule); only functional streak wording gets a plain form (e.g. the
  "at risk" hint).

## Architecture

Read-only derivation; no schema migration, no writes beyond removing the two
existing badge writes.

### Units

- **`src/lib/recognition.ts`** *(new, pure)* — `OATHKEEPER_WEEKS`,
  `currentStreak`, `earnedBadges`. Imports `weekWindow` from `./standings`
  (reuse). No DB, no React.
- **`src/lib/recognition.test.ts`** *(new)* — Vitest units.
- **`src/lib/server/profile.ts`** *(modify)* — compute badges + streak in
  `mePayload`.
- **`src/lib/server/ratings.ts`** *(modify)* — remove the `first_of_their_name`
  badge write (keep the `first_of_name` Influence event + bonus).
- **`src/lib/server/thrones.ts`** *(modify)* — remove the `cartographer` badge
  write (keep any Influence logic).
- **`src/lib/types.ts`** *(modify)* — extend `BadgeId`.
- **`src/lib/api.ts`** *(modify)* — `MeDTO.streak`.
- **`src/components/ProfilePanel.tsx`** *(modify)* — new badges + streak line.
- **`src/lib/copy.tsx`** *(modify)* — plain-speech for streak wording.
- **`src/test/ratings.test.ts`, `src/test/thrones.test.ts`** *(modify)* — assert
  the now-computed badges via `mePayload` rather than the stored column.

## Testing

- `recognition.test.ts`: streak length over consecutive/broken weeks; this-week
  active vs. at-risk vs. zero; Oathkeeper threshold at exactly 4; Night's Watch
  UTC hour boundary (04:59 in, 05:00 out); first-rating requires `verified`;
  cartographer on `thronesAdded > 0`; empty input → `weeks 0`, `[]`.
- Update the two server tests to the computed model.
- Full `npm run test` green against the real DB; `npm run build` clean.
- Live: a signed-in profile shows the correct badges + streak line.

## Out of scope (this cycle)

- Breaker of Chains badge (needs a moderation-outcome signal).
- Streak protection / any earned-currency economy.
- Titles beyond the badge set / rank track (rank ladder already exists).
- Notifications, Underdog Blessing (Cycle C).
- Per-week backfill or migration of `users.badges` (column retained, ignored).
