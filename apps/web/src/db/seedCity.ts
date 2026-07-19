import { config } from "dotenv";
config({ path: ".env.local" });
config();

import type { Bbox } from "./cityBbox";
import type { SeededThrone, RefugeRaw, OsmNode } from "@sot/core";

const SYSTEM_GOOGLE_SUBJECT = "source:system";

async function fetchRefuge(bbox: Bbox) {
  const [s, w, n, e] = bbox;
  const results: unknown[] = [];
  const lat = (s + n) / 2, lng = (w + e) / 2;
  for (let page = 1; page <= 20; page++) {
    const url = `https://www.refugerestrooms.org/api/v1/restrooms/by_location?lat=${lat}&lng=${lng}&per_page=100&page=${page}`;
    const res = await fetch(url, { headers: { "User-Agent": "shame-of-thrones-seed" } });
    if (!res.ok) throw new Error(`Refuge ${res.status}`);
    const batch = (await res.json()) as Array<{ latitude: string; longitude: string }>;
    if (batch.length === 0) break;
    for (const r of batch) {
      const rl = Number(r.latitude), rg = Number(r.longitude);
      if (rl >= s && rl <= n && rg >= w && rg <= e) results.push(r);
    }
  }
  return results;
}

async function fetchOsm(bbox: Bbox) {
  const [s, w, n, e] = bbox;
  const q = `[out:json][timeout:60];node["amenity"="toilets"](${s},${w},${n},${e});out;`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST", body: `data=${encodeURIComponent(q)}`,
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "shame-of-thrones-seed" },
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const json = (await res.json()) as { elements: unknown[] };
  return json.elements;
}

async function main() {
  const { db, pool } = await import("./client");
  const { thrones, users } = await import("./schema");
  const { eq, sql } = await import("drizzle-orm");
  const {
    normalizeRefuge, normalizeOsm, dedupeCrossSource, isDuplicate,
  } = await import("@sot/core");
  const { parseSeedArgs, resolveBbox } = await import("./cityBbox");

  const opts = parseSeedArgs(process.argv.slice(2));
  const bbox = resolveBbox(opts);

  const raw: SeededThrone[] = [];
  if (opts.sources.includes("refuge")) {
    const rf = (await fetchRefuge(bbox)) as RefugeRaw[];
    raw.push(...rf.map(normalizeRefuge));
    console.log(`refuge: ${rf.length} in bbox`);
  }
  if (opts.sources.includes("osm")) {
    const os = (await fetchOsm(bbox)) as OsmNode[];
    raw.push(...os.map(normalizeOsm));
    console.log(`osm: ${os.length} nodes`);
  }

  const deduped = dedupeCrossSource(raw.filter((t) => Number.isFinite(t.lat) && Number.isFinite(t.lng)));
  console.log(`after cross-source dedup: ${deduped.length}`);

  const existing = await db.select({ lat: thrones.lat, lng: thrones.lng }).from(thrones);
  const fresh = deduped.filter((t) => !isDuplicate(t, existing));
  console.log(`would insert (new vs DB): ${fresh.length}`);

  if (opts.dryRun) {
    console.log("--dry-run: no DB writes.");
    await pool.end();
    return;
  }

  let [sys] = await db.select({ id: users.id }).from(users).where(eq(users.googleSubject, SYSTEM_GOOGLE_SUBJECT));
  if (!sys) {
    [sys] = await db.insert(users)
      .values({ googleSubject: SYSTEM_GOOGLE_SUBJECT, displayName: "Realm Cartographer", houseId: "flush" })
      .returning({ id: users.id });
  }

  let count = 0;
  for (const t of fresh) {
    await db.insert(thrones).values({
      name: t.name, lat: t.lat, lng: t.lng, category: t.category, status: "verified",
      publicAccessAttested: true, amenities: t.amenities, addedBy: sys.id,
      source: t.source, sourceId: t.sourceId,
    })
      .onConflictDoUpdate({
        target: [thrones.source, thrones.sourceId],
        // Partial unique index (WHERE source IS NOT NULL) — Postgres needs the
        // predicate to infer it as the arbiter for ON CONFLICT.
        targetWhere: sql`source is not null`,
        set: { name: t.name, category: t.category, amenities: t.amenities },
      });
    count++;
  }
  console.log(`done. upserted ${count} source-authored thrones.`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
