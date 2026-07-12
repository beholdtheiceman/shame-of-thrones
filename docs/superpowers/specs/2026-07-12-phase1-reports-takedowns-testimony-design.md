# Phase 1, Sub-project 2 (Cycle A) — Reports, Takedowns, Enforcement, Testimony

**Date:** 2026-07-12
**Status:** Approved design (Larry approved the combined Cycle A+B design 2026-07-12;
Cycle B — the photo pipeline — has its own spec)
**Depends on:** Sub-project 1 (shipped — review queue, AI triage, `/moderation`, roles)

## Goal

Complete ROADMAP Phase 1 subsystems #4 and #5: user-facing report flows on
thrones and ratings, real moderator enforcement (content takedowns that also
claw back Influence, plus account suspension/ban), and the Scroll of Testimony
free-text reviews with hybrid AI moderation.

Decisions locked during brainstorming:

1. **Scope:** #4 + #5 together (Cycle A), photos separately (Cycle B).
2. **Takedowns:** soft-hide content + append **negative reversal events** to the
   influence ledger. Nothing is hard-deleted; the append-only invariant holds.
3. **Enforcement levers:** `suspendedUntil` (temporary) and `bannedAt`
   (permanent) on users — write paths blocked, sign-in/browsing unaffected.
4. **Testimony screening:** hybrid — synchronous Haiku screen at submit;
   severe content (slurs, doxxing/PII, threats) is blocked (rating still posts,
   text dropped); borderline posts and is flagged; screen failure fails open
   (post + flag).

## Schema

### New table `reports`

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `reporterId` | uuid → users, not null | |
| `subjectKind` | new `report_subject` enum: `throne`, `rating` | |
| `subjectId` | uuid, not null | no FK — spans tables |
| `reason` | new `report_reason` enum: `wrong_info`, `closed`, `inappropriate`, `not_public_restroom`, `harassment`, `spam` | PRD §5.4's list + abuse categories |
| `note` | text, nullable | ≤280 chars, optional detail |
| `createdAt` | timestamptz default now | |

Unique index on `(reporterId, subjectKind, subjectId)` — one report per user
per subject. Index on `(subjectKind, subjectId)`.

### Soft-hide + enforcement columns

- `thrones`: `hiddenAt` timestamptz nullable, `hiddenBy` uuid → users nullable
- `ratings`: `testimony` text nullable (≤280 enforced in zod);
  `hiddenAt`/`hiddenBy`; `testimonyHiddenAt`/`testimonyHiddenBy`
- `users`: `suspendedUntil` timestamptz nullable, `bannedAt` timestamptz nullable

### Enum additions

- `review_kind` += `report`, `testimony`
- `influence_reason` += `reversal` (and the client `InfluenceEvent["reason"]`
  union in `src/lib/types.ts` gains `"reversal"`)

## Reports (#4)

- **`POST /api/report`** `{ subjectKind, subjectId, reason, note? }` — requires
  signed-in + age gate + good standing; subject must exist and not be hidden.
  Duplicate (same reporter/subject) → 409 themed ("You have already raised this
  banner"). Reports do NOT count toward the write rate ceiling (they're the
  safety valve; the unique constraint already caps abuse) — but a user's
  reports are capped at 20 per day (429 beyond).
- **Queue merging:** first report on a subject creates a `review_queue` row
  (kind `report`, severity low for `wrong_info`/`closed`, medium for the
  rest) and schedules AI triage. Subsequent reports on the same subject with a
  **pending** queue row append a `user_report` signal to that row's `signals`
  and escalate severity one step at 2+ distinct reporters (max high). New
  signal shape: `{ signal: "user_report", reason, reporterCount }`.
- Reported content **stays visible** until a moderator acts (non-punitive rule).

## Takedowns + reversal events (#4)

New module `src/lib/server/enforcement.ts`, moderator-only callers:

- **`hideThrone(throneId, moderator, note)`** — sets `hiddenAt/hiddenBy`;
  appends negated copies of **every** influence event with that `throneId`
  (reason `reversal`); ledger line: "⚖️ The Maesters strike **{name}** from the
  record." Hidden thrones: excluded from `realmPayload`, and rating/confirming
  them 404s.
- **`hideRating(ratingId, moderator, note)`** — sets `hiddenAt/hiddenBy` on the
  rating; appends negated copies of the influence events matching
  `(userId, throneId, createdAt = rating.createdAt)` (captures the rating/
  hearsay event and any first-of-name bonus); no public ledger line (a single
  rating's removal isn't news). Hidden ratings excluded from `realmPayload`
  (both score math and display).
- **`hideTestimony(ratingId, moderator, note)`** — sets `testimonyHiddenAt/By`
  only; rating, verdict, and influence all stand. Realm payload masks the text.
- **Reversal-event rule (the subtle part):** reversal rows copy the ORIGINAL
  event's `createdAt` (allowed — the append-only trigger blocks only
  UPDATE/DELETE). Because fief decay is `points * 0.98^daysSince(createdAt)`,
  a same-timestamp negation cancels exactly for all time. A "now"-dated
  reversal would under-correct.
- **Idempotence:** hiding an already-hidden subject is a no-op (409). Reversals
  are inserted exactly once per hide — guarded by checking for existing
  `reversal` events for that subject before inserting.
