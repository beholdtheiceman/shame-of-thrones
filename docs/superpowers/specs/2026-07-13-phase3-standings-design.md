# Phase 3 · Cycle A — Standings (design)

**Date:** 2026-07-13
**Status:** approved, pre-implementation
**Roadmap:** Phase 3 (retention systems), items *Leaderboards* and *Individual rank decay*.

## Context

Phase 2 is complete and deployed. Phase 3 ("retention systems," P1 per PRD §5.7)
is six subsystems; it decomposes into three cycles that mirror Phase 2's rhythm
of one focused cycle per session:

- **Cycle A — Standings:** leaderboards + individual rank decay *(this spec)*
- **Cycle B — Recognition:** titles & badges + streaks
- **Cycle C — Balance & re-engagement:** Underdog Blessing + notifications

Cycle A is first because it is pure computation over the existing influence
ledger — no schema change, no new infrastructure — it is immediately visible to
users, and it forces the rank-decay decision early (that decision colours every
other reputation surface).

## Decisions locked in brainstorming

### D1 — Individual rank stays lifetime and undecayed (resolves README gap #6)

`lifetimeXp` continues to sum a user's influence points without time decay. Rank
only ever climbs.

**Why:** the PRD (§5.7) already draws the line — ranks derive from *"lifetime*
quality-weighted contribution," while **Influence** is the currency that decays
2%/day. Influence = territory you must hold; **rank = permanent reputation you
earned.** Decaying both would make everything feel like sand slipping away.
Rank-loss (watching "Warden" demote to "Lord" after a break) is a known
retention killer, and this cycle exists *for* retention. Territory decay already
supplies the ongoing-contribution pressure, so a second decay mechanism is
unnecessary. Gap #6 is therefore resolved as a **deliberate "no decay,"**
documented — the same pattern Phase 0 used for the daily-decay-tick and Redis.

### D2 — Quality-weighting via reversal netting only; helpful-vote weighting deferred

The PRD wants rank *quality-weighted* ("helpful votes and confirmed accuracy
matter, not just volume"). True helpful-vote weighting needs a voting mechanism
that does not exist and is separately listed as its own P1 item
("helpful-vote weighting UI"). It stays **out of Cycle A**.

Rank and boards are made quality-*aware* for free: moderator takedowns already
append negative-point **reversal** events to the ledger, so summing a user's
events nets out reversed/moderated contributions with no extra code.

### D3 — Ship two surfaces on a new "Standings" tab

The PRD's per-Fief × per-Realm × per-House × weekly × seasonal matrix is too
broad for one cycle. Cycle A ships the slice carrying the retention weight:

1. **The Small Council** — individual contributor board, realm-wide, with a
   Week / Season / All-Time toggle and an All-Houses / My-House filter. The
   weekly view is the newcomer-winnable timeframe the PRD calls out; All-Time is
   the prestige board tied to the rank ladder; the My-House filter yields the
   per-House individual board for free.
2. **House Standings** — the four Houses ranked by current realm-wide Influence.
   The team board; per the PRD, House identity is the #1 retention driver.

**Deferred:** per-Fief *individual* boards. The FiefCard already shows per-fief
House shares; individual-per-fief rivalry is niche and multiplies UI surface for
the least payoff. Revisit if beta shows local rivalry matters.

### D4 — Navigation: a new "Standings" tab (chosen over extending "Ranks")

A 4th bottom tab (Realm · Ledger · Ranks · Standings). "Ranks" stays about
*you* (your `ProfilePanel`); "Standings" is about *everyone*. More discoverable
and each surface stays focused; four tabs is well within normal for a bottom bar.

## Detailed behaviour

### Windows (Small Council metric)

Ranking metric = **sum of a user's `influence_events.points` whose `createdAt`
falls in the active window** (reversal events included, so they net out).

- **Week** — the current calendar week, resetting **Monday 00:00 UTC**. Rolling
  reset gives a recurring "fresh, winnable" beat. UTC-anchored for simplicity via
  a single tunable constant; may be re-anchored to a launch-city timezone later.
- **Season** — a fixed 8-week (56-day) epoch computed by arithmetic from a
  `SEASON_GENESIS` constant: `seasonIndex = floor((now − GENESIS) / 56d)`,
  window `[GENESIS + idx·56d, GENESIS + (idx+1)·56d)`. Pure read-time math, no
  rollover job — consistent with the app's existing decay-as-computation model.
  **"This Season" is a time filter, not a competitive reset**; Influence
  soft-reset belongs to season rollover, which stays deferred.
- **All-Time** — no lower bound; equals lifetime rank XP (`lifetimeXp`).

### Small Council display

- **Top 50** rows: rank number, display name, House colour chip, window points.
- The **viewer's own row is pinned at the bottom** with their true position if
  they are outside the top 50 (e.g. "142 · You"). If they are in the top 50 it is
  highlighted in place, not duplicated.
- **Tie-break** (deterministic): points desc → earliest contributing-event
  timestamp *within the active window* (for All-Time, earliest ever) → display
  name asc.
- **Empty window** (nobody scored) → honest empty state:
  "No deeds recorded this week — be the first."

### House Standings display

- Four Houses ranked by **current decayed realm-wide Influence** — the same
  `0.98^daysSince` decay as the map, summed across every fief realm-wide, grouped
  by House.
- Primary stat: **share %** (House influence / total realm influence).
- Secondary stat: **# of fiefs led** (count of fiefs where that House is the
  current leader).
