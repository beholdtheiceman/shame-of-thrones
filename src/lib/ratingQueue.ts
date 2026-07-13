export interface QueuedRating {
  throneId: string;
  verdict: 1 | 2 | 3 | 4 | 5;
  tags: string[];
  verified: boolean;
  testimony?: string;
  queuedAt: number;
}

export interface FlushResult {
  submitted: number;
  dropped: QueuedRating[];
  halted: boolean; // network failure mid-flush; remainder kept for next trigger
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY = "sot-rating-queue";

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function write(queue: QueuedRating[], storage: StorageLike): void {
  try {
    storage.setItem(KEY, JSON.stringify(queue));
  } catch {
    // quota/privacy failure — queue silently disabled (spec: degrade to online-only)
  }
}

export function pending(storage: StorageLike | null = defaultStorage()): QueuedRating[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as QueuedRating[]) : [];
  } catch {
    try { storage.removeItem(KEY); } catch {}
    return [];
  }
}

export function enqueue(rating: QueuedRating, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  write([...pending(storage), rating], storage);
}

let flushing = false;

/** Sequential, ordered flush. `isHttpError` distinguishes a server rejection
 * (drop, keep going) from a network failure (halt, keep the rest). */
export async function flush(
  submit: (r: QueuedRating) => Promise<void>,
  isHttpError: (e: unknown) => boolean,
  storage: StorageLike | null = defaultStorage()
): Promise<FlushResult> {
  const result: FlushResult = { submitted: 0, dropped: [], halted: false };
  if (flushing || !storage) return result;
  flushing = true;
  try {
    let queue = pending(storage);
    while (queue.length > 0) {
      const head = queue[0];
      try {
        await submit(head);
        result.submitted++;
      } catch (e) {
        if (isHttpError(e)) {
          result.dropped.push(head);
        } else {
          result.halted = true;
          break;
        }
      }
      queue = queue.slice(1);
      write(queue, storage);
    }
    return result;
  } finally {
    flushing = false;
  }
}
