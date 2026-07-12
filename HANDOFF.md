# Handoff — 2026-07-12 (night)

## Where things stand
**Phase 2 Cycle 1 (display gaps) is live in production.** Tier names now lead
the ThroneSheet score ("🏰 Fit for a Knight · 4.5 · 2 sittings"), tapping a
fief polygon opens a House-control breakdown card, and the location-privacy
audit ran: user coordinates never reach the server at all, and the one gap
found (photo EXIF/GPS served verbatim) was fixed same-day with a sharp
re-encode. 126/126 tests, clean build, browser-verified on localhost AND on
the live prod site. Working tree clean, everything pushed.

## Done this session
- Spec + plan: `docs/superpowers/specs/2026-07-12-phase2-display-gaps-design.md`
  (includes filled-in audit checklist), `docs/superpowers/plans/2026-07-12-phase2-display-gaps.md`
- `tierForScore` + ThroneSheet tier chip — verified live
- `fiefCardModel` + `FiefCard` + map tap plumbing — verified live
- Privacy audit (5/6 PASS) + EXIF-strip fix (sharp re-encode, orientation
  baked, post-encode size recheck, unreadable→400) — unit-tested, deployed
- Reviews caught two real bugs pre-ship: Leaflet polygon clicks need
  `L.DomEvent.stopPropagation(e)` (native stop is a no-op there), and
  re-encoding could inflate files past the 5MB cap
- ROADMAP Phase 2 boxes checked for tier display, fief breakdown, privacy

## ⚠️ Half-finished / fragile right now
Nothing mid-flight. Notes only:
- **Contested badge** renders from unit-tested logic but was never seen live
  (no contested fief exists in dev/prod data yet — glance at it whenever two
  Houses first fight over a fief).
- **Add-mode fall-through** (fief tap while Chart-a-Throne active → places
  throne, no card) is code-reviewed but not live-verified — needs a signed-in
  session; check once while adding a real throne.
- Cosmetic: a score of ~4.47 displays as "4.5" (toFixed) beside tier 4 "Fit
  for a Knight" (Math.round of the raw value) — looks like a mismatch at
  exactly the .45–.49 band. Decide in cycle 2 whether to round the displayed
  number and tier from the same value.
- Pre-existing test artifacts in prod DB still deletable (ser.claude_verifier,
  "Verify Test Privy", 1x1 test photo).

## Next steps (in order)
1. **Phase 2 Cycle 2: Plain Speech toggle + accessibility pass** (or Cycle 3:
   offline support — Larry's pick). Carry-forwards for the a11y pass, from
   reviewers: emoji glyphs (tier chips, verdict scale) have no aria-hidden
   anywhere; "Rumored" and tier chips share identical brass styling; fief-card
   selection persists across tab switches.
2. Legal/trademark clearance (Larry, external — still the only open Phase 1 item).

## Decisions & discoveries this session
- Leaflet: layer click handlers must use `L.DomEvent.stopPropagation(e)`;
  `e.originalEvent.stopPropagation()` runs after Leaflet has already captured
  the container event and silently does nothing.
- Markers don't need this — Leaflet's `Marker` defaults `bubblingMouseEvents`
  to false (polygons default true), which is what gives throne pins priority.
- Privacy posture is stronger than the PRD asks: proximity is computed
  on-device (`SittingFlow`), only a boolean crosses the wire — there is no
  coordinate to mishandle server-side.
- sharp needs zero Vercel/Next config (it's on Next's default
  serverExternalPackages list); `.rotate()` must run before the format
  re-encode or stripped orientation tags would sideways phone photos.
- The browser pane's screenshot capture hangs on this app (Leaflet layer?);
  text reads, JS eval, and DOM-dispatched events all work — verification ran
  that way, on dev and prod.
