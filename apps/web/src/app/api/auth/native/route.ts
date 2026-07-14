import { NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { SignJWT } from "jose";

const client = new OAuth2Client();

function audiences(): string[] {
  return (process.env.GOOGLE_NATIVE_CLIENT_IDS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
}

export async function POST(req: Request) {
  if (!process.env.NATIVE_JWT_SECRET || audiences().length === 0) {
    return NextResponse.json(
      { error: "native auth not configured" },
      { status: 500 },
    );
  }
  const body = await req.json().catch(() => null);
  const idToken = body?.idToken;
  if (typeof idToken !== "string") {
    return NextResponse.json({ error: "idToken required" }, { status: 400 });
  }

  let sub: string | undefined;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: audiences() });
    sub = ticket.getPayload()?.sub;
  } catch {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }
  if (!sub) return NextResponse.json({ error: "invalid token" }, { status: 401 });

  const token = await new SignJWT({ googleSubject: sub })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(new TextEncoder().encode(process.env.NATIVE_JWT_SECRET));

  return NextResponse.json({ token });
}
