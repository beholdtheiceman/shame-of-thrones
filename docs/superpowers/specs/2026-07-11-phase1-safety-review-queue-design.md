# Phase 1, Sub-project 1 — Safety Hardening + AI-Triaged Review Queue

**Date:** 2026-07-11
**Status:** Approved design
**Depends on:** Phase 0 backend (shipped — see `2026-07-11-phase0-backend-design.md`)

## Goal

Land the launch-blocking trust & safety items that need no paid vendors, glued
together by a single review queue: a COPPA age gate, private-residence
attestation on Add-a-Throne, non-punitive anti-gaming heuristics, and an AI
triage job that annotates every flagged action for a human moderator.

Guiding rule (Larry's explicit choice): **when a heuristic trips, the action
still goes through** — it is flagged to the review queue, not rejected. The
only hard rejections are the age gate, the missing attestation checkbox, and a
bot-scale rate ceiling.

## Decisions made during brainstorming

1. **Age gate:** neutral birthdate screen (no cutoff hint). Store only an
   `over13ConfirmedAt` timestamp — never the birthdate. Under-13 entries set a
   lock timestamp so retrying doesn't work. Existing users are gated on next
   sign-in.
2. **Rate limits, two thresholds:** a soft threshold (12 writes/hour) that
   flags to the queue, and a generous hard ceiling (30 writes/hour) that
   returns a themed 429. Humans never see the error; bots can't flood the
   ledger.
3. **Moderator access:** `role` column on `users` (`user` | `moderator`),
   promoted via SQL in Neon for now. Server-side checks on the page and API.
   Granting UI comes with subsystem #4 (report flows + moderator tooling).
4. **Triage timing:** inline after the write via Vercel `waitUntil()` — no new
   infra, queue rows arrive pre-annotated. Failures leave the row "triage
   pending" with a moderator re-run button.
5. **New thrones:** required "publicly accessible" attestation checkbox, and
   **every** new throne creates a low-severity queue row (AI triage is good at
   spotting "Steve's apartment bathroom"-style names). The throne still
   appears immediately as Rumored.
6. **Architecture:** one shared signals module called from the write routes —
   no outbox/processor, no DB triggers. Follows the existing `src/lib/server/*`
   pattern.

## Schema changes

### `users` — three new columns

| column | type | notes |
|---|---|---|
| `role` | new `user_role` pg enum: `user`, `moderator` | not null, default `user` |
| `over13ConfirmedAt` | timestamptz, nullable | null = not yet attested; set server-side when a submitted birthdate computes to ≥13 |
| `ageGateLockedAt` | timestamptz, nullable | set when a submitted birthdate computes to <13; blocks retry; stores no age data |

### `thrones` — one new column

| column | type | notes |
|---|---|---|
| `publicAccessAttested` | boolean, not null | migration backfills `true` for existing rows (seed venues are all public) |

### New table `review_queue`

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `kind` | new `review_kind` enum: `rating`, `new_throne`, `confirmation` | |
| `subjectId` | uuid | the rating id or throne id (no FK — subjects span tables) |
| `userId` | uuid → users | the actor |
| `signals` | jsonb | array of signal objects, e.g. `[{"signal":"impossible_travel","kmh":840,"fromThroneId":"…","minutes":12}]` |
| `severity` | new `review_severity` enum: `low`, `medium`, `high` | rule-assigned at insert; highest-severity tripped signal wins |
| `aiAssessment` | text, nullable | plain-English triage note from Claude |
| `aiSeverity` | `review_severity`, nullable | model's suggested severity |
| `aiTriagedAt` | timestamptz, nullable | |
| `aiError` | text, nullable | last triage failure, if any |
| `status` | new `review_status` enum: `pending`, `resolved` | default `pending` |
| `resolvedBy` | uuid → users, nullable | |
| `resolvedAt` | timestamptz, nullable | |
| `resolutionNote` | text, nullable | |
| `createdAt` | timestamptz | default now |

Indexes: `(status, createdAt)` for the queue page; `(userId)`.

## Signals module — `src/lib/server/signals.ts`

Called by the three write paths (`submitRating`, add-throne, confirm-throne).
Two entry points:

**`enforceHardCeiling(userId, now)`** — runs *before* the write. Counts the
user's writes (ratings + thrones + confirmations) in the trailing hour; >30
throws a themed 429 error ("The ravens cannot carry so many messages —
rest awhile."). Count source: existing tables, no new bookkeeping.

**`evaluateSignals(ctx)`** — runs *after* the transaction commits (the action
has already succeeded). Computes:

| signal | trips when | severity |
|---|---|---|
| `new_account` | actor's account is <7 days old at write time | low |
| `rate_soft` | actor made >12 writes in the trailing hour | medium |
| `impossible_travel` | verified ratings only: implied speed between this rating's throne and the actor's previous verified rating's throne exceeds 150 km/h | high |
| `new_throne` | every Add-a-Throne submission | low |

Any tripped signal inserts **one** `review_queue` row for the action, with all
tripped signals merged into the `signals` array and the highest severity
assigned. Then triage is scheduled (see below).

**Privacy invariant preserved:** impossible travel is computed purely from
throne coordinates + rating timestamps already in the DB. No user coordinate
trail is stored, matching Phase 0's deliberate choice.

Thresholds (7 days, 12/hour, 30/hour, 150 km/h) live as named constants in
`src/lib/game/rules.ts` alongside the existing tunables.

## Influence ramp

Accounts <7 days old earn **50% Influence, rounded up** (never zero), applied
at the point where points are computed for every earning reason (`rating`,
`hearsay`, `first_of_name`, `new_throne`, `confirmation`). The append-only
ledger stores the actual awarded points, so all read-side decay/control/rank
math is untouched. The API response and ledger text reflect the real (halved)
number.

## Age gate

- **`POST /api/age-gate`** — body `{ birthDate: "YYYY-MM-DD" }`. Server
  computes age (calendar-correct: someone turns 13 *on* their 13th birthday).
  ≥13 → set `over13ConfirmedAt = now()`, discard the date. <13 → set
  `ageGateLockedAt = now()`, respond locked. If already locked, always
  respond locked.
- **Write-path enforcement:** every write endpoint returns 403 with error code
  `age_gate_required` (or `age_gate_locked`) when the user's
  `over13ConfirmedAt` is null. Read paths stay open (Wandering Peasant mode is
  unaffected).
- **Client:** a neutral birthdate screen — no mention of 13 or COPPA — shown
  after Google sign-in and **before profile creation** for new users; existing
  users see it on next sign-in (the app checks `/api/me` for the flag). Locked
  users get a polite dead-end screen.
- `/api/me` response gains `over13Confirmed: boolean` and
  `ageGateLocked: boolean` (booleans only — timestamps stay server-side).

## Private-residence protection

- Add-a-Throne UI gains a required checkbox: attest the facility is in a
  publicly accessible place, not a private residence. ("Residence" is already
  not a selectable category.)
- The API rejects submissions without `publicAccessAttested: true` (400).
- Every accepted new throne creates a `new_throne` queue row (low severity),
  so a human — helped by the AI note — actually reviews for residence-style
  entries. The throne appears on the map immediately as Rumored.

## AI triage — `src/lib/server/triage.ts`

- Fired via `waitUntil()` from the route after the queue row is inserted, so
  the user response is never delayed.
- Calls the Claude API (official `@anthropic-ai/sdk`) with: the tripped
  signals, the action's details (throne name/category/location, verdict, tags),
  and a compact summary of the actor's recent activity (counts, timestamps,
  account age, display name — no other PII). Asks for structured output:
  `{ assessment: string, severity: "low" | "medium" | "high" }` — a
  plain-English read of what's probably happening, written for a human
  moderator.
- Model id from `TRIAGE_MODEL` env var; default to the current cheapest tier
  (exact model id and pricing to be confirmed against the API reference at
  implementation time — expected cost is fractions of a cent per item).
  API key from `ANTHROPIC_API_KEY`.
- Success → write `aiAssessment`, `aiSeverity`, `aiTriagedAt`. Failure →
  write `aiError`; the row renders as "triage pending" with a re-run button.
- Re-run endpoint: `POST /api/review/[id]/triage` (moderator only).

## Moderator surface

- **`/moderation`** page, server-side `role = 'moderator'` check (404 or
  redirect for everyone else).
- **`GET /api/review`** — pending items first (newest first), then a short
  tail of recently resolved ones; simple limit, no pagination/filters.
- **`POST /api/review/[id]`** — `{ action: "resolve", note? }`.
- Each row shows: kind, severity chip, actor, subject summary, tripped
  signals, AI assessment (or "triage pending" + re-run), resolve button with
  optional note.
- Deliberately minimal: **no takedown/enforcement actions this sub-project** —
  removing content and punishing users is subsystem #4. This queue is
  eyes-on-the-problem.

## Testing

Follow the existing `src/test/*` harness:

- Signal math: impossible-travel speed calculation, rate windows, account-age
  boundary (exactly 7 days).
- Age gate: exact-13th-birthday edge, lock behavior, no birthdate persisted
  anywhere, 403 codes on write paths.
- Influence ramp: halving + round-up across all earning reasons; ledger rows
  store the halved value.
- Hard ceiling: 31st write in an hour → 429; 30th succeeds.
- Queue: one row per flagged action with merged signals; every new throne
  queued; severity assignment.
- Triage: mocked Anthropic client — success writes assessment, failure writes
  `aiError`; re-run endpoint.
- Authorization: `/api/review*` and `/moderation` reject non-moderators.

Verify gate before commit: `npm run build`, full test suite, and a live
browser pass (sign in → hit age gate → add throne with attestation → see the
queue row + AI note on `/moderation`).

## Out of scope (later sub-projects)

- Report flows on UGC + takedown/enforcement actions (subsystem #4)
- Text review moderation (subsystem #5)
- Photo pipeline (subsystem #6, needs paid vendors)
- Device/IP-level rate limiting and mock-location flags (needs native clients)
- Residential-parcel proximity checks (needs a parcel data source)
- Moderator role-granting UI (SQL promotion is fine for now)

## Execution model

Per the established working model: Codex (GPT-5.6) implements from the written
plan; Claude reviews every diff, runs installs/tests/migrations/browser
verification, and makes all commits.
