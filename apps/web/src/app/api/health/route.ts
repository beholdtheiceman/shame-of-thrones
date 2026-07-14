import { NextResponse } from "next/server";

// Reports only the PRESENCE of each required server env var (boolean), never the
// value. Lets a deploy be verified at a glance without leaking secrets.
const REQUIRED = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "NATIVE_JWT_SECRET",
  "GOOGLE_NATIVE_CLIENT_IDS",
] as const;

export function GET() {
  const env = Object.fromEntries(
    REQUIRED.map((k) => [k, Boolean(process.env[k])]),
  );
  const ok = Object.values(env).every(Boolean);
  return NextResponse.json({ ok, env }, { status: 200 });
}
