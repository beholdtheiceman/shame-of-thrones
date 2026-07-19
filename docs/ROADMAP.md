# Shame of Thrones — Roadmap to v1

Status check as of 2026-07-08: the repo has a full PRD (`SHAME_OF_THRONES_PRD.md`)
and a **single-user, client-side, web-only prototype** that proves the core
loop (map → rate → territory shift → rank). Everything below is what stands
between that prototype and the PRD's actual P0 launch bar. Ordered roughly in
the sequence I'd build it — each phase assumes the ones above it are done.

Checkboxes are for tracking; check them off as work lands.

---

## Phase 0 — Backend foundation

Nothing past this point works with users on different devices until this exists.

**Done (see `docs/superpowers/`): shipped the multi-user backend — Postgres/PostGIS
via Drizzle, Auth.js Google sign-in, the six-endpoint API, and the API-backed client.**

- [x] Stand up Postgres + PostGIS for Thrones, ratings, users, Fief geometry (Neon)
- [ ] ~~Stand up Redis for leaderboards and live Fief influence counters~~ — **deliberately deferred**: at dev scale Postgres computes leaderboards/counters directly from the ledger; Redis is a performance optimization for later
- [x] Design the **append-only Influence ledger** — done as a Postgres table guarded by a row-level trigger; the server reuses `src/lib/selectors.ts` decay/control/rank math directly (parity pinned by characterization tests)
- [x] Auth: Sign in with Google + anonymous "Wandering Peasant" read-only mode (Apple deferred to the native-mobile phase)
- [x] API layer between client and DB — REST route handlers under `src/app/api/*`; `src/lib/store.tsx` is now an API client keeping the same `useStore()` interface
- [ ] Scheduled jobs: ~~daily decay tick~~ (**not needed** — decay is a read-time computation, `points * 0.98^days`), season rollover (**deferred** — seasons stay cosmetic this phase)
- [x] Migrate seed data (`src/lib/data.ts`) into the real DB as the Phase-0 seeding dataset (`src/db/seed.ts`)

## Phase 1 — Trust & safety (launch-blocking, per PRD §5.8)

None of this exists in the prototype yet — it's the biggest gap between demo and shippable product.

