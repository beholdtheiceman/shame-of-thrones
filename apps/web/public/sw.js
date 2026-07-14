const TILE_CACHE = "sot-tiles-v1";
const SHELL_CACHE = "sot-shell-v1";
const TILE_CAP = 1500;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== TILE_CACHE && n !== SHELL_CACHE).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

let trimming = false;
async function trimTiles() {
  if (trimming) return; // fast pans schedule many trims; one at a time is enough
  trimming = true;
  try {
    const cache = await caches.open(TILE_CACHE);
    const keys = await cache.keys();
    if (keys.length > TILE_CAP) {
      await Promise.all(keys.slice(0, keys.length - TILE_CAP).map((k) => cache.delete(k)));
    }
  } finally {
    trimming = false;
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // Map tiles: cache-first, capped. Only tiles the user actually viewed
  // are cached (OSM tile-usage policy: no bulk downloads).
  if (url.hostname.endsWith("tile.openstreetmap.org")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(TILE_CACHE);
        const hit = await cache.match(event.request);
        if (hit) return hit;
        const res = await fetch(event.request);
        // Leaflet <img> tiles are no-cors: responses are opaque (ok=false, status 0)
        // but still cacheable and renderable.
        if (res.ok || res.type === "opaque") {
          await cache.put(event.request, res.clone());
          event.waitUntil(trimTiles());
        }
        return res;
      })()
    );
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // freshness is app-controlled

  // Hashed build assets: cache-first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const hit = await cache.match(event.request);
        if (hit) return hit;
        const res = await fetch(event.request);
        if (res.ok) await cache.put(event.request, res.clone());
        return res;
      })()
    );
    return;
  }

  // App shell: network-first with cached fallback so the app opens offline.
  // Only the home shell is cached — caching under a fixed "/" key for every
  // path would let /moderation poison the fallback for anonymous users.
  if (event.request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        try {
          const res = await fetch(event.request);
          if (res.ok && !res.redirected && url.pathname === "/") {
            await cache.put("/", res.clone());
          }
          return res;
        } catch {
          return (await cache.match("/")) || Response.error();
        }
      })()
    );
  }
});
