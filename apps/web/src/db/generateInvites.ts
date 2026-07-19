import { config } from "dotenv";
config({ path: ".env.local" });
config();

// Mint closed-beta invite codes for a cohort and write them to a file for
// distribution. Usage: npm run invites:generate -- --cohort raleigh --count 500
async function main() {
  const { db, pool } = await import("./client");
  const { invites, users } = await import("./schema");
  const { eq } = await import("drizzle-orm");
  const { generateInviteCode } = await import("@sot/core");
  const fs = await import("node:fs");

  const argv = process.argv.slice(2);
  const arg = (name: string, dflt: string) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
  };
  const cohort = arg("--cohort", "raleigh");
  const count = Math.max(1, Math.min(5000, Number(arg("--count", "500"))));

  // createdBy needs a valid user; reuse the seeding system user (or create it).
  let [sys] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.googleSubject, "source:system"));
  if (!sys) {
    [sys] = await db
      .insert(users)
      .values({ googleSubject: "source:system", displayName: "Realm Cartographer", houseId: "flush" })
      .returning({ id: users.id });
  }

  // Generate `count` distinct codes in memory, then insert (skip any that
  // collide with an existing code).
  const codes = new Set<string>();
  while (codes.size < count) codes.add(generateInviteCode());
  const rows = [...codes].map((code) => ({ code, cohort, createdBy: sys.id }));
  const inserted = await db.insert(invites).values(rows).onConflictDoNothing().returning({ code: invites.code });

  const list = inserted.map((r) => r.code);
  const file = `invites-${cohort}.txt`;
  fs.writeFileSync(file, list.join("\n") + "\n");
  console.log(`Generated ${list.length} invite codes for cohort "${cohort}" -> apps/web/${file}`);
  console.log("Sample:", list.slice(0, 12).join(", "));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
