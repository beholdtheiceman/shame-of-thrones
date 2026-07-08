# Shame of Thrones — Product Requirements Document

**"When you gotta go, you win or you die… of embarrassment."**

| | |
|---|---|
| **Product** | Shame of Thrones (mobile app, iOS + Android) |
| **Version** | PRD v1.0 — Draft |
| **Author** | Larry |
| **Date** | 2026-07-08 |
| **Status** | Draft for review |

---

## 1. Overview

### 1.1 One-liner

Shame of Thrones is a fantasy-themed mobile app for finding and rating public restrooms ("Thrones"), where users pledge allegiance to Houses and conquer real-world territory through the quality and volume of their ratings.

### 1.2 The problem

Finding a decent public restroom is a universal, urgent, and weirdly underserved problem. Existing solutions (Google Maps reviews, a handful of utility apps) are:

- **Sparse** — restroom data is a review afterthought, buried under restaurant ratings.
- **Stale** — a restroom that was clean in 2023 tells you nothing about today.
- **Boring** — nobody is motivated to review a restroom. There is no reason to contribute, so coverage never reaches critical mass.

The core insight: **restroom data has a contribution problem, not a demand problem.** Everyone needs the data; nobody wants to create it. The fix is to make contributing genuinely fun.

### 1.3 The solution

Wrap the utility (a crowd-sourced restroom map) in a game (fantasy territory conquest). Every rating is both a public service and a strategic move for your House. The game drives contribution volume; contribution volume makes the utility actually useful; the utility brings in users the game can convert.

### 1.4 Why "fantasy"?

The theme does real work — it isn't just a skin:

- **Territory conquest** gives ratings a persistent, visible consequence, which one-off point systems don't.
- **Houses** create team identity, which drives retention far better than solo leaderboards.
- **Tone** — reviewing restrooms is inherently a little embarrassing. A tongue-in-cheek medieval register ("This privy is unworthy of the Realm") gives users a persona to hide behind, lowering the social cost of contributing.

---

## 2. Goals & Non-Goals

### 2.1 Goals

1. Become the most complete, most current public restroom map in launch cities.
2. Make rating a restroom take **under 20 seconds** and feel like a move in a game.
3. Build durable retention through House identity and territory seasons.
4. Keep the core utility (find a good restroom near me, right now) fully usable **without** engaging with the game at all.

### 2.2 Non-Goals (v1)

- No user-to-user chat or DMs (moderation cost, safety risk; House message boards are post-v1).
- No business/venue accounts or paid placement.
- No indoor navigation or restroom-stall-level detail.
- No coverage outside launch cities at launch (the map works anywhere, but game features may be sparse).
- No real-money wagering on territory outcomes. Ever.

---

## 3. Target users & personas

| Persona | Description | Primary need |
|---|---|---|
| **The Desperate Traveler** | Tourist, delivery driver, rideshare driver, parent with a toddler | Find a usable throne *right now*. Utility-only user; may never touch the game. |
| **The Knight-Errant** | 18–34 urban commuter, plays Pokémon GO-likes, loves low-stakes competition | A reason to open the app daily; visible progress; team belonging. |
| **The Maester** | Completionist reviewer type (top Yelp/Google Local Guides energy) | Status, recognition, and authority. Wants their reviews to *matter*. |
| **The Lord/Lady Commander** | Community organizer personality | Runs a House chapter, coordinates "campaigns" to flip territory. Tiny segment, massive output. |

Adoption model: Desperate Travelers provide demand and discover the app via search/store ("public restroom near me"). Knights-Errant provide rating volume. Maesters provide rating quality. Commanders provide coordination and virality.

---

## 4. Core concepts & glossary

