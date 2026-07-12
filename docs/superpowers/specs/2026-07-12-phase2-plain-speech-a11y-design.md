# Phase 2 Cycle 2 — Plain Speech + Accessibility (design)

Date: 2026-07-12
Status: approved by Larry (brainstorm session)
Scope source: ROADMAP Phase 2 — Plain Speech toggle (PRD §6) + VoiceOver/WCAG
AA pass, plus four small carry-forwards from Cycle 1 reviews.

Larry's scope decisions: Plain Speech covers **functional UI copy only**
(client-side); the a11y pass is **audit + fix at code level** (no hardware
screen-reader pass, no persistent axe test rig — that can come with Phase 4
native work).

## 1. Plain Speech toggle

**Problem (PRD §6):** themed copy ("Sit Here", "the ravens were lost") is a
joke some users need to opt out of — accessibility users and people who just
need a bathroom. A settings toggle must render all functional copy literally.
Functional info (hours, accessibility, access requirements) must be plain
even in themed mode.

**Design (client-only; no schema/API changes):**

- `src/lib/copy.tsx`: a `COPY` dictionary of `{ themed, plain }` pairs keyed
  by stable ids (e.g. `sitHere`, `chartThrone`, `rumored`, `connectionError`),
  a `PlainSpeechProvider` (React context) reading/writing
  `localStorage["plainSpeech"]`, and hooks `useCopy()` → `t(key)` plus
  `usePlainSpeech()` → boolean for conditional rendering. Default: themed.
  SSR-safe: read localStorage in an effect; render themed on first paint.
- Toggle UI: a chip button in the header next to `ThemeToggle` (same
  interaction pattern), visible signed-in or not, with `aria-pressed` and a
  clear label ("Plain speech").
- Copy sweep (route through `t()`): action buttons (Sit Here, + Chart a
  Throne, Confirm this throne is real, Offer a Portrait, Nearest Worthy
  Throne), status chips (Rumored → "Unverified", ✓ Verified → "✓ Verified",
  Forgotten by the Realm → "Not confirmed in 120+ days"), section labels
  (Recent testimony → "Recent reviews", Report to the Maesters → "Report
  content"), client-side fallback errors ("the ravens were lost" →
  "Connection error — please try again"), photo status strings ("awaits the
  Maesters' review" → "Pending review", "The Maesters have refused this
  portrait." → "Photo rejected"), SittingFlow/AddThroneFlow/ReportModal/
  Onboarding functional copy. The exact key list is fixed in the plan.
- `VERDICT_SCALE` (src/lib/data.ts) gains `plainLabel` per tier: Avoid /
  Poor / Okay / Good / Excellent. The ThroneSheet tier chip and the
  SittingFlow verdict picker show `plainLabel` in plain mode.
- **Stays themed in both modes (game identity, per Larry):** House names,
  rank names, the Ledger feed (entries are themed markdown stored in the DB),
  season/app branding, and server-sent error message strings (rare; mapping
  server errors to codes is out of scope — documented limitation).
- PRD's "functional info always plain" clause: amenity labels, hours, and
  category labels are already literal in themed mode — the sweep verifies
  and keeps them literal.

## 2. Accessibility pass (WCAG AA, code-level)

- **Decorative emoji convention:** wrap in `<span aria-hidden="true">` —
  tier-chip glyph, verdict glyphs, ledger/chip icons, 🔥/🌙 theme glyphs.
  Text that IS the content (testimony) is untouched.
- **Icon-only / ambiguous controls:** aria-labels verified or added (✕ close
  buttons have them; house color chip in the header gets
  `aria-label={house.name}`; theme toggle gets `aria-pressed` semantics).
- **Overlays** (ThroneSheet, ReportModal, AddThroneForm, SignInGate overlay,
  FiefCard): `role="dialog"`, `aria-modal="true"` (FiefCard: non-modal
  `role="region"` + `aria-label` since the map stays interactive),
  `aria-labelledby` pointing at the title, Esc closes, and focus moves to
  the panel on open (simple focus management; a full focus trap is out of
  scope).
- **Contrast audit:** check the palette custom properties in
  `src/app/globals.css` for both themes (Torchlit/Moonlit) against WCAG AA —
  4.5:1 for normal text, 3:1 for large text and UI components. Fix failing
  pairs by darkening/lightening the CSS variable values (suspects:
  `--ink-faint` and `--brass` on vellum backgrounds). Record before/after
  ratios in the plan's audit task.
- **Verification:** one-off axe-core scan run in the browser pane against
  the dev server, on both themes × both speech modes; violations fixed or
  explicitly waived with a reason. No persistent test-rig dependency.

## 3. Cycle-1 carry-forward fixes

- Tier chip styling made distinct from the Rumored chip (both are brass
  today): tier chip switches to a vellum background with brass text +
  border, reading as informational rather than a status warning.
- `selectedFiefId` clears when `activeTab` changes, so a stale FiefCard
  doesn't reappear when returning to the Realm tab.
- Tier/display rounding unified: `tierForScore` is called with
  `Number(score.toFixed(1))` (the same value the UI displays), so "4.5"
  can never sit next to tier 4. Unit test pins the .45–.49 band.

## Error handling

- `t(key)`: unknown key falls back to the themed string or the key itself —
  never throws, never blanks UI.
- localStorage unavailable (SSR, privacy modes): provider degrades to
  in-memory state, themed default.

## Testing

- Vitest units: copy helper (themed/plain resolution, unknown-key fallback),
  `plainLabel` completeness (all 5 tiers), revised `tierForScore` rounding
  behavior pinned at the .45–.49 band.
- Existing 126-test suite stays green (client-only cycle; no migrations).
- Browser verification: toggle flips copy live and persists across reload;
  Esc closes each overlay; axe scan clean (or waivers documented) on
  Torchlit/Moonlit × themed/plain.

## Out of scope (YAGNI)

- De-theming the Ledger feed or server error strings (structured events /
  error codes — revisit if users ask).
- Full focus trap / roving tabindex; hardware VoiceOver/TalkBack pass
  (Phase 4, native).
- Offline support (Cycle 3), notifications, i18n.
