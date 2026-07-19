import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  const { db, pool } = await import("./client");
  const {
    influenceEvents, ratings, photos, reports, reviewQueue, thrones, ledgerEntries, users,
    notifications,
  } = await import("./schema");
  const { like, count, inArray, sql } = await import("drizzle-orm");

  const execute = process.argv.includes("--yes");

  const [{ v: nThrones }] = await db.select({ v: count() }).from(thrones);
  const [{ v: nInfluence }] = await db.select({ v: count() }).from(influenceEvents);
  const [{ v: nRatings }] = await db.select({ v: count() }).from(ratings);
  const [{ v: nSeedUsers }] = await db.select({ v: count() }).from(users).where(like(users.googleSubject, "seed:%"));

  console.log("Demo-data reset would delete:");
  console.log(`  influence_events: ${nInfluence}`);
  console.log(`  ratings:          ${nRatings}`);
  console.log(`  thrones:          ${nThrones}`);
  console.log(`  seed:* users:     ${nSeedUsers}`);
  console.log("  + photos/reports/review_queue/notifications referencing the above, + all ledger_entries");
  console.log("  PRESERVES real Google users and the source:system user.");

  if (!execute) {
    console.log("\nDry-run (default). Re-run with --yes to execute.");
    await pool.end();
    return;
  }

  await db.transaction(async (tx) => {
    const seedUserIds = tx.select({ id: users.id }).from(users).where(like(users.googleSubject, "seed:%"));
    // notifications.userId has no onDelete cascade — must clear before deleting seed users.
    await tx.delete(notifications).where(inArray(notifications.userId, seedUserIds));
    // influence_events is guarded by an append-only trigger (0001); disable it
    // for this admin reset. DDL is transactional, so a rollback (or the ENABLE
    // below) restores the guard — the table is never left unprotected.
    await tx.execute(sql`ALTER TABLE influence_events DISABLE TRIGGER influence_events_append_only`);
    await tx.delete(influenceEvents);
    await tx.execute(sql`ALTER TABLE influence_events ENABLE TRIGGER influence_events_append_only`);
    await tx.delete(ratings);
    await tx.delete(reports);
    await tx.delete(reviewQueue);
    await tx.delete(photos);
    await tx.delete(thrones);
    await tx.delete(ledgerEntries);
    await tx.delete(users).where(like(users.googleSubject, "seed:%"));
  });
  console.log("\nDone. Demo data wiped.");
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
