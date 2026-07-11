import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/auth";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { sessionInfo } from "@/lib/server/session";
import { resetDb } from "./db";

const mockedAuth = vi.mocked(auth);

describe("sessionInfo", () => {
  beforeEach(async () => {
    await resetDb();
    mockedAuth.mockReset();
  });

  it("anonymous without a session", async () => {
    mockedAuth.mockResolvedValue(null as never);
    expect((await sessionInfo()).kind).toBe("anonymous");
  });

  it("no_profile when signed in but no user row", async () => {
    mockedAuth.mockResolvedValue({ googleSubject: "g-123" } as never);
    const info = await sessionInfo();
    expect(info).toEqual({ kind: "no_profile", googleSubject: "g-123" });
  });

  it("user when a profile exists", async () => {
    await db.insert(users).values({ googleSubject: "g-123", displayName: "Larry", houseId: "plunger" });
    mockedAuth.mockResolvedValue({ googleSubject: "g-123" } as never);
    const info = await sessionInfo();
    expect(info.kind).toBe("user");
  });
});
