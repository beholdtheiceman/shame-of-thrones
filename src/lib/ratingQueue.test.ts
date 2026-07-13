import { describe, expect, it } from "vitest";
import { enqueue, flush, pending, type QueuedRating } from "./ratingQueue";

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

function rating(over: Partial<QueuedRating> = {}): QueuedRating {
  return { throneId: "t1", verdict: 4, tags: [], verified: true, queuedAt: 1, ...over };
}

class HttpError extends Error { constructor(public status: number) { super("http"); } }
const isHttp = (e: unknown) => e instanceof HttpError;

describe("ratingQueue", () => {
  it("enqueue/pending round-trips", () => {
    const s = memStorage();
    enqueue(rating({ throneId: "a" }), s);
    enqueue(rating({ throneId: "b" }), s);
    expect(pending(s).map((r) => r.throneId)).toEqual(["a", "b"]);
  });

  it("flush submits in order and empties the queue", async () => {
    const s = memStorage();
    enqueue(rating({ throneId: "a" }), s);
    enqueue(rating({ throneId: "b" }), s);
    const seen: string[] = [];
    const res = await flush(async (r) => { seen.push(r.throneId); }, isHttp, s);
    expect(seen).toEqual(["a", "b"]);
    expect(res).toMatchObject({ submitted: 2, halted: false });
    expect(res.dropped).toEqual([]);
    expect(pending(s)).toEqual([]);
  });

  it("drops on http error and continues", async () => {
    const s = memStorage();
    enqueue(rating({ throneId: "bad" }), s);
    enqueue(rating({ throneId: "good" }), s);
    const res = await flush(async (r) => {
      if (r.throneId === "bad") throw new HttpError(404);
    }, isHttp, s);
    expect(res.submitted).toBe(1);
    expect(res.dropped.map((r) => r.throneId)).toEqual(["bad"]);
    expect(pending(s)).toEqual([]);
  });

  it("halts on network error and keeps the remainder", async () => {
    const s = memStorage();
    enqueue(rating({ throneId: "a" }), s);
    enqueue(rating({ throneId: "b" }), s);
    const res = await flush(async () => { throw new TypeError("failed to fetch"); }, isHttp, s);
    expect(res).toMatchObject({ submitted: 0, halted: true });
    expect(pending(s).map((r) => r.throneId)).toEqual(["a", "b"]);
  });

  it("resets a malformed queue", () => {
    const s = memStorage();
    s.setItem("sot-rating-queue", "{nonsense");
    expect(pending(s)).toEqual([]);
  });

  it("guards against concurrent flushes", async () => {
    const s = memStorage();
    enqueue(rating(), s);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const first = flush(async () => { await gate; }, isHttp, s);
    const second = await flush(async () => {}, isHttp, s);
    expect(second).toMatchObject({ submitted: 0, halted: false });
    release();
    expect((await first).submitted).toBe(1);
  });
});
