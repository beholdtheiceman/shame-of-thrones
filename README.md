# Shame of Thrones — MVP

**Live: https://beholdtheiceman.github.io/shame-of-thrones/**

An interactive prototype of the core game loop described in
[`docs/SHAME_OF_THRONES_PRD.md`](docs/SHAME_OF_THRONES_PRD.md): rate public
restrooms ("Thrones"), pledge to a House, and conquer real-world territory
("Fiefs") through the volume and freshness of your ratings.

Live loop covered: onboard → browse the map → rate a Throne in ~20 seconds →
watch the Fief's controlling House shift → see it land in the event feed and
your rank.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. First run drops you into onboarding — pick a
name and a House, then you're in.

## What's implemented (P0 slice of the PRD)

- **The Realm** — a live map (Leaflet + OpenStreetMap) of a seeded Manhattan
  neighborhood, with real H3 hexagon Fiefs tinted by whichever House holds
  the most (decaying) Influence there, and a pulsing outline on contested
  Fiefs.
- **The Sitting** — the 20-second rating flow: heraldic 1–5 verdict scale,
  quick tags, an optional Scroll of Testimony, GPS proximity check
  (Verified vs. Hearsay).
- **Territory** — every rating posts Influence to its Fief; Influence decays
  ~2%/day so a House has to keep contributing to hold ground; a "First of
  Their Name" bonus rewards a Throne's first-ever rating.
- **Nearest Worthy Throne** — one-tap geolocation search for the closest
  Throne scoring ≥ 3.5.
- **Chart a Throne** — tap the map to add a new restroom; it enters as
  *Rumored* until confirmed.
- **Ranks & Houses** — lifetime XP → rank track (Peasant → Grand Maester),
  badges, a House-switch control, and Realm standings (fief count per
  House, the race for the Porcelain Crown).
- **Today's Dispatches** — a live event feed of rating strikes, Fief flips,
  and confirmations.
- A 16/32-bit pixel-RPG visual identity: Press Start 2P / Pixelify Sans /
  VT323, hand-built "NES dialogue box" panels, flickering CSS torches, and
  a dungeon-and-gold palette. Torchlit / Moonlit theme toggle plus
  `prefers-color-scheme`.

## Deliberate MVP simplifications

This is a single-user client-side prototype, not the production system in
the PRD. Known gaps, in the order I'd close them next:

1. **No backend, no auth, no multi-user sync.** All state (profile,
   ratings, Influence, ledger) lives in `localStorage` via a React
   Context + reducer (`src/lib/store.tsx`). The PRD calls for Postgres +
   PostGIS, Redis leaderboards, and an append-only Influence ledger
   service — this prototype approximates that ledger client-side so the
   game logic (decay, contested state, rank math) is real and testable,
   but nothing is shared across devices or users.
2. **Throne confirmation is self-serve.** The PRD requires a *second,
   distinct* traveler to confirm a Rumored Throne. With one local user,
   confirmation is just a button on the Throne's own detail sheet.
3. **Fief resolution is tuned for a single-neighborhood demo.** Uses real
   H3 hexagons (`h3-js`) but at resolution 9 (~150m cells) rather than the
   PRD's resolution 7 (~1-2km), so a handful of seeded blocks produces
   several contestable Fiefs instead of one giant one.
4. **No moderation pipeline.** Photos aren't implemented at all yet — the
   PRD treats photo moderation as launch-blocking, and it's out of scope
   for this prototype.
5. **No anti-gaming.** Proximity is checked with a real GPS distance
   calculation, but there's no rate limiting, spoof detection, or
   new-account Influence ramp.
6. **Individual rank is un-decayed lifetime XP**; only territory control
   decays. Streak-based badges ("Oathkeeper") aren't implemented.

## Stack

Next.js 16 (App Router, Turbopack, static export) · React 19 · TypeScript ·
Tailwind CSS 4 · Leaflet / react-leaflet (OpenStreetMap tiles, no API key
required) · h3-js for hexagonal territory · `next/font` (Press Start 2P /
Pixelify Sans / VT323) · no backend. Deployed to GitHub Pages via
`.github/workflows/deploy-pages.yml` on every push to `main`.

## Project layout

```
src/lib/types.ts        domain types
src/lib/data.ts         Houses, seed Thrones, seed ratings/ledger (NYC)
src/lib/geo.ts          H3 Fief helpers, haversine distance
src/lib/selectors.ts    throne score decay, Fief control + contest, rank math
src/lib/store.tsx       React Context + reducer + localStorage persistence
src/components/         Onboarding, RealmMap, ThroneSheet, SittingFlow,
                         AddThroneFlow, NearestWorthyButton, Ledger,
                         ProfilePanel, TabBar, ThemeToggle
```
