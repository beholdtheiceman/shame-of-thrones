import { createMMKV, type MMKV } from "react-native-mmkv";

/**
 * Core's `ratingQueue` (enqueue/flush/pending) accepts an optional synchronous
 * storage shaped like the DOM `Storage` interface. MMKV is synchronous, so it
 * maps cleanly onto this contract. Re-declared locally (rather than imported
 * from a DOM lib) to keep mobile code free of browser globals.
 */
export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

// Single shared MMKV instance for the whole app (rating queue + realm snapshot).
export const mmkv: MMKV = createMMKV({ id: "sot-mobile" });

/**
 * Adapter exposing the MMKV singleton as core's `StorageLike`.
 * MMKV v4 (Nitro) renamed `delete` → `remove`, and `getString` returns
 * `string | undefined`, so we coalesce to `null` to satisfy the contract.
 */
export const mmkvStorage: StorageLike = {
  getItem: (key) => mmkv.getString(key) ?? null,
  setItem: (key, value) => mmkv.set(key, value),
  removeItem: (key) => {
    mmkv.remove(key);
  },
};
