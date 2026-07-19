# Phase 5 · Metrics Instrumentation + Closed-Beta Cohort System — Spec + Plan

**Date:** 2026-07-18
**Status:** APPROVED — combined spec + implementation plan. Two features, both "launch ops."
**Goal:** (A) Instrument PRD §9 success metrics; (B) gate signups behind single-use invite codes tied to a cohort/city.

## Grounding (verified in code)
- Session/current-user in API routes: `import { sessionInfo } from "@/lib/server/session"`. `const info = await sessionInfo();` → `info.kind` (`"user"` | anon) and `info.user` (`{ id, displayName, role, houseId, ... }`). Moderator guard = `info.kind === "user" && info.user.role === "moderator"` (see `apps/web/src/lib/server/review.ts:30`).
- Route → server-payload → core-selector pattern: e.g. `apps/web/src/app/api/standings/route.ts` calls `standingsPayload()` in `apps/web/src/lib/server/standings.ts`, which uses pure selectors from `packages/core/src/standings.ts`. MIRROR this for metrics.
- User creation choke point: `createProfile(googleSubject, displayName, houseId)` in `apps/web/src/lib/server/profile.ts:18` — the ONLY place real users are inserted. Beta gate goes here.
- `users` table columns today: `id, googleSubject, displayName, houseId, role, badges, notifyPrefs, joinedAt, lastHouseSwitchAt, suspendedUntil, bannedAt`. Add `cohort`.
- `ratings` columns: `id, throneId, userId, verdict, tags, verified, createdAt` (+ testimony). `influence_events`: `id, fiefId, houseId, userId, points, reason, throneId, createdAt`.
- Client: `apps/web/src/components/SittingFlow.tsx` (rating flow — instrument time-to-rate), `apps/web/src/components/NearestWorthyButton.tsx` (NWT — instrument outcome), `apps/web/src/lib/api.ts` (API client).
- Migrations via `cd apps/web && npm run db:generate`; apply to test DB via `set -a; . ./.env.test; npx drizzle-kit migrate` (repo has `dotenv` lib, NOT `dotenv-cli`). Next migration numbers: 0008, then 0009.
- Tests: vitest. `cd packages/core && npx vitest run`; `cd apps/web && npx vitest run`. Typecheck: `npx tsc --noEmit` in each. Build: `cd apps/web && npm run build`.

---

# FEATURE A — Success-metrics instrumentation

## A0. Schema (migration 0008)
Add table `metrics_events`:
```ts
export const metricsEvents = pgTable(
  "metrics_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),                       // "time_to_rate" | "nwt_outcome"
    userId: uuid("user_id").references(() => users.id),  // nullable (anon allowed)
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("metrics_events_name_idx").on(t.name)]
);
```
Generate migration 0008, apply to TEST db. Commit.

## A1. Pure selectors — `packages/core/src/analytics.ts` (+ `analytics.test.ts`)
Define input row shapes locally (do NOT depend on Drizzle):
```ts
export interface AnalyticsRating { throneId: string; userId: string; verified: boolean; createdAt: number; }
export interface AnalyticsUser { id: string; houseId: HouseId; joinedAt: number; }
export interface AnalyticsInfluence { fiefId: string; houseId: HouseId; points: number; createdAt: number; }
export interface MetricEvent { name: string; userId: string | null; meta: Record<string, unknown>; createdAt: number; }
```
Functions (all pure, unit-tested with small fixtures):
1. `verifiedRatingsPerThronePerMonth(ratings: AnalyticsRating[], now: number): number` — verified ratings in the last 30 days ÷ distinct thrones rated (0 if none). Guard divide-by-zero.
2. `contributorPct(users: AnalyticsUser[], ratings: AnalyticsRating[]): number` — distinct rating userIds ÷ total users, 0..1 (0 if no users).
3. `d30RetentionByHouse(users: AnalyticsUser[], ratings: AnalyticsRating[], now: number): Map<HouseId, number>` — for users who joined ≥30d ago, fraction with ≥1 rating whose `createdAt` ≥ joinedAt+30d, grouped by house. (Approximate D30.)
4. `fiefsChangingHands(events: AnalyticsInfluence[], seasonStart: number, now: number): number` — replay influence chronologically within [seasonStart, now]; for each fief track the leading house by cumulative points; count transitions where the leader changes to a different house (initial assignment is not a change).
5. `avgTimeToRateMs(events: MetricEvent[]): number | null` — mean of `meta.ms` (number) over `time_to_rate` events; null if none.
6. `nwtSuccessRate(events: MetricEvent[]): number | null` — of `nwt_outcome` events, fraction with `meta.success === true`; null if none.

TDD each: write `analytics.test.ts` fixtures first (RED), implement (GREEN). Add `export * from "./analytics"` to `packages/core/src/index.ts`. Commit.

## A2. Server payload — `apps/web/src/lib/server/metrics.ts`
`export async function metricsPayload()`: load rows (`ratings`, `users`, `influenceEvents`, `metricsEvents`) mapping to the Analytics* shapes (dates → `.getTime()`), compute season window via existing `seasonWindow(now)` from `@sot/core`, and return:
```ts
{ verifiedRatingsPerThronePerMonth, contributorPct, d30RetentionByHouse: Record<HouseId, number>, fiefsChangingHands, avgTimeToRateMs, nwtSuccessRate, generatedAt }
```

