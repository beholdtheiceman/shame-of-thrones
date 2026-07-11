# Phase 0 — Multi-User Backend: Design Spec

**Date:** 2026-07-11
**Status:** Approved design, pre-implementation
**Scope:** ROADMAP.md Phase 0 (backend foundation), amended by the scoping decisions below.

## Goal

Turn the single-user, localStorage-backed prototype into a real multi-user app: two people
on different devices see the same Realm, the same scores, and the same territory. This is
the milestone; everything not required for it waits.

## Scoping decisions (locked)

| Decision | Choice |
|---|---|
| Milestone | Real multi-user app (ROADMAP Phase 0) |
| Infrastructure | Vercel (Next.js stays the app + backend) + Neon Postgres with PostGIS, via Drizzle ORM |
| Auth | Auth.js v5, Google provider only, JWT sessions. Apple sign-in deferred to native-mobile phase. Anonymous read-only browsing preserved ("Wandering Peasant"). |
| UGC scope | **Structured only.** Ratings (verdict + fixed-vocabulary tags), add-a-throne, confirm/deny. No free-text testimony, no photos — those arrive with the Phase 1 moderation pipeline. |
| Game engine | Postgres-only, full logic. No Redis. Decay computed at query time (no decay cron). Season rollover deferred; seasons stay cosmetic this phase. |
| Old demo | Vercel deployment replaces GitHub Pages. Pages workflow retired; README updated. localStorage demo data is not migrated. |

## Working model

Claude acts as senior engineer; implementation tasks are dispatched to Codex CLI
(GPT-5.6) subagents. Every task passes Claude's review gate before landing:
build + typecheck + tests pass, diff reviewed, and the affected flow exercised
against a running app. Codex writes the code; Claude is accountable for it.

## Architecture

Single Next.js app deployed to Vercel.

- **Backend:** route handlers under `src/app/api/*`. All game math — influence awards,
  decay, fief control, throne scores, ranks, badges — executes server-side only. The
  client is never trusted with game logic.
- **Database:** Neon Postgres with PostGIS, accessed via Drizzle ORM. Migrations via
  drizzle-kit.
- **Reference implementation:** `src/lib/selectors.ts` and `src/lib/store.tsx` contain
  the already-correct game math. Server code is a port of that logic; the originals stay
  in-tree as the parity reference until the port is verified, then client-side copies of
  server-owned logic are deleted.
- **Decay is a read-time computation** (`points * 0.98^daysSince`), exactly as the
  prototype does it. This eliminates the daily decay cron and its failure modes. The only
  future scheduled job is season rollover, which is out of scope this phase.

## Data model

Tables (Drizzle schema → Postgres):

- **users** — id (uuid), google_subject (unique), display_name, house_id,
  joined_at, last_house_switch_at, badges (jsonb array).
  Display name is chosen at onboarding and is deliberately independent of the Google
  account name.
- **thrones** — id, name, location `geography(Point, 4326)`, category (enum, no
  "residence" option), status (`rumored` | `verified`), amenities (jsonb),
  added_by → users.id, added_at, last_confirmed_at.
- **ratings** — id, throne_id → thrones.id, user_id → users.id, verdict (1–5),
  tags (text[], validated server-side against the fixed vocabulary), verified (bool,
  proximity-passed vs. hearsay), created_at. **No testimony column** this phase.
- **influence_events** — append-only ledger: id, fief_id (H3 index), house_id,
  user_id, points, reason (`rating` | `first_of_name` | `new_throne` | `confirmation` |
  `hearsay`), throne_id, created_at. No UPDATE or DELETE, ever — territory state is
  derived and replayable (PRD §7).
- **ledger_entries** — global realm event feed: id, created_at, text.

Integrity rules enforced server-side (impossible in the prototype):

1. Confirming a Rumored throne requires a **different user** than the one who added it
   (closes README gap #2 / ROADMAP Phase 1 item, cheap to do now).
2. One rating per user per throne per 24 h; a repeat within the window updates rather
   than stacks (PRD §5.4).
3. House switching allowed at most once per 56 days (rolling window standing in for
   the PRD's 8-week season until real seasons exist; PRD §5.1).
4. Tag values validated against the fixed vocabulary; unknown tags rejected.

## API surface

REST-ish JSON under `/api`. Reads public, writes require a session (401 → client shows
the pledge/onboarding flow).

| Method & path | Purpose |
|---|---|
| `GET /api/realm` | Everything the map needs in one payload: thrones with computed scores, fief control shares, recent ledger entries. |
| `POST /api/ratings` | Submit a Sitting. Server computes influence, first-of-their-name bonus, badge grants, fief flips, and ledger entries atomically. |
| `POST /api/thrones` | Add-a-throne → enters `rumored`. |
| `POST /api/thrones/:id/confirm` | Second-user confirmation → `verified`, +25 influence. |
| `GET /api/me` | Current profile, rank, badges. |
| `POST /api/profile` | Create profile (name + house pledge) or switch house (once per 56-day window). |

## Auth flow

Auth.js v5, Google OAuth, JWT session strategy (no session table). First sign-in creates
no profile row; the client onboarding flow (existing `Onboarding.tsx`) collects display
name + house and calls `POST /api/profile`. Anonymous users get the full read experience.

## Client changes

- `src/lib/store.tsx` keeps its exact public interface (`useStore()`, `submitRating`,
  `addThrone`, `confirmThrone`, `setProfile`, `switchHouse`) but the reducer becomes an
  API client + refetch layer. Components remain largely untouched.
- Optimistic updates on the rating flow so the influence animation stays instant;
  reconciled against the server response (server wins).
- Realm data refreshes on window focus plus a ~30 s poll. No websockets this phase.
- The rating flow UI drops the testimony textarea for now (structured-only decision).

## Seeding & deployment

- `src/lib/data.ts` seed content becomes a Drizzle seed script run against dev/prod DBs.
- `next.config.ts` drops `output: "export"`; the GitHub Pages deploy workflow is deleted
  and the README's live-URL section points at the Vercel deployment.
- Env vars via Vercel (`DATABASE_URL`, `AUTH_SECRET`, Google OAuth credentials);
  `.env.example` documents them.

## Testing & verification

- **Parity tests:** the ported server-side game math is unit-tested against
  `selectors.ts` outputs — same inputs must produce the same numbers, so the port cannot
  silently drift from the prototype's proven behavior.
- **Integration tests:** API routes tested against a real Postgres (local or a Neon
  branch), covering the integrity rules above (second-user confirm, 24 h rating window,
  tag validation, 401s for anonymous writes).
- **Review gate per task:** build + typecheck + tests, diff review, and manual exercise
  of the affected flow in a running app.

## Out of scope (explicitly)

Free-text reviews, photos, moderation tooling, Redis, season rollover job, notifications,
leaderboards beyond what the prototype shows, mobile packaging, Mapbox migration,
proximity anti-spoof heuristics beyond the existing verified/hearsay flag, and data
seeding from external datasets (Refuge/OSM). Each has its ROADMAP phase.
