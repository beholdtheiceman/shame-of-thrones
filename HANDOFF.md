# Handoff — 2026-07-12 (late night)

## Where things stand
**Phase 2 Cycles 1 AND 2 are live in production** (both shipped today).
Cycle 1: tier-name score display, tap-a-fief control card, privacy audit +
photo-EXIF strip. Cycle 2: the Plain Speech toggle (Aa in the header —
functional copy rendered literally, persisted in localStorage) and the
code-level WCAG AA pass (contrast-fixed palette, axe-core clean on four
UI states, dialog semantics/focus/Esc everywhere, named map markers, zoom
re-enabled). Remaining Phase 2 work is **Cycle 3: offline support** only.

## Done this session (cycle 2 portion)
- Spec + plan: `docs/superpowers/specs/2026-07-12-phase2-plain-speech-a11y-design.md`
  (with audit-results amendment), `docs/superpowers/plans/2026-07-12-phase2-plain-speech-a11y.md`
- `src/lib/copy.tsx` (dictionary/provider/hooks), `PlainSpeechToggle`,
  `plainLabel` on VERDICT_SCALE, `displayTier`, copy sweep over 10 components — verified live
- `src/lib/useEscape.ts` with a topmost-overlay stack (Esc closes only the
  top dialog), dialog roles + focus-on-open, aria-hidden emoji — verified live
- Contrast fixes with recorded ratios; axe violations fixed (markers,
  viewport zoom, h1, chip tints); FiefCard house names moved to plain ink
- Combined review found 2 Important issues (nested-Esc double-close,
  SignInGate overlay missing semantics) — both fixed and verified
- 148 tests green (one pre-existing flaky testimony timeout, passes standalone), build clean

## ⚠️ Half-finished / fragile right now
Nothing mid-flight. Notes:
- **Nested Report-modal Esc** (modal over sheet) is fixed via the stack but
  was only verifiable anonymously via the SignInGate overlay — exercise the
  Report-over-Sheet case once while signed in.
- Known a11y waiver (recorded in the spec): testimony house-name colors keep
  game identity; House Flush blue measures ~3.2:1.
- Hydration warnings in dev when `sot-theme` is set in localStorage —
  pre-existing theme-init pattern, not a regression.
- Cost note: this session ran long (~$76); prefer a fresh session for Cycle 3.

## Next steps (in order)
1. **Phase 2 Cycle 3: offline support** (tile caching, queue-and-sync
   ratings) — brainstorm → spec → plan in a fresh session.
2. Legal/trademark clearance (Larry, external — the only open Phase 1 item).
3. Optional: delete prod test artifacts (ser.claude_verifier, "Verify Test
   Privy", 1x1 test photo).

## Decisions & discoveries this session
- Plain Speech scope (Larry): functional UI copy only; Houses/ranks/Ledger/
  server-error strings stay themed (documented limitation).
- axe measures chip text against the composited tint background — chips need
  *-strong text variants (crimson-strong added, mirroring brass-strong) or
  /10 tints; house-brand colors are not AA-safe as text (use ink + colored bars).
- `useEscape` uses a module-level overlay stack; register once per mount
  (callback in a ref) or re-renders reorder the stack.
- The codex-rescue wrapper once claimed a background job id that never
  existed — verify with `git status` before trusting a "started" report;
  a retry with "run synchronously, do not detach" worked.
- The browser pane's screenshot capture still hangs on this app; all
  verification runs via JS eval + dispatched DOM events (works on dev and prod).
