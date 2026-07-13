# Handoff — 2026-07-12 (end of day)

## Where things stand
**ROADMAP Phase 2 is COMPLETE — all three cycles built today.** Cycles 1
(display gaps) and 2 (Plain Speech + WCAG AA) are live in production.
Cycle 3 (offline support) is **committed locally, verified, NOT yet pushed**
— it awaits Larry's push/deploy OK. Offline delivers: a hand-rolled service
worker (viewed map tiles cache-first capped at 1,500, offline app shell,
`/api/*` never SW-cached), a last-known realm snapshot with an offline
banner, and queue-and-sync for ratings (4xx drops surface a dismissible
notice; sync-time timestamps by design).

## Done this session (cycle 3 portion)
- Spec + plan committed (`2026-07-12-phase2-offline-support-*`)
- `ratingQueue.ts` (pure, storage-injected; 7 units), store integration
  (snapshot, offline flag, queue, flush on online/start), OfflineBanner,
  SittingFlow queued message, `public/sw.js` + registrar
- Combined review found 2 Critical + 7 Important — ALL fixed and committed
  (79caed9): SW shell-cache poisoning via /moderation, false "queued" success
  when localStorage fails, stuck offline flag, snapshot age, flush/refresh
  race, sticky dropped-notice, banner scoped to one tab, redirect guard,
  trim race
- Live-verified on dev: 21 tiles in SW cache after the opaque-response fix,
  offline banner + snapshot map render with `/api/*` failing, banner clears
  on reconnect. 136/136 tests + 10 new-module units, build clean.

## ⚠️ Half-finished / fragile right now
- **Cycle 3 is unpushed** — commits 1eb6233..79caed9 + docs sit local on
  feat/phase0-backend. Push = prod deploy; needs Larry's explicit OK.
- Not live-verified (unit/review-covered): the queued-rating end-to-end path
  (needs a signed-in session losing connectivity) and the snapshot-age
  suffix in the banner (possible HMR staleness during the check — re-verify
  once deployed).
- **Key discovery for anyone touching sw.js:** Leaflet tile responses are
  opaque (no-cors, `res.ok === false`) — cache them via
  `res.ok || res.type === "opaque"` or nothing gets cached.

## Next steps (in order)
1. **Push cycle 3** (Larry's OK) and spot-check prod: SW registered, tiles
   cache after a pan, offline banner via devtools offline mode.
2. Phase 2 is then done → next is ROADMAP **Phase 3 (retention systems)** or
   legal/trademark clearance (still the only open Phase 1 item).
3. Optional cleanup: prod test artifacts (ser.claude_verifier, "Verify Test
   Privy", 1x1 test photo).

## Decisions & discoveries this session
- Offline architecture (Larry): hand-rolled SW, no PWA library; ratings-only
  queueing; cold offline start is read-only (auth unverifiable offline).
- SW navigations: cache ONLY the `/` shell — keying every path under "/"
  lets /moderation poison the anonymous fallback (review catch).
- enqueue() must report persistence failure — silent localStorage failure +
  "saved!" message is data loss wearing a success face (review catch).
- An ApiError response means you're ONLINE — clear the offline flag on any
  HTTP response, not just 2xx.
- The codex-rescue wrapper failed twice today (fabricated job id; read-only
  sandbox) — both times the recovery was: verify `git status`, then either
  re-dispatch with "run synchronously, do not detach" or apply the
  plan-specified code directly.
- Session cost ran ~$95+ total across all three cycles — for future phases,
  one cycle per session is the right budget shape.
