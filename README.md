# Shame of Thrones

Rate public restrooms ("Thrones"), pledge to a House, and conquer real-world
territory ("Fiefs") through the volume and freshness of your ratings. See
[`docs/SHAME_OF_THRONES_PRD.md`](docs/SHAME_OF_THRONES_PRD.md) for the full product
vision and [`docs/ROADMAP.md`](docs/ROADMAP.md) for what stands between this and launch.

This is the **Phase 0 multi-user build**: a Next.js app with a real backend
(Postgres + Auth.js), where two people on different devices share one Realm — the
same Thrones, scores, and territory. The design and implementation plan live in
[`docs/superpowers/`](docs/superpowers).

## Run it locally

Requires a Postgres database with PostGIS (a free [Neon](https://neon.tech) project
works) and a Google OAuth client.

```bash
npm install
cp .env.example .env.local     # fill in DATABASE_URL, AUTH_SECRET, Google OAuth creds
npm run db:migrate             # apply schema + PostGIS + append-only trigger
npm run db:seed                # load the seeded Manhattan Realm
npm run dev
```

Open http://localhost:3000. You can browse the map anonymously ("Wandering
Peasant"); signing in with Google lets you pledge a House and rate Thrones.

## What's implemented (P0 slice of the PRD)

- **Multi-user backend** — Next.js API route handlers over Postgres (Drizzle ORM,
  PostGIS). All game math runs server-side; the client never computes authoritative
  state. The Influence ledger is an append-only table enforced by a database trigger,
  so territory is derived and replayable.
- **Auth** — Sign in with Google (Auth.js v5), plus anonymous read-only browsing.
- **The Realm** — a live map (Leaflet + OpenStreetMap) of a seeded Manhattan
  neighborhood, with real H3 hexagon Fiefs tinted by whichever House holds the most
  (decaying) Influence, and a pulsing outline on contested Fiefs.
- **The Sitting** — the rating flow: heraldic 1–5 verdict scale, quick tags, GPS
  proximity check (Verified vs. Hearsay). Server computes Influence, first-of-their-name
  bonus, badges, and Fief flips atomically.
- **Territory** — every rating posts Influence to its Fief; Influence decays ~2%/day
  so a House has to keep contributing to hold ground.
- **Chart a Throne / Confirm** — add a restroom (enters *Rumored*); a **second,
  distinct** traveler must confirm it before it's verified (enforced server-side).
- **Ranks & Houses** — lifetime XP → rank track (Peasant → Grand Maester), badges,
  a once-per-season House-switch control, and Realm standings.
- **Today's Dispatches** — a global event feed of rating strikes, Fief flips, and
  confirmations, shared across all users.
- A 16/32-bit pixel-RPG visual identity: Press Start 2P / Pixelify Sans / VT323,
  hand-built "NES dialogue box" panels, flickering CSS torches, Torchlit / Moonlit
  theme toggle.

## Not yet built (see `docs/ROADMAP.md`)

Free-text reviews and photos (await the moderation pipeline), notifications,
leaderboards, Redis, season rollover, native mobile, and external data seeding.
These are deliberately out of the Phase 0 scope.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Postgres + PostGIS via
Drizzle ORM · Auth.js v5 (Google) · zod · Vitest · Leaflet / react-leaflet
(OpenStreetMap tiles) · h3-js for hexagonal territory · `next/font` (Press Start 2P /
Pixelify Sans / VT323). Deploys to Vercel.

## Project layout

```
src/db/schema.ts        Drizzle schema (users, thrones, ratings, influence_events, ledger)
src/db/client.ts        Postgres connection
src/db/seed.ts          seed script (ports the demo Realm into Postgres)
drizzle/                SQL migrations
src/lib/types.ts        domain types
src/lib/data.ts         Houses, seed Thrones, seed ratings/ledger (NYC)
src/lib/geo.ts          H3 Fief helpers, haversine distance
src/lib/selectors.ts    throne score decay, Fief control + contest, rank math (server-reused)
src/lib/game/rules.ts   influence awards, tag vocabulary, time windows
src/lib/server/         API service layer (realm, profile, ratings, thrones, session)
src/app/api/            route handlers (realm, me, profile, ratings, thrones, auth)
src/lib/api.ts          client fetch wrapper + DTOs
src/lib/store.tsx       React Context store (API-backed)
src/components/         Onboarding, RealmMap, ThroneSheet, SittingFlow, AddThroneFlow,
                         NearestWorthyButton, Ledger, ProfilePanel, TabBar, SignInGate
```
