# Phase 2 Cycle 1 — Display Gaps (design)

Date: 2026-07-12
Status: approved by Larry (brainstorm session)
Scope source: ROADMAP Phase 2 — "Close the UI gaps found in review"

Phase 2 is decomposed into three cycles, each its own spec → plan → ship:

1. **Display gaps** (this spec): tier-name score display, Fief control
   breakdown, privacy re-verification.
2. Plain Speech toggle + VoiceOver/WCAG AA accessibility pass.
3. Offline support (tile caching, queue-and-sync ratings).

## 1. Tier-name score display (ThroneSheet)

**Problem (PRD §"Register"):** `ThroneSheet` shows a raw `4.2 / 5`, which a
new user can misread as good-or-bad-unknown. The PRD's intent is that the
tier name leads ("Fit for a Knight") and the number is secondary.

**Design (chosen layout: inline chip row):**

- New pure helper in `src/lib/selectors.ts`:
  `tierForScore(score: number): { value; glyph; label }` — rounds the average
  score to the nearest integer tier (`Math.round`; 4.5 → 5) and returns the
  matching `VERDICT_SCALE` entry from `src/lib/data.ts`. Input is clamped to
  [1, 5] defensively.
- In `ThroneSheet`'s status-chip row (after the Verified/Rumored chip, before
  the "Forgotten" chip logic — order: status, tier, forgotten): a tier chip
  styled like the existing chips (`pixel-chip`, brass-tinted) showing
  `{glyph} {LABEL}` uppercase.
- The existing `4.2 · 12 sittings` text stays inline after the chip in the
  current small mono style, dropping the "/ 5" (the tier carries the meaning;
  the count phrasing is unchanged).
- Unrated thrones (`score === null`): no tier chip; keep the current
  "Unrated" text exactly as-is.
- Out of scope this cycle: Ledger rows, map pins (they keep the color-band
  system), and any other bare-score surfaces. If later passes need the tier,
  they reuse `tierForScore`.

## 2. Fief control breakdown (map tap → bottom card)

**Problem (ROADMAP):** `fiefControl` in `selectors.ts` computes the
per-House split for every fief, but the map only tints the polygon with the
leader's color. The territory game's core number is invisible.

**Design (chosen: tap a fief → bottom card):**

- `RealmMap`'s `FiefLayer` polygons get a click handler that reports the
  tapped `fiefId` upward (`onSelectFief(fiefId)` prop, mirroring
  `onSelectThrone`). Throne pins render above polygons and keep priority —
  tapping a pin opens the ThroneSheet, never the fief card.
- New client component `FiefCard` (`src/components/FiefCard.tsx`): a bottom
  card in the same `pixel-panel` language as ThroneSheet, but short. Content:
  - Title: "This Fief" (H3 cells have no names) with a leader line —
    "House Flush holds this land" in the leader's house color — or
    "No House holds this land" when there is no leader.
  - "Contested" badge when `control.contested` (same crimson chip style the
    map's dashed border implies).
  - All four Houses sorted by share descending: name, house-colored bar
    sized by share, integer percent (`Math.round(share * 100)`). Zero-share
    Houses render greyed with a 0-width bar — the full ledger of the war,
    not just the winners.
- Data flow: page state gains `selectedFiefId`; the card reads the matching
  `FiefControl` from the already-fetched `fiefs` prop. **No API changes, no
  server changes.** If the tapped fief has no `FiefControl` entry (no
  influence events yet), the card shows the no-leader state with all bars
  at 0%.
- Dismissal: ✕ button, tapping the map elsewhere, or selecting a throne pin
  (ThroneSheet and FiefCard are mutually exclusive; opening one closes the
  other).
- **Add-a-Throne priority:** while `addMode` is active, polygon taps do NOT
  open the fief card — the click falls through to the existing
  place-a-throne behavior unchanged.

## 3. Privacy re-verification (audit)

**Problem (ROADMAP / PRD §7):** the promise is that location handling stores
only the proximity boolean + coarse geohash server-side, never a raw
coordinate trail. This was true by construction in the prototype and Phase 0
deliberately never stored a coordinate trail, but Phase 1 added many new
write paths (signals, reports, photos, testimony) — re-verify now that the
real backend exists.

**Audit checklist (findings recorded in this spec at completion; any FAIL
becomes a fix task in the plan):**

- [ ] `ratings` rows and the influence ledger store no user lat/lng — only
      the proximity result.
- [ ] Anti-gaming signals derive from THRONE coordinates + timestamps, and
      persist no user coordinates (Phase 1 sub-project 1's design intent).
- [ ] Reports, review-queue rows, and AI-triage payloads contain no user
      coordinates.
- [ ] Photo uploads: EXIF (including GPS) is stripped or never persisted;
      the stored bytea and the serving route expose no location metadata.
- [ ] No request logging path (route handlers, middleware) writes raw
      coordinates to durable storage.
- [ ] Client sends coordinates only where the API needs a proximity check,
      and nowhere else.

Deliverable: this checklist filled in with pass/fail + file references,
committed as an amendment to this spec.

## Error handling

- `tierForScore` clamps out-of-range input; callers never pass `null`
  (guarded by the existing `score !== null` branch).
- FiefCard renders a sensible empty state for missing/zero-influence fiefs
  rather than crashing or hiding silently.

## Testing

- Vitest units: `tierForScore` boundaries (1.0, 2.49→2, 2.5→3, 4.5→5,
  clamp <1 and >5), and FiefCard share math/sorting (integer rounding,
  zero-share ordering stable).
- Existing suite (117 tests) stays green; both DBs migrated if any migration
  appears (none expected — this cycle is client-only).
- Live browser verification before deploy: tier chip on a rated + an
  unrated throne; fief tap → card on a contested and an uncontested fief;
  pin-tap priority over polygon-tap.

## Out of scope (YAGNI)

- Fief names, fief history, per-fief leaderboards (Phase 3 territory).
- Tier display anywhere beyond ThroneSheet.
- Redis/live counters (Phase 0 deferral stands).
- Any server or schema change.
