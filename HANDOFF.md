# Handoff — 2026-07-13 (Cycle A + B)

## Where things stand
**Phase 2 complete & pushed.** **Phase 3 Cycles A (Standings) and B
(Recognition) are both built, reviewed, and PUSHED to prod**
(`feat/phase0-backend` → Vercel, through commit `35c044d`).

## Cycle A — Standings (SHIPPED, on prod)
"Standings" tab: The Small Council (individual board; Week/Season/All-Time ×
All/My-House) + House Standings (four Houses by decayed realm Influence + fiefs
led). Pure `src/lib/standings.ts` + `/api/standings`. Rank stays lifetime/
undecayed (gap #6 closed as a deliberate no). Spec/plan under
`docs/superpowers/{specs,plans}/2026-07-13-phase3-standings*`.

## Cycle B — Recognition (built, UNPUSHED)
- **Streaks + badges, unified to computed-on-read.** New pure
  `src/lib/recognition.ts`: `currentStreak` (consecutive Mon-00:00-UTC weeks
  with ≥1 verified rating) + `earnedBadges`. `mePayload` computes badges +
  streak on read; the old imperative `users.badges` writes in `ratings.ts` /
  `thrones.ts` were removed (Influence logic untouched). Auto-backfills existing
  users; `users.badges` column retained but unused (no migration).
- **Badges:** first_of_their_name, cartographer, **nights_watch** (rating before
  05:00 UTC), **oathkeeper** (streak ≥ 4 wks). Breaker of Chains deferred
  (needs a moderation-outcome signal); streak *protection* deferred (no currency
  economy).
- **UI:** ProfilePanel shows the two new badges + "🔥 N-week streak" with an
  at-risk hint; `streak` threaded through the store like `rank`.
- Spec/plan: `docs/superpowers/{specs,plans}/2026-07-13-phase3-recognition*`.

## Verified
- `npm run test` → **165/165 pass against the real Neon DB** (154 after A → +11).
- `npm run build` → clean; `/api/standings` + all routes generate.
- The rewritten `ratings.test.ts` / `thrones.test.ts` assert **computed** badges
  via `mePayload` and pass → the computed-badge server path is DB-verified.

## ⚠️ Fragile / not done
- **Rendered UI not visually confirmed** for either cycle this session — the
  browser preview pane hung (0×0 viewport / screenshot timeout, a harness
  glitch). Verified via API/tests instead. Eyeball once deployed: Standings tab
  and the ProfilePanel streak/badges.
- **Pre-existing inconsistency (Codex flagged, NOT fixed):** the first-throne-
  rating ledger dispatch in `ratings.ts` announces "First of Their Name" even
  for an unverified first rating, while the computed badge requires a verified
  rating. Predates Cycle B; worth a small follow-up.

## Next steps
1. **Eyeball on prod** once deployed: the Standings tab and the ProfilePanel
   streak/badges (neither was visually confirmed this session).
2. **Phase 3 Cycle C — Balance & re-engagement:** Underdog Blessing (Influence
   multiplier for trailing Houses; touches the award path) + notifications
   (needs new push-delivery infra — the heaviest remaining item).
3. Trademark/legal is still the only open Phase 1 item.

## Budget note
This session did BOTH Cycle A and Cycle B (brainstorm→spec→plan→Codex→review→
commit ×2) and ran to ~$134+. That's ~2× the healthy "one cycle per session"
shape — expect Cycle C to be its own session.