## A3. Routes
- `GET /api/metrics` (`apps/web/src/app/api/metrics/route.ts`, `export const dynamic = "force-dynamic"`): `const info = await sessionInfo(); if (info.kind !== "user" || info.user.role !== "moderator") return NextResponse.json({ error: "forbidden" }, { status: 403 });` then `return NextResponse.json(await metricsPayload());`
- `POST /api/metrics/event` (`apps/web/src/app/api/metrics/event/route.ts`): body `{ name, meta }`. Validate `name` is one of `"time_to_rate" | "nwt_outcome"`; ignore/400 otherwise. `userId = info.kind === "user" ? info.user.id : null`. Insert into `metricsEvents`. Return `{ ok: true }`. Fail-soft: never throw to the client (wrap insert; on error still return ok:true so instrumentation never breaks UX). Add a small route test asserting 403 for non-moderator on GET and a bad `name` is rejected on POST.

## A4. Client capture (web)
- `apps/web/src/lib/api.ts`: add `export async function recordMetric(name: "time_to_rate" | "nwt_outcome", meta: Record<string, unknown>) { try { await fetch("/api/metrics/event", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ name, meta }) }); } catch {} }` (never throws).
- `SittingFlow.tsx`: capture a start timestamp when the rating flow opens (component mount / flow start), and on successful submit call `recordMetric("time_to_rate", { ms: Date.now() - start })`.
- `NearestWorthyButton.tsx`: when the user acts on the NWT result, call `recordMetric("nwt_outcome", { success: <did they proceed to a throne> })`. Use the simplest honest signal available in that component (e.g. success=true when a nearest throne was found and navigated to; success=false when none found). Keep it minimal.
- Mobile capture is a documented fast-follow (same endpoint) — NOT in this build.

---

# FEATURE B — Closed-beta invite/cohort system

## B0. Schema (migration 0009)
Add `users.cohort`: `cohort: text("cohort")` (nullable).
Add table `invites`:
```ts
export const invites = pgTable(
  "invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(),
    cohort: text("cohort").notNull(),                       // launch city
    createdBy: uuid("created_by").notNull().references(() => users.id),
    redeemedBy: uuid("redeemed_by").references(() => users.id),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("invites_redeemed_idx").on(t.redeemedBy)]
);
```
Generate migration 0009, apply to TEST db. Commit.

## B1. Invite-code generation helper — `packages/core/src/invites.ts` (+ test)
`export function generateInviteCode(rand: () => number = Math.random): string` — a readable code like `SOT-XXXX-XXXX` from an unambiguous alphabet (no 0/O/1/I). Pure, seedable via the `rand` param for tests. Unit-test format + that distinct rand streams differ. `export * from "./invites"` in the barrel.

## B2. Gate in `createProfile` (`apps/web/src/lib/server/profile.ts`)
- Add optional param: `createProfile(googleSubject, displayName, houseId, inviteCode?: string)`.
- Read flag: `const required = process.env.BETA_INVITE_REQUIRED === "true";`
- If `required`: look up an `invites` row where `code === inviteCode AND redeemedBy IS NULL`. If none → `throw new ProfileError("a valid invite is required for the closed beta", 403)`. Otherwise proceed; set `users.cohort` = the invite's cohort on insert, and after insert mark the invite redeemed via `UPDATE invites SET redeemed_by=$user, redeemed_at=now() WHERE id=$inviteId AND redeemed_by IS NULL`; if 0 rows updated (race), treat as already-taken (409).
- If NOT `required`: behave exactly as today (no invite needed, cohort stays null).
- Unit/integration test: with flag on, missing/used code → 403/409; valid code → user created with cohort set + invite marked redeemed. With flag off → works without a code.

## B3. Wire the caller
Find where `createProfile` is called (the profile-creation API route — grep for `createProfile(`). Thread an `inviteCode` field from the request body through to `createProfile`. Keep it optional so flag-off is unchanged.

## B4. Invite admin routes
- `POST /api/invites` (moderator-only): body `{ cohort: string, count: number }` (clamp count 1..500). Generate `count` unique codes (retry on unique collision), insert with `createdBy = info.user.id`. Return the created codes.
- `GET /api/invites` (moderator-only): return invites with redeemed status (optionally `?cohort=`). Include counts: total, redeemed, remaining.
- Route test: 403 for non-moderator.

## B5. Onboarding UI (web)
In the profile-creation / onboarding component (grep `createProfile` client call in `apps/web/src/lib/api.ts` + the onboarding component, likely `Onboarding.tsx`): add an "Invite code" text field, passed through to the create-profile API call; the server enforces. Label it "Invite code (if you have one)" / in-theme copy ("Present your token of passage"). Keep it optional client-side.

---

# BUILD ORDER (sequential — same schema.ts + migration journal)
1. Feature A: A0 → A1 → A2 → A3 → A4 (commit per lettered step).
2. Feature B: B0 → B1 → B2 → B3 → B4 → B5 (commit per step).
3. Green gate: core suite, web suite, tsc both, `next build`. All must pass. Commit any fixups.

# TESTING / DoD
- New pure selectors + invite-code helper: unit-tested (RED→GREEN).
- Route guards: tested for 403 on non-moderator (metrics GET, invites GET/POST).
- Gate: tested flag-on (403/409/success) and flag-off (unchanged).
- Green gate passes; migrations 0008+0009 generated and applied to TEST db (NOT prod — owner-gated).
- Metrics client capture is fail-soft (never breaks the rating/NWT UX).

# OUT OF SCOPE
Mobile metric capture (fast-follow, same endpoint); actually running the beta; picking the launch city; trademark clearance; a fancy metrics dashboard UI (JSON endpoint + moderator access is enough for beta — a view can come later).
