import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/** Wipe all rows between tests. TRUNCATE bypasses the row-level
 * append-only trigger (it fires on UPDATE/DELETE, not TRUNCATE). */
export async function resetDb(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE entitlements, reports, review_queue, age_attestations, photos, ratings, influence_events, ledger_entries, thrones, users CASCADE`
  );
}
