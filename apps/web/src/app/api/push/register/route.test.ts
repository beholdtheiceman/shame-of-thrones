import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { pushTokens } from "@/db/schema";
import { resetDb } from "@/test/db";
import { makeUser } from "@/test/fixtures";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
import { auth } from "@/auth";
import { POST } from "./route";

function post(body: unknown) {
  return new Request("http://test/api/push/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/push/register", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(auth).mockReset();
  });

  it("registers a token for the authed user", async () => {
    const user = await makeUser();
    vi.mocked(auth).mockResolvedValue({ googleSubject: user.googleSubject } as never);

    const res = await POST(post({ token: "ExponentPushToken[abc]", platform: "ios" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const rows = await db.select().from(pushTokens).where(eq(pushTokens.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].token).toBe("ExponentPushToken[abc]");
    expect(rows[0].platform).toBe("ios");
  });

  it("is idempotent for the same token", async () => {
    const user = await makeUser();
    vi.mocked(auth).mockResolvedValue({ googleSubject: user.googleSubject } as never);

    await POST(post({ token: "ExponentPushToken[dup]", platform: "ios" }));
    const res = await POST(post({ token: "ExponentPushToken[dup]", platform: "ios" }));

    expect(res.status).toBe(200);
    const rows = await db.select().from(pushTokens).where(eq(pushTokens.token, "ExponentPushToken[dup]"));
    expect(rows).toHaveLength(1);
  });

  it("re-homes a token to a new user on re-register (device reassigned)", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    vi.mocked(auth).mockResolvedValue({ googleSubject: alice.googleSubject } as never);
    await POST(post({ token: "ExponentPushToken[shared]" }));

    vi.mocked(auth).mockResolvedValue({ googleSubject: bob.googleSubject } as never);
    const res = await POST(post({ token: "ExponentPushToken[shared]" }));

    expect(res.status).toBe(200);
    const rows = await db.select().from(pushTokens).where(eq(pushTokens.token, "ExponentPushToken[shared]"));
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(bob.id);
  });

  it("400s when token is missing", async () => {
    const user = await makeUser();
    vi.mocked(auth).mockResolvedValue({ googleSubject: user.googleSubject } as never);

    const res = await POST(post({ platform: "ios" }));
    expect(res.status).toBe(400);
  });

  it("400s when token is not a string", async () => {
    const user = await makeUser();
    vi.mocked(auth).mockResolvedValue({ googleSubject: user.googleSubject } as never);

    const res = await POST(post({ token: 12345 }));
    expect(res.status).toBe(400);
  });

  it("401s an anonymous request", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const res = await POST(post({ token: "ExponentPushToken[anon]" }));
    expect(res.status).toBe(401);
  });
});
