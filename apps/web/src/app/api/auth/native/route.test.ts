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
  beforeEach(() => { verifyIdToken.mockReset(); });

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
});