- If total realm influence is 0, all Houses show 0% / 0 fiefs (honest empty
  state), no leader.

### Anonymous "Wandering Peasant"

Read-only, no House. Can **view** both boards. Never appears on the Small
Council. The My-House filter and the "You" row are replaced by a sign-in nudge.

## Architecture

Read-only feature. Data flow: `influence_events` (DB) → API selector → JSON →
Standings tab. No writes, no schema migration.

### Units

- **`src/lib/standings.ts`** *(new, pure — mirrors `selectors.ts`)*
  - `weekWindow(now: number): { start: number; end: number }`
  - `seasonWindow(now: number): { start: number; end: number; index: number }`
  - `smallCouncil(events, opts): SmallCouncilResult` where
    `opts = { window: "week" | "season" | "all"; houseFilter: HouseId | null;
    now: number; viewerId?: string }`. Returns `{ rows: CouncilRow[];
    viewerRow: CouncilRow | null }` (`viewerRow` set only when the viewer is off
    the top-50 list). `CouncilRow = { userId; displayName; houseId; points;
    position }`.
  - `houseStandings(events, now): HouseStandingRow[]` →
    `{ houseId; influence; share; fiefsLed }[]`, sorted by influence desc.
  - Reuses/relocates `lifetimeXp` semantics; the all-time window path must equal
    the existing `lifetimeXp` sum for a given user.
  - Constants: `WEEK_ANCHOR` / `SEASON_GENESIS` / `SEASON_LENGTH_DAYS = 56`
    live here (or in `data.ts` if that better matches existing convention).

- **`src/app/api/standings/route.ts`** *(new)*
  - `GET ?window=week|season|all&house=<id|all>`; unknown/missing params
    degrade to safe defaults (`window=week`, `house=all`) rather than erroring —
    a leaderboard should always render.
  - Loads influence events, joins `users` for `displayName`/`houseId`, resolves
    the viewer from the session (viewer optional — anonymous allowed).
  - Returns `{ council: { rows, viewerRow }, houses: HouseStandingRow[],
    window: { key, start, end, seasonIndex? } }`.
  - Server does all computation so the client never receives the raw ledger.
  - Standard no-store headers; `/api/*` is never SW-cached (existing invariant).

- **Client**
  - `src/components/Standings.tsx` *(new)* — segmented control (Small Council /
    House Standings), window toggle, House filter; renders `StandingsBoard` and
    `HouseStandings` subcomponents (may be inlined if small).
  - `src/components/TabBar.tsx` — add `"standings"` to `TabId` and the tab list.
  - `src/app/page.tsx` — render the Standings tab; reset transient selection on
    tab change (matching existing pattern).
  - `src/lib/store.tsx` — add a standings fetch (fetch-on-view; not part of the
    realm snapshot). Offline: the tab shows an offline/empty state — standings
    are not part of the offline snapshot this cycle.
  - `src/lib/copy.tsx` — plain-speech entries for new labels (e.g. "Small
    Council" → plain equivalent, "House Standings", window labels). Game-identity
    terms (House names, ranks) stay themed per the Phase 2 Plain Speech rule.

## Testing

- **`src/lib/standings.test.ts`** *(new, mirrors `selectors.test.ts`)*:
  - week/season window boundaries (event exactly at start/end);
  - reversal netting (a positive earn + later reversal → correct net);
  - House filter (My-House restricts population);
  - tie-break ordering determinism;
  - viewer off-board vs. on-board (no duplicate row);
  - empty window and zero-influence House standings;
  - all-time equals `lifetimeXp` for a user.
- **API route smoke test** for param validation and shape (anonymous + signed-in
  viewer).
- **Live verification on dev** before wrap: Standings tab renders, window toggle
  and House filter change the board, House Standings shares sum sensibly, "You"
  row behaves, anonymous view shows the sign-in nudge.

## Out of scope (this cycle)

- Per-Fief individual leaderboards.
- Helpful-vote quality weighting (its own P1 item).
- Individual rank decay (decided against — D1).
- Season Influence soft-reset / season rollover (deferred to Phase 5).
- Notifications, Underdog Blessing, titles/badges, streaks (Cycles B & C).
- Adding standings to the offline snapshot.