| Term | Meaning |
|---|---|
| **Throne** | A public restroom (any publicly accessible restroom: park, café, mall, station, library, gas station). |
| **Quest / Sitting** | The act of visiting and rating a Throne. |
| **Rating** | The structured review a user leaves (see §5.3). |
| **House** | A team/faction users pledge to. v1 ships with 4–6 pre-made Houses with distinct identities and sigils. |
| **Fief** | A geographic territory cell (see §5.5). The unit of conquest. |
| **Banner** | House control marker displayed on a Fief. |
| **Influence** | Points a rating contributes toward House control of the Fief containing that Throne. |
| **The Realm** | The full map — all Fiefs in a region/city. |
| **Season** | A fixed competitive period (default 8 weeks) after which territory scores are crowned and soft-reset. |
| **Porcelain Crown** | Seasonal award to the House controlling the most Fiefs in a Realm. |
| **Grand Maester rank** | Individual reputation track (separate from House competition). |
| **Shame Score** | The 1–5 quality score of a Throne, inverted for flavor: terrible restrooms accrue "Shame." |

---

## 5. Product requirements

Priorities: **P0** = required for launch, **P1** = fast follow (first 90 days), **P2** = later.

### 5.1 Onboarding (P0)

- Sign in with Apple / Google; anonymous **"Wandering Peasant"** mode allows browsing the map and reading ratings without an account. Rating requires an account (accountability + anti-abuse).
- A short (≤3 screen) sorting ceremony assigns or lets the user choose a House. Choice is free; **switching Houses is allowed once per Season** (prevents mercenary flipping, allows fixing a bad first pick).
- House selection shows live House stats per Realm so users can choose underdogs (see §5.6 balance mechanics).
- Location permission requested with a clear value exchange ("To reveal the Thrones of your Realm…"). App must degrade gracefully to manual map browsing if denied.

### 5.2 The Map / "The Realm" (P0)

The map is the home screen.

- Standard map view with Throne pins. Pin badge encodes the current Shame Score (color + icon) at a glance.
- Fief overlay toggle: shows territory boundaries tinted by controlling House, with Banner sigils on controlled Fiefs.
- **"NEAREST WORTHY THRONE"** button — the panic button. One tap: routes the user to the closest Throne with score ≥ 3.5 that is currently open, honoring filters (see below). This is the single most important interaction in the app and must work in ≤2 taps from cold start.
- Filters (persisted): accessible/ADA, baby changing station, gender-neutral, free vs. customers-only, open now, 24-hour.
- Throne detail sheet: score breakdown, recent ratings, photos of the *entrance/signage only* (see §5.8), amenities, hours, "last confirmed" freshness timestamp, and controlling House.

### 5.3 Rating a Throne — "The Sitting" (P0)

The contribution flow. Target: **≤20 seconds, one thumb.**

1. **Proximity check** — user must be within ~75m of the Throne (GPS) to submit a standard rating. Remote ratings are allowed but flagged as "Hearsay" and carry reduced Influence and reduced weight in the Shame Score.
2. **Overall verdict** — 1–5 on the throne scale, with themed labels:
   - 1 ⚔️ *"The Dungeon"* — abandon all hope
   - 2 💀 *"Peasant's Privy"* — survivable, barely
   - 3 🛡️ *"Soldier's Rest"* — does the job
   - 4 🏰 *"Fit for a Knight"* — genuinely nice
   - 5 👑 *"The Iron Throne"* — a destination in itself
3. **Quick tags** (optional, multi-select chips): Clean / Stocked / Smells like victory / Smells like defeat / Door lock broken / No soap (a war crime) / Hot water / Line too long / Needs a key / Hidden gem.
4. **Scroll of Testimony** (optional): free-text review, 280 char cap. Themed placeholder text rotates ("Speak, traveler. What horrors or wonders did you find?").
5. **Photo** (optional): entrance/signage/sink area only — flow copy explicitly instructs this; all photos pass moderation before public display (§5.8).
6. Submit → **Influence animation**: the user's Banner strikes the Fief, updated Fief control bar shown. This is the dopamine moment; it must feel great.

Additional contribution actions (P0):
- **Add a Throne** — pin + name + amenities + access type. New Thrones enter "Rumored" state until confirmed by a second distinct user or a moderator (prevents fake locations).
- **Confirm/Deny** — lightweight "still exists / still open / permanently closed?" one-tap prompts shown to users near stale Thrones. Confirmations grant small Influence; this is the freshness engine.
- **Report** — wrong info, closed, inappropriate content, not a public restroom.

### 5.4 Rating quality & decay (P0)

