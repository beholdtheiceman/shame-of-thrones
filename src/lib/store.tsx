"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { api, ApiError, type MeDTO, type RealmDTO } from "./api";
import type { Amenities, HouseId, ThroneCategory } from "./types";

export type AuthStatus = "loading" | "anonymous" | "needs_profile" | "ready";

export interface StoreState {
  authStatus: AuthStatus;
  profile: MeDTO["profile"];
  rank: MeDTO["rank"] | null;
  ageGate: { confirmed: boolean; locked: boolean } | null;
  realm: RealmDTO | null;
  error: string | null;
}

const POLL_MS = 30_000;

interface StoreContextValue {
  state: StoreState;
  refresh: () => Promise<void>;
  setProfile: (name: string, houseId: HouseId) => Promise<void>;
  switchHouse: (houseId: HouseId) => Promise<void>;
  submitAgeGate: (birthDate: string) => Promise<void>;
  submitRating: (input: { throneId: string; verdict: 1 | 2 | 3 | 4 | 5; tags: string[]; testimony: string; verified: boolean }) => Promise<void>;
  addThrone: (input: { name: string; lat: number; lng: number; category: ThroneCategory; amenities: Amenities; publicAccessAttested: boolean }) => Promise<void>;
  confirmThrone: (throneId: string) => Promise<void>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<StoreState>({
    authStatus: "loading", profile: null, rank: null, ageGate: null, realm: null, error: null,
  });
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const [realm, me] = await Promise.all([
        api.realm(),
        api.me().catch((e) => {
          if (e instanceof ApiError && e.status === 401) return null;
          throw e;
        }),
      ]);
      setState({
        realm,
        profile: me?.profile ?? null,
        rank: me?.rank ?? null,
        ageGate: me?.ageGate ?? null,
        authStatus: me === null ? "anonymous" : me.profile === null ? "needs_profile" : "ready",
        error: null,
      });
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : "the ravens were lost" }));
    } finally {
      refreshing.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
    };
  }, [refresh]);

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
      setProfile: (name, houseId) => mutate(() => api.createProfile(name, houseId)),
      switchHouse: (houseId) => mutate(() => api.switchHouse(houseId)),
      submitAgeGate: (birthDate) => mutate(() => api.ageGate(birthDate)),
      submitRating: ({ testimony: _ignored, ...input }) => mutate(() => api.submitRating(input)),
      addThrone: (input) => mutate(() => api.addThrone(input)),
      confirmThrone: (throneId) => mutate(() => api.confirmThrone(throneId)),
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