- [x] Photo upload pipeline with automated NSFW/person-detection classification, auto-reject on any detected face, human review queue before public visibility — **shipped**: Claude-vision classification at upload (fail-closed — unclassifiable photos stay invisible), NSFW bytes wiped on rejection, every photo requires human approval on `/moderation` before ANY public visibility, all serving through one status-checking route. EXIF stripping is a pre-native-app TODO (web file pickers generally strip GPS already).
- [x] Enforce photo policy in the add-photo flow copy (entrance/signage/sink only) — **shipped**: "Entrances, signage, and sinks only. No people — any face means rejection." baked into the Offer-a-Portrait UI; zero-tolerance ban lever available via the enforcement system.
- [x] Text moderation: profanity/harassment/doxxing filters on Scroll of Testimony reviews — **shipped**: 280-char testimony with a synchronous AI screen (severe content blocked at submit, borderline posts + flags to the queue, fail-open on screen outage). Vulgar-but-benign bathroom humor is explicitly allowed by the screen prompt.
- [x] Report flow on every piece of UGC (throne, rating, photo) + moderator tooling with a 24h SLA target — **shipped for thrones/ratings** (photos join in the photo-pipeline cycle): report buttons + reason picker, per-reporter dedupe, queue merging with severity escalation; moderator takedowns (hide throne/rating, strike testimony) claw back Influence via append-only reversal events; account suspend/ban/reinstate levers. 24h-SLA *notification* tooling awaits Phase 3 infra.
- [x] Anti-gaming: GPS-spoof heuristics (impossible travel speed, mock-location flags), per-user/device/IP rate limits, new-account Influence ramp (accounts <7 days = 50% Influence) — **shipped as the non-punitive signals + review-queue system** (heuristics flag, never reject; two-threshold rate limits; ramp applied server-side). Device/IP-level limits and mock-location flags await native clients. AI triage (Claude API) annotates every flagged item for `/moderation`.
- [x] Fix the self-serve confirmation gap: PRD requires a **second, distinct user** to confirm a Rumored Throne; the prototype currently lets you confirm your own addition (README gap #2) — **shipped in Phase 0**: `confirmThrone` rejects the adder ("a throne cannot vouch for itself"), test-covered; box was stale
- [x] Private-residence exclusion on Add-a-Throne (venue category picker, no "residence" option, elevated review near residential parcels) — **shipped**: required publicly-accessible attestation + every new throne enters the review queue for human eyes. Parcel-proximity checks are out of scope pending a parcel data source.
- [x] COPPA 13+ age gate at signup — **shipped**: neutral birthdate screen before profile creation; only an over-13 boolean + timestamp stored (never the birthdate); under-13 locks persistently by Google subject
- [ ] Legal: trademark clearance on "Shame of Thrones" and House names before locking branding (PRD §11, open question #1 — this can run in parallel starting now, since it can take a while and blocks marketing)

## Phase 2 — Close the UI gaps found in review

Smaller, but these are real product bugs against the PRD, not just polish.

- [x] `ThroneSheet` currently shows a raw `4.2 / 5` score — **shipped**: tier chip (glyph + name, e.g. "🏰 Fit for a Knight") leads the chip row; the number is secondary (`tierForScore` in `selectors.ts`)
- [x] Add a Fief control breakdown to the UI — **shipped**: tapping a fief polygon opens a bottom card with all four Houses' share bars + Contested badge (`FiefCard`, fed by `fiefCardModel`)
- [x] Build the "Plain Speech" accessibility toggle from PRD §6 — **shipped**: header Aa toggle, client copy dictionary (`src/lib/copy.tsx`), plain tier labels; game identity (Houses/ranks/Ledger) stays themed by design; functional info verified plain in both modes
- [x] ~~Full VoiceOver/TalkBack pass +~~ WCAG AA contrast audit — **shipped at code level**: contrast-fixed palette (ratios in the cycle-2 spec), axe-core clean, dialog semantics/focus/Esc, named map markers, zoom re-enabled. Hardware VoiceOver/TalkBack pass deferred to Phase 4 (native)
- [x] Offline support — **shipped**: hand-rolled service worker (viewed tiles cache-first capped at 1,500; offline app shell; `/api/*` never cached), last-known realm snapshot with offline banner, ratings queue-and-sync on reconnect (ratings only; 4xx drops surface a notice). Sync-time timestamps by design (client stamps would be a gaming vector)
- [x] Privacy: confirm location handling stores only the proximity boolean + coarse geohash server-side, never a raw coordinate trail — **audited 2026-07-12** (findings in the phase2-display-gaps spec): user coordinates never reach the server at all (proximity computed on-device); the one gap found — photo EXIF/GPS surviving upload — was fixed the same day (sharp re-encode strips all metadata)

## Phase 3 — Retention systems (P1 per PRD, first 90 days post-launch)

- [x] Notifications (in-app) — **in-app inbox BUILT (2026-07-13), committed locally, NOT pushed**: `notifications` table + `users.notifyPrefs` (migration `0005`, applied to the TEST DB only), pure `notificationsFor` selector, generation at `submitRating` (Banner-fallen/Contested, run **after** the tx commits + error-swallowed) + lazy season_start on read, 24h dedupe = the ≤1/day rate limit, `GET/POST /api/notifications`, header bell + panel + `notifyPrefs` toggles. 179/179 tests + build green. **⚠️ Before deploy: apply migration `0005` to the PROD Neon DB, or the deploy breaks.** **Web Push transport still deferred** — needs owner-set VAPID env vars (`docs/superpowers/specs/2026-07-13-phase3-notifications-design.md` step 6). Freshness-quest notifications also deferred (no quest system).
- [x] Underdog Blessing balance mechanic — **shipped (Cycle C, 2026-07-13)**: a House whose current Realm influence share < 15% earns **×1.25** on rating Influence (`UNDERDOG` in `rules.ts` → `underdogMultiplier`, applied to already-ramped points). Self-correcting rubber-band; **no blessing on an empty Realm** (no leader to trail). Transparent: a "Blessed ×1.25" tag on House Standings + an "Underdog Blessing applied" note in the rating feedback. Confirmation-award blessing + hysteresis deferred. Notifications split to their own session.
- [x] Titles & badges beyond the basic rank track — **shipped (Cycle B, 2026-07-13)**: badges unified to a **computed-on-read** model (`src/lib/recognition.ts` → `earnedBadges`, surfaced via `mePayload`), auto-backfilling existing users and retiring the old scattered `users.badges` writes. Live: "First of Their Name," "The Cartographer," **"Oathkeeper"** (4-week streak), **"The Night's Watch"** (rating before 05:00 UTC). ~~"Breaker of Chains"~~ **deferred** — needs a validated moderation-outcome signal that doesn't exist yet.
- [x] Streaks — **shipped (Cycle B)**: `currentStreak` counts consecutive Mon-00:00-UTC weeks with ≥1 verified rating; ProfilePanel shows "🔥 N-week streak" + an at-risk hint. ~~earned-currency streak protection~~ **deferred** — no currency economy exists yet.
- [x] Leaderboards: ~~per-Fief~~, per-Realm, per-House, weekly and seasonal — **shipped (Cycle A, 2026-07-13)**: a "Standings" tab with **The Small Council** (individual board, realm-wide, Week/Season/All-Time × All-Houses/My-House filter — the My-House filter covers per-House) and **House Standings** (four Houses by current decayed realm Influence + fiefs led). Pure `src/lib/standings.ts` selectors over the influence ledger, one `/api/standings` route, no schema change. Per-Fief *individual* boards deferred (FiefCard already shows per-fief House shares). Week = Mon 00:00 UTC reset; Season = fixed 8-week epoch (no rollover job); soft-reset stays deferred.
- [x] Individual rank decay — **resolved as a deliberate NO (Cycle A)**: rank stays lifetime/undecayed (README gap #6 closed). Rationale (spec D1): PRD splits decaying *Influence* (territory) from *lifetime* rank (reputation); rank-loss is a retention killer and this phase is *for* retention; territory decay already supplies contribution pressure. Quality-weighting limited to free reversal-netting; helpful-vote weighting stays its own P1 item.

## Phase 4 — Ship on mobile

**BUILT + SHIPPED TO PRODUCTION (2026-07-15).** React Native + Expo app (monorepo:
`apps/web` + `apps/mobile` + `@sot/core`) — native Google auth, Mapbox map + the
~20s rating loop, Standings/Profile/notification-inbox, Expo push. Merged to `main`;
prod (`shame-of-thrones.vercel.app`) now serves the monorepo, `/api/health` green,
prod migration `0006` applied. A standalone Android build installs, launches, and runs.

- [x] Decide RN vs Flutter vs PWA → **React Native + Expo (SDK 57)**, full monorepo, one codebase both platforms
- [x] Mapbox migration → **`@rnmapbox/maps`** (dark-v11 style, throne markers + fief polygons)
- [x] Re-tune Fief hex resolution res-9 → res-7 for launch-city density — **DONE (2026-07-18, on `main` local, not deployed)**: `FIEF_RESOLUTION` 9→7 in `packages/core/src/geo.ts`. Paired with the Phase-5 seeding pipeline as planned. PRD open Q2 resolved as **res-7 fixed** (not density-adaptive). ⚠️ Deploying this to prod requires wiping+reseeding demo fiefs (existing prod influence is res-9) — part of the owner-gated cutover.

**Open QA bugs (on-device, both config/code — no architecture left):**
- [ ] Map tiles gray on the **first** cold launch, fine on relaunch — token is valid (200 from Mapbox), first-run init race; fix set the token at app entry, pending on-device verify
- [ ] Android Google sign-in `DEVELOPER_ERROR` — needs an **Android OAuth client** created with the EAS keystore SHA-1 (config-only, no rebuild)
- [ ] iOS build not yet attempted (needs a paid Apple Developer account)

## Phase 5 — Data seeding & launch ops

**Engineering largely built (2026-07-18), NOT deployed.** Three of the four
workstreams are code-complete on `main` (local, 21 commits ahead of origin);
what remains is owner-gated ops (prod migrations + deploy + reseed), a product
call (launch city), legal (trademark), and running the actual beta. (Naming note:
the `docs/phase5-*` / session "Phase 5" referred to *deploying* the Phase 4 mobile
app — that's done. This roadmap phase is real restroom data + closed beta.)

- [x] Phase 0 seeding per PRD §8: import Refuge Restrooms API + OSM `amenity=toilets` — **pipeline BUILT + verified (green gate + live Austin dry-run), not yet run on prod**. CLI `seed:city` (Refuge+OSM fetch → 25m dedup → idempotent upsert) + `seed:reset` (guarded demo wipe). Spec/plan: `docs/superpowers/{specs,plans}/2026-07-18-phase5-seeding-retune*`. City open-data portals deferred (Refuge+OSM cover the launch cities). ⚠️ Going live is owner-gated: apply migration 0007 to prod, pick a city, `seed:reset --yes` + `seed:city`.
- [x] Instrument the PRD §9 success metrics — **BUILT (2026-07-18, not deployed)**: 6 pure selectors in `@sot/core/analytics.ts` (verified ratings/Throne/month, contributor %, D30 retention by House, Fiefs changing hands/season computed from existing data; time-to-rate + Nearest-Worthy-Throne success from a new `metrics_events` table). Moderator-only `GET /api/metrics`; fail-soft `POST /api/metrics/event`; web client capture wired (mobile capture is a documented fast-follow, same endpoint). Migration 0008. Plan: `docs/superpowers/plans/2026-07-18-phase5-metrics-and-beta.md`.
- [x] Closed-beta **system** ("The Small Council"): **invite/cohort infrastructure BUILT (2026-07-18, not deployed)** — `invites` table + `users.cohort` (migration 0009), single-use `SOT-XXXX-XXXX` codes, flag-gated (`BETA_INVITE_REQUIRED`, off by default) gate in `createProfile`, moderator `POST/GET /api/invites`, onboarding invite field. **Actually running the beta (1 city, ~500 users, validate 20s flow + moderation under load) is still ahead** and needs deploy + real users. Known follow-up: invite-redeem race can leave a phantom user row (wrap insert+redeem in a tx).
- [ ] Pick the 2-3 launch cities (dense, walkable — PRD suggests NYC/Chicago/Austin) — **product decision, still open**. The seeding pipeline is city-agnostic (`--city`/`--bbox`), so this only blocks the actual seed run, not the code.

## Phase 6 — Monetization (P2)

**Scope change (2026-07-19):** owner elected to **design + build with payments** rather than
design-only. Spec + M1a plan: `docs/superpowers/{specs,plans}/2026-07-19-phase6-*`. Payment
rail = **RevenueCat + native IAP**; flagship = **Banner styles**; **no virtual currency**;
staged as M1 (banner styles à la carte) → M2 (Maester's Pass).

- [x] Spec cosmetics (Banner styles, sigils, map themes) and the Maester's Pass seasonal track — **spec written**; M1 ships banner styles, other categories scaffolded in `@sot/core` (no SKUs yet)
- [x] **M1a — cosmetics foundation BUILT & green (276 tests), merged to LOCAL main 2026-07-19, NOT pushed.** `@sot/core` catalog + equip logic; `entitlements` table + `users.equipped` (migration `0010`, applied to dev+test Neon only); RevenueCat webhook (idempotent grant/revoke, auth-gated); ownership-gated equip route + moderator grant route; `mePayload.cosmetics`; web `BannerCrest` + `/treasury` store + Profile render. ⚠️ Prod cutover owner-gated: apply migration `0010` to prod, set up RevenueCat project + App Store/Play products + `REVENUECAT_WEBHOOK_AUTH`, then push.
- [ ] **M1b (pending owner deps)** — mobile RevenueCat SDK purchase UI (`react-native-purchases`); banner render on Standings / ThroneSheet / rating-strike; constant-time webhook-auth compare (currently `===`)
- [ ] **M2 — Maester's Pass** — free + paid ($4.99/season) track over the existing 56-day `seasonWindow`, cosmetic-only progression; designed (spec §6), not built
- [x] Hold the line from PRD §5.10: no Influence multipliers for money, no ads in the panic-button flow, no venue-paid score boosts — **enforced with a guardrail test** (no cosmetic SKU maps to an influence reason; the entitlement path writes zero `influence_events`; no store/upsell in any rating or crisis flow)

---

## Open questions to resolve before they block a phase above

Carried over from PRD §11 — flagging where each one actually bites:

1. **Name/trademark clearance** — blocks Phase 1 (safety/legal) and all of Phase 5 (can't market a launch under a name that might not survive counsel)
2. **Fief hex resolution** (fixed vs. adaptive) — blocks Phase 4's Mapbox/production re-tune
3. **Hearsay ratings in v1 or verified-only** — affects Phase 1's anti-gaming scope and Phase 2's score display logic
4. **Season length (8 weeks assumed)** — needs beta retention data from Phase 5 before locking
5. **Paid/customers-only restroom scoring fairness** — affects the rating flow copy and scoring model, cheap to decide early in Phase 2
6. **Municipal data partnerships** — not on the critical path for any phase above; revisit post-launch