- Throne Shame Score = weighted average where **recent ratings dominate**: weights decay with a ~60-day half-life. A restroom's past glory fades; the map reflects *now*.
- Verified (proximity-passed) ratings weigh 3× Hearsay ratings.
- A Throne with no rating or confirmation in 120 days is visually marked "Forgotten by the Realm" (desaturated pin) and prompts nearby users to re-confirm.
- One standard rating per user per Throne per 24h. Repeat visits update rather than stack (prevents grinding a single toilet to farm Influence).

### 5.5 Territory system — Fiefs (P0)

- The Realm is partitioned into Fiefs using a hex grid (H3, resolution ~7 in cities: roughly 1–2 km across). Hexes are legible, look great on a fantasy map, and avoid gerrymandered neighborhood-boundary disputes.
- Each Fief has a per-House **Influence total** for the current Season. The House with the highest total holds the Fief and flies its Banner.
- Influence sources:
  | Action | Influence |
  |---|---|
  | Verified rating of a Throne in the Fief | 10 |
  | First-ever rating of a Throne ("First of Their Name" bonus) | +15 |
  | Adding a new Throne (once confirmed) | 25 |
  | Confirm/deny freshness check | 3 |
  | Hearsay (remote) rating | 2 |
  | Rating marked "helpful" by other users | +1 each, cap +10 per rating |
- **Influence decays** ~2%/day. Territory must be *held*, not just taken. A House that stops rating in a Fief will lose it. This is the core loop generator: decay creates the ongoing reason to rate.
- **Contested state**: when the #2 House is within 15% of the leader, the Fief shows crossed-swords "Contested!" status and both Houses' local members get a (rate-limited) push notification. Contests are the app's primary re-engagement hook.
- Flips generate a Realm-wide event feed entry ("House Bidet has seized Downtown from House Flush! 🏰").

### 5.6 Houses & seasons (P0)

- **v1 Houses (pre-made, 4–6):** e.g. House Flush ("A Royal Flush Beats a Full House"), House Bidet ("Cleanliness Is Coming"), House Plunger ("We Do Not Clog"), House Porcelain ("Ours Is the Fury… of Bleach"). Each has a sigil, colors, and words. Users create *profiles*, not Houses, in v1 (custom Houses/guilds are P2).
- **Season structure:** 8 weeks. At season end:
  - The House holding the most Fiefs per Realm wins the **Porcelain Crown** (cosmetic profile frame, Banner style, bragging rights screen).
  - Top individual contributors get titles (see §5.7).
  - Fief Influence soft-resets: carryover of 10% so winners keep a slight edge but the map is genuinely re-conquerable. Full resets punish loyalty; no reset entrenches winners; 10% is the tunable starting point.
- **Balance mechanic — Underdog Blessing (P1):** Houses below a Realm-share threshold earn a temporary Influence multiplier (e.g. 1.25×). Runaway leaders make territory games boring; this is the standard fix. Shown transparently in UI.

### 5.7 Individual progression (P0 basic, P1 full)

Parallel to House competition so solo players and Maesters have a ladder:

