# Phase 1, Sub-project 3 (Cycle B) — Photo Pipeline

**Date:** 2026-07-12
**Status:** Approved design (Larry approved the combined Cycle A+B design 2026-07-12)
**Depends on:** Cycle A (ban lever for the PRD's zero-tolerance rule; moderation
UI actions), sub-project 1 (queue + triage + `/moderation`)

## Goal

The last engineering piece of ROADMAP Phase 1: photo uploads on thrones with
the PRD §5.8 hard rules enforced — entrance/signage/sink only, automated
person/NSFW classification, auto-reject on any detected person, human review
before ANY public visibility, zero unmoderated public photos.

Infrastructure decisions (locked with Larry): no new vendor accounts —
**Claude vision** (Haiku via the existing `ANTHROPIC_API_KEY`) for
classification. Storage amendment at implementation (2026-07-12): photo bytes
live in **Postgres (bytea)** behind a `PhotoStore` interface rather than Vercel
Blob. Rationale: private-by-construction (the PRD's "nothing public
unmoderated" is enforced by one API route), no dashboard setup step or extra
token, and trivially testable. At a 5MB cap and dev-scale volume Neon handles
this comfortably; the interface makes a Vercel Blob swap a one-file change
when volume demands it.

## Schema

### New table `photos`

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `throneId` | uuid → thrones, not null | |
| `uploadedBy` | uuid → users, not null | |
| `bytes` | bytea (drizzle `customType`), not null | the image itself — served ONLY through the status-checking API route |
| `contentType` | text, not null | `image/jpeg`, `image/png`, `image/webp` |
| `status` | new `photo_status` enum: `pending`, `approved`, `rejected` | default `pending` |
| `aiVerdict` | jsonb, nullable | `{ personDetected, nsfw, relevant, note }` from classification |
| `rejectedReason` | text, nullable | e.g. `person_detected`, `nsfw`, moderator note |
| `reviewedBy` | uuid → users, nullable | |
| `reviewedAt` | timestamptz, nullable | |
| `createdAt` | timestamptz default now | |

Index on `(throneId, status)`. `review_kind` enum += `photo`.
`report_subject` enum += `photo` (photos become reportable like other UGC).

## Upload flow

- **`POST /api/photos`** — multipart upload (server route). Requires signed-in
  + age gate + good standing + the shared hard write ceiling. Validates: throne
  exists and isn't hidden; content type in the allowlist; ≤5MB; max 3 photos
  per user per throne; max 10 pending photos per user (backlog cap).
- Server stores the bytes in the `photos` row (bytea). No new dependency, no
  token, no store setup.
- UI: an "Offer a Portrait" section on `ThroneSheet` with the PRD policy copy
  baked in: "Entrances, signage, and sinks only. No people — any face means
  rejection." File picker → preview → upload → "awaits the Maesters' review"
  state. Uploaders can see their own pending/rejected photos on the sheet;
  the public sees only `approved`.

## Classification (automated, immediately after upload)

`src/lib/server/photoScreen.ts`, called synchronously in the upload route
(vision adds ~2s to an already multi-second upload — acceptable):

- ONE Haiku vision call with the image (base64) and structured output:
  `{ personDetected: boolean, nsfw: boolean, relevant: boolean, note: string }`
  — `relevant` = looks like a restroom entrance/signage/sink area.
- **`personDetected` or `nsfw`** → status `rejected`, `rejectedReason` set;
  queue row (kind `photo`, severity high) so moderators see the pattern —
  PRD's zero tolerance means a moderator can follow up with the Cycle A ban
  lever on verified violations. For `nsfw` the stored bytes are immediately
  replaced with an empty buffer (nothing retained); `person_detected` bytes
  are kept so moderators can audit benign mistakes (visible only via the
  moderator/uploader serving path).
- **passes** → status stays `pending`, queue row (kind `photo`, severity low
  when `relevant`, medium when not) with the AI note pre-filled — the photo is
  NOT public.
- **classification error / no key** → **fail closed** (opposite of testimony —
  the PRD's "no photo appears publicly unmoderated" is non-negotiable, and a
  pending photo is invisible anyway): status stays `pending`, queue row with
  `screen_unavailable` signal; the moderator review is the backstop.

## Serving + human review

- **`GET /api/photos/[id]`** streams the blob ONLY if status is `approved`, or
  the requester is a moderator, or the requester is the uploader (so users see
  their own pending/rejected thumbnails). Everything routes through this check —
  private blobs have no public URLs, so nothing unmoderated can leak.
- `realmPayload` throne DTOs gain `photoCount` (approved only); `ThroneSheet`
  fetches `GET /api/thrones/[id]/photos` (approved list + own photos) lazily.
- `/moderation`: photo queue rows render the image inline (via the moderator
  path of `GET /api/photos/[id]`) with **Approve** / **Reject** actions
  (`POST /api/moderate` gains `approve_photo` / `reject_photo`); reject deletes
  nothing (blob + row kept, status `rejected`). Approve sets status + stamps
  reviewer. Both auto-resolve the queue row.

## Testing

- Upload validation: type/size/caps/hidden-throne rejection; good-standing gate.
- Classification dispatch with a fake vision client: person → rejected + high
  queue row; nsfw → rejected + blob delete called; pass → pending + low row;
  error → pending + `screen_unavailable` (fail closed = stays non-public).
- Serving authz: anonymous gets only approved; uploader sees own pending;
  moderator sees all; direct blob access impossible (private store).
- Moderate actions: approve/reject flip status, stamp reviewer, auto-resolve.
- The vision client is the only mock seam needed (`VisionClient` interface,
  same pattern as `ScreenClient`/`TriageClient`); storage is plain DB rows,
  tested directly.

Verify gate: suite + build + live browser pass (upload a clearly-compliant
photo → pending → approve on `/moderation` → visible on the ThroneSheet;
upload a photo of a person → auto-rejected). Deploy pre-authorized.

## Out of scope

- Automated blob-retention cleanup jobs (dev scale; revisit with Phase 3 jobs)
- EXIF stripping (web file pickers usually strip GPS EXIF already; must be
  revisited before the native-app phase where camera uploads carry it)
- Appeals UX for rejected photos (queue note only this phase)

## Setup prerequisite

None — the bytea storage amendment removed the Blob store setup entirely. The
existing `ANTHROPIC_API_KEY` covers classification. (When photo volume ever
justifies it, swapping `PhotoStore` to Vercel Blob is a one-file change plus
the store creation click-through.)
