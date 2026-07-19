import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import { api, ApiError, type MeDTO, type NotificationsDTO, type NotifyPrefsDTO, type RealmDTO } from "./api";
import { enqueue, flush, pending, type QueuedRating } from "@sot/core";
import type { Amenities, HouseId, ThroneCategory } from "@sot/core";
import { mmkvStorage } from "./mmkv";

export type AuthStatus = "loading" | "anonymous" | "needs_profile" | "ready";

export interface StoreState {
  authStatus: AuthStatus;
  profile: MeDTO["profile"];
  rank: MeDTO["rank"] | null;
  streak: MeDTO["streak"] | null;
  ageGate: { confirmed: boolean; locked: boolean } | null;
  cosmetics: MeDTO["cosmetics"] | null;
  realm: RealmDTO | null;
  notifications: NotificationsDTO;
  error: string | null;
  offline: boolean;
  snapshotSavedAt: number | null;
  queuedCount: number;
  queueDropped: boolean;
}

const POLL_MS = 30_000;

interface StoreContextValue {
  state: StoreState;
  refresh: () => Promise<void>;
  clearQueueNotice: () => void;
  setProfile: (name: string, houseId: HouseId) => Promise<void>;
  switchHouse: (houseId: HouseId) => Promise<void>;
  updateNotifyPrefs: (prefs: NotifyPrefsDTO) => Promise<void>;
  markNotificationsRead: (ids?: string[]) => Promise<void>;
  submitAgeGate: (birthDate: string) => Promise<void>;
  submitRating: (input: { throneId: string; verdict: 1 | 2 | 3 | 4 | 5; tags: string[]; testimony: string; verified: boolean }) => Promise<{ testimonyBlocked: boolean; queued: boolean; blessed: boolean }>;
  addThrone: (input: { name: string; lat: number; lng: number; category: ThroneCategory; amenities: Amenities; publicAccessAttested: boolean }) => Promise<void>;
  confirmThrone: (throneId: string) => Promise<void>;
  equipCosmetic: (category: string, sku: string | null) => Promise<void>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

const SNAPSHOT_KEY = "sot-realm-snapshot";

// Realm offline snapshot lives in the same MMKV instance as the rating queue.
function saveSnapshot(realm: RealmDTO): void {
  try {
    mmkvStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ savedAt: Date.now(), realm }));
  } catch {}
}

