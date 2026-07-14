import { describe, expect, it, vi, beforeEach } from "vitest";
import { jwtVerify } from "jose";

const verifyIdToken = vi.fn();
vi.mock("google-auth-library", () => ({
  OAuth2Client: class { verifyIdToken = verifyIdToken; },
}));

async function post(body: unknown) {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/auth/native", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

describe("POST /api/auth/native", () => {
  beforeEach(() => {
    verifyIdToken.mockReset();
    process.env.NATIVE_JWT_SECRET ??= "test-native-secret";
    process.env.GOOGLE_NATIVE_CLIENT_IDS ??= "test-web-client-id";
  });

  it("issues a bearer JWT carrying the Google sub on a valid idToken", async () => {
    verifyIdToken.mockResolvedValue({ getPayload: () => ({ sub: "google-sub-99" }) });
    const res = await post({ idToken: "good" });
    expect(res.status).toBe(200);
    const { token } = await res.json();
    const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.NATIVE_JWT_SECRET));
    expect(payload.googleSubject).toBe("google-sub-99");
  });

  it("returns 401 when verification throws", async () => {
    verifyIdToken.mockRejectedValue(new Error("bad token"));
    expect((await post({ idToken: "bad" })).status).toBe(401);
  });

  it("returns 400 when idToken is missing", async () => {
    expect((await post({})).status).toBe(400);
  });

  it("returns 500 when NATIVE_JWT_SECRET is unset", async () => {
    verifyIdToken.mockResolvedValue({ getPayload: () => ({ sub: "s" }) });
    const prev = process.env.NATIVE_JWT_SECRET;
    delete process.env.NATIVE_JWT_SECRET;
    try {
      expect((await post({ idToken: "good" })).status).toBe(500);
    } finally {
      process.env.NATIVE_JWT_SECRET = prev;
    }
  });

  it("returns 500 when GOOGLE_NATIVE_CLIENT_IDS is unset", async () => {
    verifyIdToken.mockResolvedValue({ getPayload: () => ({ sub: "s" }) });
    const prev = process.env.GOOGLE_NATIVE_CLIENT_IDS;
    delete process.env.GOOGLE_NATIVE_CLIENT_IDS;
    try {
      expect((await post({ idToken: "good" })).status).toBe(500);
    } finally {
      process.env.GOOGLE_NATIVE_CLIENT_IDS = prev;
    }
  });
});
