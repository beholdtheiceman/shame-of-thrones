import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { jwtVerify } from "jose";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { users } from "@/db/schema";

export type SessionInfo =
  | { kind: "anonymous" }
  | { kind: "no_profile"; googleSubject: string }
  | { kind: "user"; user: typeof users.$inferSelect };

async function googleSubjectFromBearer(): Promise<string | null> {
  // Fail-closed: any error here (missing request scope, malformed/expired/tampered
  // token, missing secret) must fall through to the cookie session, never throw.
  try {
    const authz = (await headers()).get("authorization");
    if (!authz?.startsWith("Bearer ")) return null;
    const secret = process.env.NATIVE_JWT_SECRET;
    if (!secret) return null;
    const { payload } = await jwtVerify(authz.slice(7), new TextEncoder().encode(secret));
    return typeof payload.googleSubject === "string" ? payload.googleSubject : null;
  } catch {
    return null;
  }
}

export async function sessionInfo(): Promise<SessionInfo> {
  const sub = (await googleSubjectFromBearer()) ?? (await auth())?.googleSubject;
  if (!sub) return { kind: "anonymous" };
  const user = await db.query.users.findFirst({ where: eq(users.googleSubject, sub) });
  return user ? { kind: "user", user } : { kind: "no_profile", googleSubject: sub };
}