- **Rank track:** Peasant → Squire → Knight → Baron/Baroness → Lord/Lady → Warden → Hand of the Throne → **Grand Maester of the Privy Council**. Ranks derive from lifetime *quality-weighted* contribution (helpful votes and confirmed accuracy matter, not just volume).
- **Titles & badges (P1):** "First of Their Name" (first ratings), "The Cartographer" (Thrones added), "Oathkeeper" (streaks), "Breaker of Chains" (reported a Throne requiring purchase that actually doesn't), "The Night's Watch" (ratings between midnight and 5am).
- **Streaks (P1):** consecutive weeks with ≥1 verified contribution. Streak protection purchasable with earned (not paid) currency.
- Leaderboards: per-Fief, per-Realm, per-House, weekly and seasonal. Weekly boards give new users a winnable timeframe.

### 5.8 Trust, safety & moderation (P0 — launch-blocking)

This app aims cameras and GPS at restrooms. Safety is not a feature; it is a precondition.

- **Photo policy (hard rule):** photos of restroom *entrances, signage, and sinks* only. All photo uploads pass automated classification (nudity/person detection) → anything with a detectable person is auto-rejected → human review queue for borderline cases *before* public visibility. No photo appears publicly unmoderated. Zero tolerance: verified violation = permanent ban.
- **No photos of people, period.** Detection of any face = rejection.
- **Private residences cannot be added as Thrones.** Add-a-Throne requires selecting a venue category; "residence" is not an option, and new Thrones near residential-only parcels get elevated review.
- Text ratings pass profanity/harassment/doxxing filters. Themed trash-talk between Houses is the brand; targeting individuals is not. Community guidelines written in-world ("The Knight's Code") but enforced for real.
- Anti-gaming: proximity verification (§5.3), rate limits per user/device/IP, GPS-spoof heuristics (impossible travel speed, mock-location flags), new-account Influence ramp (accounts <7 days old contribute 50% Influence), and anomaly detection on coordinated same-location mass rating.
- Report flows on every piece of UGC; moderator SLA of 24h at launch scale.
- COPPA: 13+ age gate. App Store rating expectation: 12+/Teen for "crude humor."

### 5.9 Notifications (P1)

All opt-in by category, aggressively rate-limited (max 1 territory push/day by default):

- "Your Fief is Contested!" (home Fief flips to contested)
- "The Banner has fallen" (a Fief you contributed to was lost)
- Season start / last-week-of-season rally
- Freshness quests ("A Throne near you has not been confirmed in 90 days…")

### 5.10 Monetization (P2 — design now, ship later)

Principles: **utility is never paywalled; competitive advantage is never sold.**

- **Cosmetics:** premium Banner styles, profile sigils, map themes (e.g. "Winter Is Coming" snow map), rating-stamp animations.
- **Maester's Pass (seasonal, ~$4.99):** cosmetic reward track alongside the free track. No Influence multipliers for money, ever — paid power would destroy both the game's integrity and the data's integrity.
- Explicitly rejected: ads inside the panic-button flow (user is in crisis; monetizing desperation is brand poison), selling restroom data without aggregation/anonymization, venue-paid score boosts.

---

## 6. UX & content tone

- **Register:** mock-heroic. The joke is treating restroom quality with the gravity of a dynastic war. The app is 100% sincere about the utility and 0% sincere about everything else.
- Copy examples: empty state — "These lands are uncharted, brave traveler."; rating submitted — "Your deed shall be sung of."; 1-star given — "The Realm will remember."
- **Escape hatch:** a "Plain Speech" toggle in settings renders all functional copy literally (accessibility + users who just need a bathroom and zero whimsy). Themed copy must never obscure critical info: hours, accessibility, and access requirements are always displayed plainly even in themed mode.
- Visual identity: parchment-and-heraldry UI over a modern map. Dark mode = "The Long Night."
- Accessibility: full VoiceOver/TalkBack support, WCAG AA contrast, and the ADA-accessible filter treated as a first-class citizen — for users with disabilities this app is disproportionately valuable, and that's a responsibility.

---

## 7. Technical requirements (summary)

- **Clients:** iOS + Android. Recommend React Native or Flutter — the UI is map + sheets + forms, no heavy native needs; ship both platforms with one team.
- **Map:** Mapbox (custom fantasy styling is a core brand requirement and Mapbox's styling is strongest) with H3 for Fief geometry.
- **Backend:** managed cloud (team's existing stack); PostgreSQL + PostGIS for Thrones/ratings/geo queries; Redis for leaderboards and Fief influence counters; scheduled jobs for decay ticks (daily) and season rollover.
- **Influence ledger is append-only** (event log) — territory state is derived, replayable, and auditable when (not if) someone claims cheating.
- **Moderation pipeline:** third-party image classification (e.g. cloud vision NSFW/person detection) + human review queue tool.
- Offline: map tiles and last-known Throne data cached; ratings queue-and-sync (restrooms and connectivity are both basement-adjacent).
- Privacy: precise location used in-session only; location history is not stored server-side beyond the proximity check result (store the boolean + coarse geohash, not the coordinate trail). This must survive privacy review and be true in the privacy label.

---

## 8. Launch plan

- **Phase 0 — Seeding (pre-launch):** import open restroom datasets (city open-data portals, Refuge Restrooms API, OSM `amenity=toilets`) so launch cities have baseline coverage. An empty map kills the utility on day one.
- **Phase 1 — Closed beta ("The Small Council"):** 1 city, ~500 users, 4 Houses. Validate the 20-second rating flow and moderation pipeline under real load.
- **Phase 2 — Launch Realm:** public launch in 2–3 dense, walkable cities (e.g. NYC, Chicago, Austin). Territory games need density; a national launch would dilute every Fief into dead air.
- **Phase 3 — New Realms:** expand city-by-city, each new Realm launching with a fresh Season so newcomers start on equal footing.

---

## 9. Success metrics

| Metric | Target (6 months post-launch) | Why it matters |
|---|---|---|
| Verified ratings per Throne per month (launch cities) | ≥ 1.5 | Freshness is the product |
| Median time-to-complete rating flow | ≤ 20s | Contribution friction |
| % of MAU who contribute (rate/confirm/add) ≥1×/month | ≥ 25% | The game is working (typical map UGC apps: <5%) |
| D30 retention, users who joined a House | ≥ 20% | House identity drives retention |
| "Nearest Worthy Throne" success rate (user doesn't immediately search again) | ≥ 80% | Utility actually works |
| Fiefs changing hands per Season per Realm | ≥ 30% | Game is competitive, not entrenched |
| Photo moderation: violating images publicly visible | 0 | Non-negotiable |

Guardrail metrics: rating authenticity (spot-check accuracy of scores vs. audit visits), notification opt-out rate <30%, store rating ≥4.4.

---

## 10. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Inappropriate photos/content | Existential (app store removal, brand death) | §5.8 pipeline; no unmoderated public photos; zero-tolerance bans |
| Gaming/spoofed ratings corrupt both game and data | High | Proximity verification, decay, ledger auditability, anomaly detection, new-account ramps |
| Density death spiral (empty map → no users → no ratings) | High | Data seeding (§8 Phase 0), city-by-city launch, freshness quests |
| One House snowballs; game gets boring | Medium | Influence decay, seasonal soft-reset, Underdog Blessing |
| Novelty wears off after the joke lands | Medium | The utility retains users the game doesn't; seasons refresh competition; Plain Speech mode keeps utility users |
| Businesses object to "Dungeon" ratings on their restrooms | Medium | Ratings are opinion; report/appeal flow; no venue shaming outside restroom scope |
| HBO/WBD trademark exposure ("Shame of Thrones", house names, "X is Coming") | Medium-High | **Legal review before naming lock.** Parody positioning helps but is not a shield for a commercial mark. Backup names in appendix; avoid direct GoT phrasing in marketing copy pending counsel. |

---

## 11. Open questions

1. **Name clearance:** does "Shame of Thrones" survive trademark counsel? (Backups: *Game of Thrones Rooms* is worse, keep brainstorming — *Loo of the Rings* has the identical problem. *A Song of Vice and Choir* does not. Candidate safe-ish backup: **"Throne & Country."**)
2. Fief size: is H3 res-7 right, or should density (Thrones per hex) drive adaptive resolution?
3. Should Hearsay ratings exist at all in v1, or is verified-only cleaner for data trust?
4. Season length: 8 weeks assumed — validate against beta retention curves.
5. Do we allow rating *paid/customers-only* restrooms differently (access friction affects score fairness)?
6. Municipal partnerships (cities want restroom usage data; we'll have the best dataset in the country) — pursue in year 1 or stay consumer-pure?

---

## Appendix A — v1 scope cut-line (summary)

**P0 (launch):** map + panic button, filters, Throne detail, 20s rating flow, add/confirm/report Thrones, proximity verification, score decay, Fiefs + Influence + contested states, 4 pre-made Houses, seasons with soft reset, basic ranks, full moderation pipeline, Plain Speech toggle, data seeding.

**P1 (≤90 days):** Underdog Blessing, titles/badges/streaks, notifications, helpful-vote weighting UI, weekly leaderboards.

**P2 (later):** custom Houses/guilds, House message boards, Maester's Pass + cosmetics, municipal data products, new Realms at scale.
