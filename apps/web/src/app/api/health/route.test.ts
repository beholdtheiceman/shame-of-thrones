import { describe, expect, it } from "vitest";

async function get() {
  const { GET } = await import("./route");
  return GET();
}

describe("GET /api/health", () => {
  it("reports env presence as booleans and never leaks values", async () => {
    process.env.NATIVE_JWT_SECRET = "super-secret-value";
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.env.NATIVE_JWT_SECRET).toBe(true);
    // must not echo the actual secret anywhere in the payload
    expect(JSON.stringify(body)).not.toContain("super-secret-value");
  });

  it("marks a missing var as false", async () => {
    delete process.env.GOOGLE_NATIVE_CLIENT_IDS;
    const body = await (await get()).json();
    expect(body.env.GOOGLE_NATIVE_CLIENT_IDS).toBe(false);
  });
});