function loadSnapshot(): { savedAt: number; realm: RealmDTO } | null {
  try {
    const parsed = JSON.parse(mmkvStorage.getItem(SNAPSHOT_KEY) ?? "null");
    return parsed && typeof parsed.savedAt === "number" && parsed.realm ? parsed : null;
  } catch {
    return null;
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StoreState>({
    authStatus: "loading", profile: null, rank: null, streak: null, ageGate: null, cosmetics: null, realm: null, error: null,
    notifications: { notifications: [], unreadCount: 0 },
    offline: false, snapshotSavedAt: null, queuedCount: pending(mmkvStorage).length, queueDropped: false,
  });
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const [realm, me, notificationData] = await Promise.all([
        api.realm(),
        api.me().catch((e) => {
          if (e instanceof ApiError && e.status === 401) return null;
          throw e;
        }),
        api.notifications().catch((e) => {
          if (e instanceof ApiError && e.status === 401) return null;
          throw e;
        }),
      ]);
      saveSnapshot(realm);
      setState((s) => ({
        ...s,
        realm,
        profile: me?.profile ?? null,
        rank: me?.rank ?? null,
        streak: me?.streak ?? null,
        ageGate: me?.ageGate ?? null,
        cosmetics: me?.cosmetics ?? null,
        notifications: notificationData ?? { notifications: [], unreadCount: 0 },
        authStatus: me === null ? "anonymous" : me.profile === null ? "needs_profile" : "ready",
        error: null,
        offline: false,
        snapshotSavedAt: null,
      }));
    } catch (e) {
      if (!(e instanceof ApiError)) {
        const snap = loadSnapshot();
        setState((s) => ({
          ...s,
          realm: s.realm ?? snap?.realm ?? null,
          authStatus: s.authStatus === "loading" ? "anonymous" : s.authStatus, // cold offline start = read-only browsing (spec §3)
          offline: true,
          // the on-disk snapshot always carries the last successful fetch time
          snapshotSavedAt: snap?.savedAt ?? s.snapshotSavedAt,
          error: null,
        }));
      } else {
        // an HTTP response means we are online again, whatever the status code
        setState((s) => ({ ...s, error: e.message, offline: false, snapshotSavedAt: null }));
      }
    } finally {
      refreshing.current = false;
    }
  }, []);

  const runFlush = useCallback(async () => {
    const result = await flush(
      async (r: QueuedRating) => {
        await api.submitRating({ throneId: r.throneId, verdict: r.verdict, tags: r.tags, verified: r.verified, testimony: r.testimony });
      },
      (e) => e instanceof ApiError,
      mmkvStorage
    );
    if (result.submitted > 0 || result.dropped.length > 0) {
      setState((s) => ({ ...s, queuedCount: pending(mmkvStorage).length, queueDropped: s.queueDropped || result.dropped.length > 0 }));
      // refresh() no-ops while another refresh is in flight (mount race) —
      // wait it out so the flushed ratings actually appear.
      for (let i = 0; i < 20 && refreshing.current; i++) {
        await new Promise((r) => setTimeout(r, 150));
      }
      await refresh();
    }
  }, [refresh]);

  // Mount: initial fetch + flush any queued ratings. Then keep the realm fresh
  // via a poll interval and by refreshing/flushing whenever the app returns to
  // the foreground (RN AppState replaces the web `focus`/`online` events; there
  // is no browser `online` event on native — NetInfo is a possible follow-up).
  useEffect(() => {
    void refresh();
    void runFlush();
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") {
        void refresh();
        void runFlush();
      }
    });
    const interval = setInterval(() => void refresh(), POLL_MS);
    return () => {
      sub.remove();
      clearInterval(interval);
    };
  }, [refresh, runFlush]);

  const mutate = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } finally {
        await refresh();
      }
    },
    [refresh]
  );

  const value = useMemo<StoreContextValue>(
    () => ({
      state,
      refresh,
      clearQueueNotice: () => setState((s) => ({ ...s, queueDropped: false })),
      setProfile: (name, houseId) => mutate(() => api.createProfile(name, houseId)),
      switchHouse: (houseId) => mutate(() => api.switchHouse(houseId)),
      updateNotifyPrefs: (prefs) => mutate(() => api.updateNotifyPrefs(prefs)),
      markNotificationsRead: async (ids) => {
        await api.markNotificationsRead(ids);
        const latest = await api.notifications();
        setState((s) => ({ ...s, notifications: latest }));
      },
      submitAgeGate: (birthDate) => mutate(() => api.ageGate(birthDate)),
      submitRating: async (input) => {
        const payload = {
          throneId: input.throneId, verdict: input.verdict, tags: input.tags, verified: input.verified,
          testimony: input.testimony.trim() || undefined,
        };
        try {
          const res = await api.submitRating(payload);
          await refresh();
          return { testimonyBlocked: !!res.testimonyBlocked, queued: false, blessed: !!res.blessed };
        } catch (e) {
          if (e instanceof ApiError) {
            await refresh();
            throw e; // server rejections keep today's behavior
          }
          const persisted = enqueue({ ...payload, queuedAt: Date.now() }, mmkvStorage);
          if (!persisted) throw e; // no storage — behave exactly as online-only (spec)
          setState((s) => ({ ...s, offline: true, queuedCount: pending(mmkvStorage).length }));
          return { testimonyBlocked: false, queued: true, blessed: false };
        }
      },
      addThrone: (input) => mutate(() => api.addThrone(input)),
      confirmThrone: (throneId) => mutate(() => api.confirmThrone(throneId)),
      equipCosmetic: async (category: string, sku: string | null) => {
        const { equipped } = await api.equipCosmetic(category, sku);
        setState((s) => ({
          ...s,
          cosmetics: s.cosmetics ? { ...s.cosmetics, equipped } : { owned: [], equipped },
        }));
      },
    }),
    [state, refresh, mutate]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
