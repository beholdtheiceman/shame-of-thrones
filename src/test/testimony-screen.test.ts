import { describe, expect, it } from "vitest";
import { screenTestimony, type ScreenClient } from "@/lib/server/testimonyScreen";

describe("screenTestimony", () => {
  it("passes through the client's verdict", async () => {
    const fake: ScreenClient = {
      async screen() { return { verdict: "block", category: "doxxing", note: "contains a street address" }; },
    };
    const result = await screenTestimony("123 Main St, ask for Dave", fake);
    expect(result.verdict).toBe("block");
    expect(result.category).toBe("doxxing");
  });

  it("fails OPEN on client error — flag with screen_unavailable", async () => {
    const failing: ScreenClient = {
      async screen() { throw new Error("api down"); },
    };
    const result = await screenTestimony("a fine privy", failing);
    expect(result.verdict).toBe("flag");
    expect(result.category).toBe("screen_unavailable");
    expect(result.note).toContain("api down");
  });
});
