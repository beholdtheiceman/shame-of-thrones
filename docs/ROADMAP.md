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

- [ ] `ThroneSheet` currently shows a raw `4.2 / 5` score — PRD's intent is the tier name leads (e.g. "Fit for a Knight") so a bare number can't be misread as good-or-bad; add the tier label as the primary display, keep the number secondary
- [ ] Add a Fief control breakdown to the UI (e.g. House Flush 42% / House Bidet 38% / ...) — currently only the leading House's tint is shown on the map polygon; the per-House split is computed (`fiefControl` in `selectors.ts`) but never surfaced
- [ ] Build the "Plain Speech" accessibility toggle from PRD §6 — not implemented at all; functional info (hours, accessibility, access requirements) must already display plainly even in themed mode, so check that too while adding the toggle
- [ ] Full VoiceOver/TalkBack pass + WCAG AA contrast audit (PRD §6 accessibility requirement)
- [ ] Offline support: cache map tiles + last-known Throne data, queue-and-sync ratings when connectivity drops (PRD §7 — restrooms are basement-adjacent, connectivity will be bad)
- [ ] Privacy: confirm location handling stores only the proximity boolean + coarse geohash server-side, never a raw coordinate trail (needs to be re-verified once Phase 0's backend exists, and must be true in the App Store privacy label)

## Phase 3 — Retention systems (P1 per PRD, first 90 days post-launch)

- [ ] Notifications: opt-in categories, rate-limited to 1 territory push/day — "Fief Contested," "Banner has fallen," season start/rally, freshness quests
- [ ] Underdog Blessing balance mechanic (temporary Influence multiplier for trailing Houses below a share threshold), shown transparently in UI
- [ ] Titles & badges beyond the basic rank track ("First of Their Name," "The Cartographer," "Oathkeeper," "Breaker of Chains," "The Night's Watch")
- [ ] Streaks (consecutive weeks with ≥1 verified contribution) + earned-currency streak protection
- [ ] Leaderboards: per-Fief, per-Realm, per-House, weekly and seasonal (weekly boards matter for giving new users a winnable timeframe)
- [ ] Individual rank decay — prototype currently uses un-decayed lifetime XP (README gap #6); decide if quality-weighted decay is needed for the rank ladder to stay meaningful long-term

## Phase 4 — Ship on mobile

The prototype is a Next.js web app; the PRD calls for native iOS + Android.

- [ ] Decide: React Native/Flutter port (PRD's recommendation, one team both platforms) vs. shipping the existing web app as an installable PWA for longer and delaying native — worth a real build-vs-buy conversation before committing engineering time
- [ ] Mapbox migration if going native — PRD specifically calls for Mapbox over the prototype's Leaflet/OSM setup because custom fantasy map styling is a stated brand requirement
- [ ] Re-tune Fief hex resolution for real launch-city density — prototype uses H3 res-9 (~150m cells) tuned for a demo neighborhood; PRD target is res-7 (~1-2km); PRD open question #2 (fixed resolution vs. density-adaptive) needs an answer before this is locked

## Phase 5 — Data seeding & launch ops

- [ ] Phase 0 seeding per PRD §8: import Refuge Restrooms API, city open-data portals, OSM `amenity=toilets` for each launch city — an empty map kills the utility on day one, so this has to land before any real users show up
- [ ] Closed beta ("The Small Council"): 1 city, ~500 users, 4 Houses — validate the 20s rating flow and moderation pipeline under real load
- [ ] Pick the 2-3 launch cities (dense, walkable — PRD suggests NYC/Chicago/Austin) — territory games need density, so this isn't just a marketing choice
- [ ] Instrument the PRD §9 success metrics from day one of beta (verified ratings/Throne/month, time-to-rate, contributor %, D30 retention by House, Nearest-Worthy-Throne success rate, Fiefs changing hands per season) — these need to be measurable before beta starts, not bolted on after

## Phase 6 — Monetization (P2 — design only, don't build yet)

- [ ] Spec cosmetics (Banner styles, sigils, map themes) and the Maester's Pass seasonal track
- [ ] Hold the line from PRD §5.10: no Influence multipliers for money, no ads in the panic-button flow, no venue-paid score boosts — these are brand-integrity constraints, not just nice-to-haves, worth keeping visible so a future roadmap pass doesn't quietly cross them

---

## Open questions to resolve before they block a phase above

Carried over from PRD §11 — flagging where each one actually bites:

1. **Name/trademark clearance** — blocks Phase 1 (safety/legal) and all of Phase 5 (can't market a launch under a name that might not survive counsel)
2. **Fief hex resolution** (fixed vs. adaptive) — blocks Phase 4's Mapbox/production re-tune
3. **Hearsay ratings in v1 or verified-only** — affects Phase 1's anti-gaming scope and Phase 2's score display logic
4. **Season length (8 weeks assumed)** — needs beta retention data from Phase 5 before locking
5. **Paid/customers-only restroom scoring fairness** — affects the rating flow copy and scoring model, cheap to decide early in Phase 2
6. **Municipal data partnerships** — not on the critical path for any phase above; revisit post-launch
