import { describe, expect, it } from "vitest";
import { generateInviteCode, INVITE_ALPHABET } from "./invites";

/** Deterministic PRNG for reproducible tests. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe("generateInviteCode", () => {
  it("matches the SOT-XXXX-XXXX format", () => {
    const code = generateInviteCode(seeded(42));
    expect(code).toMatch(/^SOT-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it("uses only the unambiguous alphabet (no 0/O/1/I)", () => {
    const body = generateInviteCode(seeded(7)).replace(/^SOT-/, "").replace("-", "");
    for (const ch of body) {
      expect(INVITE_ALPHABET).toContain(ch);
    }
    expect(INVITE_ALPHABET).not.toContain("0");
    expect(INVITE_ALPHABET).not.toContain("O");
    expect(INVITE_ALPHABET).not.toContain("1");
    expect(INVITE_ALPHABET).not.toContain("I");
  });

  it("produces different codes for different rand streams", () => {
    const a = generateInviteCode(seeded(1));
    const b = generateInviteCode(seeded(2));
    expect(a).not.toBe(b);
  });

  it("is deterministic for the same rand stream", () => {
    expect(generateInviteCode(seeded(99))).toBe(generateInviteCode(seeded(99)));
  });
});
