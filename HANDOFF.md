# Handoff — 2026-07-13

## Where things stand
**Phase 2 is COMPLETE and pushed** (the earlier "cycle 3 awaits push" note was
stale — `HEAD == origin/feat/phase0-backend`, nothing unpushed).

**Phase 3 · Cycle A (Standings) is BUILT and COMMITTED locally, NOT pushed.**
Commits `a6ee15e..1850757` on `feat/phase0-backend` deliver the leaderboards
subsystem and resolve the rank-decay question. Push = prod deploy → needs
Larry's explicit OK.

## Done this session (Cycle A)
- **Brainstorm → spec → plan**, all committed:
  - Spec: `docs/superpowers/specs/2026-07-13-phase3-standings-design.md`
  - Plan: `docs/superpowers/plans/2026-07-13-phase3-standings.md` (8 TDD tasks)
- **Implementation** (Codex wrote code, Claude reviewed + ran git/tests/build):
  - `src/lib/standings.ts` — pure selectors: `weekWindow` (Mon 00:00 UTC),
    `seasonWindow` (fixed 56-day epoch), `windowRange`, `smallCouncil`
    (window + house filter, reversal netting, viewer-off-board pinning),
    `houseStandings` (decayed realm share + fiefs led). Reuses `fiefControl`.
  - `src/lib/standings.test.ts` — 17 units.
  - `src/lib/server/standings.ts` + `src/app/api/standings/route.ts` — server
    compute; joins `users` for display names, params degrade to safe defaults.
  - `src/lib/api.ts` — `api.standings` + `StandingsDTO`.
  - `src/components/Standings.tsx` — new 4th "Standings" tab (Small Council +
    House Standings, segmented, window toggle, House filter, anonymous nudge).
  - `TabBar.tsx`, `page.tsx` wired; `copy.tsx` plain-speech labels.
- **Verified:** `npm run test` → **154/154 pass against the real Neon DB**
  (was 136; +18). `npm run build` → clean, `/api/standings` route generated.
  Live API spot-check on dev: House Standings shares sum ~100% + fiefs led;
  All-Time board returns 8 ranked contributors with real display names;
  `window=bogus` → safe `week` default. This-week board correctly empty
  (seed predates the calendar week) → exercises the empty state.

## ⚠️ Half-finished / fragile right now
- **Cycle A is unpushed.** Push needs Larry's OK (= prod deploy).
- **Rendered UI not visually confirmed this session.** The browser preview pane
  hung (0×0 viewport, screenshot 30s timeout — a harness glitch, not the app).
  Verified the server path via the live `/api/standings` endpoint instead. Once
  deployed (or with a working preview), eyeball the tab: board rows, window
  toggle, My-House filter, the highlighted/pinned "You" row, House bars.

## Key decisions & discoveries
- **Rank stays lifetime/undecayed** — README gap #6 resolved as a deliberate NO
  (spec D1). Influence decays (territory); rank does not (reputation).
- **`toGameEvent` sets `authorName = userId`** (a UUID), so the standings query
  must join `users` and substitute `displayName`. The Small Council keys on the
  unique `displayName`; reversal events net out per contributor for free.
- **Standings are NOT in the offline snapshot** (by design this cycle) — the tab
  shows its error panel offline.
- **Tailwind tokens:** `text-on-brass` / `*-vellum-line` are real tokens in
  `globals.css` (`@theme` → `--color-*`).

## Next steps (in order)
1. **Push Cycle A** (Larry's OK) → prod deploy; then eyeball the Standings tab.
2. Phase 3 continues: **Cycle B — Recognition** (titles & badges + streaks) or
   **Cycle C — Balance & re-engagement** (Underdog Blessing + notifications;
   notifications needs new push infra). Trademark/legal is still the only open
   Phase 1 item.
3. Optional: revisit per-Fief individual leaderboards if beta shows local
   rivalry demand.

## Budget note
Session ran hot (~$59 at the cost-critical checkpoint). Brainstorm+spec+plan
+ Codex implement + full review + commit in one session is heavy; the
"one cycle per session" shape from Phase 2 still holds.
