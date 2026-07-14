import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { pushTokens } from "@/db/schema";
import { sendPushToUser } from "@/lib/server/push";
import { resetDb } from "./db";
import { makeUser } from "./fixtures";

describe("sendPushToUser", () => {
  beforeEach(async () => {
    await resetDb();
    vi.restoreAllMocks();
  });

  it("POSTs one message per token to the Expo push endpoint", async () => {
    const user = await makeUser();
    await db.insert(pushTokens).values([
      { userId: user.id, token: "ExponentPushToken[aaa]", platform: "ios" },
      { userId: user.id, token: "ExponentPushToken[bbb]", platform: "android" },
    ]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await sendPushToUser(user.id, { title: "Contested!", body: "Your fief is contested.", data: { link: "abc" } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://exp.host/--/api/v2/push/send");
    expect(init.headers["content-type"]).toBe("application/json");
    const sent = JSON.parse(init.body);
    expect(sent).toHaveLength(2);
    expect(sent.map((m: { to: string }) => m.to).sort()).toEqual([
      "ExponentPushToken[aaa]",
      "ExponentPushToken[bbb]",
    ]);
    expect(sent[0]).toMatchObject({ title: "Contested!", body: "Your fief is contested.", data: { link: "abc" } });

    vi.unstubAllGlobals();
  });

  it("swallows a fetch rejection instead of throwing", async () => {
    const user = await makeUser();
    await db.insert(pushTokens).values([{ userId: user.id, token: "ExponentPushToken[ccc]" }]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(
      sendPushToUser(user.id, { title: "t", body: "b" })
    ).resolves.toBeUndefined();

    vi.unstubAllGlobals();
  });

  it("does not call fetch when the user has no tokens", async () => {
    const user = await makeUser();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await sendPushToUser(user.id, { title: "t", body: "b" });

    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
