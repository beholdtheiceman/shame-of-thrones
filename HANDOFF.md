# Handoff — 2026-07-12

## Where things stand
Phase 1 sub-project 1 (safety hardening + AI-triaged review queue) is **fully
live in production**. The COPPA age gate, private-residence attestation,
non-punitive anti-gaming signals, Claude-API triage, and the `/moderation`
page all shipped on `feat/phase0-backend` (which Vercel production tracks) and
were verified end-to-end, including a real Haiku triage note. Nothing is in
flight; the working tree is clean.

## Done this session
- Spec + plan: `docs/superpowers/specs/2026-07-11-phase1-safety-review-queue-design.md`,
  `docs/superpowers/plans/2026-07-11-phase1-safety-review-queue.md` — committed
- All 12 plan tasks implemented (Codex wrote, Claude reviewed/tested/committed) — 66/66 tests, clean build
- Live browser verification: sign-in → age gate → onboarding → attested throne →
  queue row → real AI triage note → resolve on `/moderation` — **all verified working**
- Merged to `feat/phase0-backend`, pushed, prod deploy verified healthy
- `ANTHROPIC_API_KEY` + `TRIAGE_MODEL` set in Vercel and `.env.local` (Larry pasted the key)
- `ser.claude_verifier` promoted to moderator (Larry-authorized)

## ⚠️ Half-finished / fragile right now
Nothing — everything committed, pushed, and verified. Two cosmetic leftovers only:
- Test artifacts in the shared prod/dev DB, safe to delete anytime: user
  `ser.claude_verifier` (a moderator), throne "Verify Test Privy (safe to
  resolve)", and its two review rows (one still pending, with a real AI note).
- `main` is still the old static prototype, 2 unpushed local commits ahead of
  `origin/main` — pre-existing, untouched. Tidy end-state (per memory): PR
  `feat/phase0-backend` → `main`, then repoint Vercel prod to `main`.

## Next steps (in order)
1. Pick the next Phase 1 sub-project: **#4 report flows + takedown actions**
   (grows the review queue that now exists) or **#5 text reviews + moderation**.
   Start with the brainstorm → spec → plan cycle as before.
2. Optional polish carried forward: replace the `window.prompt` resolution-note
   input on `/moderation` with an inline field.
3. Optional cleanup: delete the test artifacts listed above.

## Decisions & discoveries this session
- Age attestation lives in `age_attestations` keyed by `google_subject` (NOT on
  `users`) because the gate must run before profile creation creates the row.
- Heuristics never block (Larry's rule); only the 30-writes/hour ceiling 429s.
- Triage model comes from `TRIAGE_MODEL` (default `claude-haiku-4-5`); a missing
  API key degrades to `aiError` + a re-run button — the Anthropic client is
  constructed lazily inside `triage()` for exactly this reason.
- Vitest hits a separate Neon branch via `.env.test` — **migrations must be
  applied to both DBs** (see memory: test-db-needs-own-migrations).
- Vercel env vars marked "Sensitive" can never be viewed again by anyone —
  keys can't be copied between projects; Larry pastes values, Claude only
  stages names.
- The permission classifier requires Larry to explicitly name role-grant
  recipients (moderator promotions).
- Discarded at cleanup: an unrequested "North star" PRD paragraph a Codex
  subagent added, and a stray `ruvector.db` (plugin artifact, now in
  `.git/info/exclude`).
