import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { users } from "@/db/schema";

export type SessionInfo =
  | { kind: "anonymous" }
  | { kind: "no_profile"; googleSubject: string }
  | { kind: "user"; user: typeof users.$inferSelect };

export async function sessionInfo(): Promise<SessionInfo> {
  const session = await auth();
  const sub = session?.googleSubject;
  if (!sub) return { kind: "anonymous" };
  const user = await db.query.users.findFirst({ where: eq(users.googleSubject, sub) });
  return user ? { kind: "user", user } : { kind: "no_profile", googleSubject: sub };
}