- **Rank XP:** `lifetimeXp` sums signed points, so reversals reduce rank XP
  automatically. Clamp at 0 in `mePayload` (`Math.max(0, xp)`) so a
  heavily-reversed account shows Peasant, not a negative-progress glitch.

## Account enforcement (#4)

- `suspendUser(userId, moderator, days, note)` → `suspendedUntil = now + days`
  (UI offers 7 or 30). `banUser(userId, moderator, note)` → `bannedAt = now`.
  `reinstateUser(userId, moderator)` clears both (mistakes happen).
- **`requireGoodStanding(user)`** in `src/lib/server/standing.ts` — checked in
  every write route beside `requireAgeGate`: banned → 403
  `{ error: "banished" }` ("You have been banished from the Realm."); suspended
  → 403 `{ error: "suspended", until }` themed ("The Realm bars its gates to
  you until {date}."). Reads stay open. Client surfaces both states on write
  attempts (error copy in the flows), no separate screen.
- No public ledger lines for account actions.

## Scroll of Testimony (#5)

- `SubmitRatingInput` gains `testimony?: string` (zod: trimmed, ≤280). Client:
  `SittingFlow` gets a 280-char textarea with rotating themed placeholders
  (PRD: "Speak, traveler. What horrors or wonders did you find?"), replacing
  the hardcoded `testimony: ""`; `store.tsx` stops stripping the field; display
  already exists in `ThroneSheet` (renders `r.testimony`).
- **Screening** (`src/lib/server/testimonyScreen.ts`): when non-empty testimony
  is submitted, ONE synchronous Haiku call (same `TRIAGE_MODEL` env pattern,
  structured output) returns
  `{ verdict: "allow" | "flag" | "block", category?: string, note: string }`.
  Categories for block: slur/hate, doxxing/personal-info, explicit threat.
  - **block** → rating persists WITHOUT the testimony; response carries
    `testimonyBlocked: true`; client shows "The Maester declines to record
    those words."; queue row (kind `testimony`, severity high) records the
    category and note but NEVER the blocked text.
  - **flag** → testimony persists and is public; queue row (kind `testimony`,
    severity medium) is created with `aiAssessment` pre-filled from the same
    call's note — no second AI call.
  - **allow** → nothing else happens.
  - **screen error / no API key** → fail open: testimony persists; queue row
    (kind `testimony`, severity medium) with signal `screen_unavailable`.
- The existing 24h update path (repeat rating) may update testimony too — the
  update runs the same screen.

## Moderator surface growth

`/moderation` queue items gain subject-appropriate actions (all via
**`POST /api/moderate`** `{ action, subjectKind, subjectId, days?, note? }`,
moderator-gated like `/api/review`):

- Actions: **Hide throne** / **Hide rating** / **Strike testimony** (as
  applicable to the row's subject), **Suspend 7d / 30d**, **Ban** (on the
  actor), and the existing **Resolve**.
- Enforcement actions auto-resolve the queue row with the action recorded in
  `resolutionNote` (prefixed, e.g. `[hide_rating] {note}`).
- The `window.prompt` note input is replaced by an inline text field on each
  card (carried-over polish item).
- Report rows display reason(s) + reporter count from `signals`.

## Client report UI (#4)

- `ThroneSheet`: a small "Report" affordance on the throne header and on each
  recent-rating row. Signed-in + attested users only (the buttons hide
  otherwise). Opens a compact modal: reason picker (radio, themed labels for
  the six reasons) + optional 280-char note + submit. Success shows a themed
  confirmation; duplicate shows the 409 message.

## Testing

Existing harness (`src/test/*`, both DBs migrated):

- Reversal math: hide a rating → fief control returns to pre-rating values at
  multiple `now` offsets (decay cancellation); hide a throne → all its events
  cancel; double-hide inserts no duplicate reversals; rank XP clamps at 0.
- Reports: dedupe 409; queue-row merge + severity escalation at 2 reporters;
  reported content still served.
- Standing: banned/suspended 403 codes on every write route; suspension expiry
  restores writes; reinstate clears.
- Testimony: block strips text + high queue row without the text; flag persists
  text + medium row with pre-filled assessment; allow is silent; screen error
  fails open; 280 cap; hidden testimony masked in realm payload.
- Realm filtering: hidden thrones/ratings absent; scores recompute without
  hidden ratings.
- Moderate API: role-gated 404; each action's effects; auto-resolve behavior.

Verify gate: full suite + build + live browser pass (report a throne → see the
merged queue row → strike testimony → suspend the test account → confirm 403 →
reinstate), then deploy with Larry's already-given approval.

## Out of scope (Cycle B / later)

- Photo pipeline (Cycle B spec: `2026-07-12-phase1-photo-pipeline-design.md`)
- Report notifications / 24h SLA tooling (needs email/notification infra —
  Phase 3)
- Appeals flow (PRD mentions report/appeal for businesses — post-launch)
- Moderator role-granting UI (SQL promotion stands)

## Execution model

Unchanged: Codex implements from the written plan; Claude reviews every diff,
runs installs/tests/migrations/browser verification, commits, and deploys
(deployment pre-authorized by Larry for this push).
