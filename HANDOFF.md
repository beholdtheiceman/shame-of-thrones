# Handoff — 2026-07-12 (evening)

## Where things stand
**Phase 1's engineering is COMPLETE and live in production.** All three
trust & safety sub-projects shipped today on `feat/phase0-backend` (which
Vercel prod tracks): (1) age gate + anti-gaming + AI-triaged review queue,
(2) reports + takedowns-with-influence-reversal + suspend/ban + Scroll of
Testimony with hybrid AI screening, (3) the photo pipeline (vision-classified,
fail-closed, human-approved-before-public). 117/117 tests, clean builds,
every cycle browser-verified live including real Haiku triage/screen/vision
calls. The only open Phase 1 item is **legal/trademark clearance** — external,
Larry's, not code.

## Done this session
- Cycle A (reports/takedowns/enforcement/testimony): spec, 11-task plan,
  built, verified live, deployed — verified working
- Cycle B (photos): spec (amended to bytea storage), 7-task plan, built,
  verified live end-to-end (upload → real vision verdict → approve →
  public serving) — deployed in this session's final push
- Stale ROADMAP box fixed: self-serve confirmation was already shipped in Phase 0

## ⚠️ Half-finished / fragile right now
Nothing mid-flight. Housekeeping notes only:
- Test artifacts in the shared prod/dev DB (safe to delete): user
  `ser.claude_verifier` (a moderator), throne "Verify Test Privy (safe to
  resolve)", its ratings/reports/review rows, and one approved 1x1-pixel
  test photo.
- The "reject a real person photo" path is unit-tested but wasn't exercised
  live (no real face photo was fabricated); the first real-world person
  upload is its live test — watch `/moderation`.

## Next steps (in order)
1. **Phase 2 — UI gaps** (ROADMAP): tier-name score display, Fief control
   breakdown, Plain Speech toggle, accessibility pass, offline support.
2. Legal/trademark clearance (Larry, external — blocks marketing, not dev).
3. Optional cleanup: delete the test artifacts above.

## Decisions & discoveries this session
- Takedown reversals copy the ORIGINAL event's `createdAt` so 0.98^days decay
  cancels exactly forever; `unreversed()` matching makes rating-then-throne
  takedowns idempotent.
- Asymmetric failure policy, on purpose: testimony screen fails OPEN
  (post + flag), photo classification fails CLOSED (stays invisible) — the
  PRD's "no unmoderated public photo" is non-negotiable.
- Photos store bytea in Postgres (spec amended from Vercel Blob): private by
  construction, no new tokens/stores; swapping to Blob later is a contained
  change behind the serving route.
- Reports: one per reporter per subject (unique index), 20/day cap, merged
  into ONE pending queue row per subject with severity escalation at 2+.
- Report queue rows belong to the CONTENT AUTHOR (userId); the reporter lives
  in the reports table — triage context describes the author.
- Vitest hits `.env.test`'s Neon branch — migrate BOTH DBs (memory:
  test-db-needs-own-migrations).
- The permission classifier requires Larry to explicitly name role-grant
  recipients; Vercel "Sensitive" env vars can never be re-viewed.
