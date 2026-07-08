"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from "react";
import {
  HOUSE_BY_ID,
  SEED_INFLUENCE,
  SEED_LEDGER,
  SEED_RATINGS,
  SEED_THRONES,
} from "./data";
import { fiefControl } from "./selectors";
import { fiefIdForCoords } from "./geo";
import type {
  Amenities,
  BadgeId,
  HouseId,
  InfluenceEvent,
  LedgerEntry,
  Profile,
  StoreState,
  Throne,
  ThroneCategory,
} from "./types";

const STORAGE_KEY = "shame-of-thrones:v1";

function initialState(): StoreState {
  return {
    profile: null,
    thrones: SEED_THRONES,
    ratings: SEED_RATINGS,
    influenceEvents: SEED_INFLUENCE,
    ledger: [...SEED_LEDGER].sort((a, b) => b.createdAt - a.createdAt),
  };
}

type Action =
  | { type: "HYDRATE"; state: StoreState }
  | { type: "SET_PROFILE"; name: string; houseId: HouseId }
  | { type: "SWITCH_HOUSE"; houseId: HouseId }
  | {
      type: "SUBMIT_RATING";
      throneId: string;
      verdict: 1 | 2 | 3 | 4 | 5;
      tags: string[];
      testimony: string;
      verified: boolean;
    }
  | {
      type: "ADD_THRONE";
      name: string;
      lat: number;
      lng: number;
      category: ThroneCategory;
      amenities: Amenities;
    }
  | { type: "CONFIRM_THRONE"; throneId: string };

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function pushLedger(state: StoreState, text: string): LedgerEntry[] {
  const entry: LedgerEntry = { id: uid("l"), createdAt: Date.now(), text };
  return [entry, ...state.ledger].slice(0, 60);
}

function withBadge(profile: Profile, badge: BadgeId): Profile {
  if (profile.badges.includes(badge)) return profile;
  return { ...profile, badges: [...profile.badges, badge] };
}

function reducer(state: StoreState, action: Action): StoreState {
  switch (action.type) {
    case "HYDRATE":
      return action.state;

    case "SET_PROFILE": {
      const profile: Profile = {
        name: action.name,
        houseId: action.houseId,
        joinedAt: Date.now(),
        badges: [],
        lastHouseSwitchAt: null,
      };
      return {
        ...state,
        profile,
        ledger: pushLedger(
          state,
          `**${action.name}** pledges the oath to **${HOUSE_BY_ID[action.houseId].name}**.`
        ),
      };
    }

    case "SWITCH_HOUSE": {
      if (!state.profile) return state;
      const profile: Profile = {
        ...state.profile,
        houseId: action.houseId,
        lastHouseSwitchAt: Date.now(),
      };
      return {
        ...state,
        profile,
        ledger: pushLedger(
          state,
          `**${profile.name}** breaks their oath and rides for **${HOUSE_BY_ID[action.houseId].name}**.`
        ),
      };
    }

    case "SUBMIT_RATING": {
      const { profile } = state;
      if (!profile) return state;
      const throne = state.thrones.find((t) => t.id === action.throneId);
      if (!throne) return state;

      const now = Date.now();
      const isFirstRating = !state.ratings.some((r) => r.throneId === throne.id);
      const fiefId = fiefIdForCoords(throne.lat, throne.lng);
      const before = fiefControl(fiefId, state.influenceEvents, now);

      const rating = {
        id: uid("r"),
        throneId: throne.id,
        authorName: profile.name,
        houseId: profile.houseId,
        verdict: action.verdict,
        tags: action.tags,
        testimony: action.testimony,
        verified: action.verified,
        createdAt: now,
      };

      const basePoints = action.verified ? 10 : 2;
      const ratingReason: InfluenceEvent["reason"] = action.verified ? "rating" : "hearsay";
      const influenceEvents = [
        ...state.influenceEvents,
        {
          id: uid("i"),
          fiefId,
          houseId: profile.houseId,
          points: basePoints,
          reason: ratingReason,
          throneId: throne.id,
          authorName: profile.name,
          createdAt: now,
        },
        ...(isFirstRating
          ? [
              {
                id: uid("i"),
                fiefId,
                houseId: profile.houseId,
                points: 15,
                reason: "first_of_name" as const,
                throneId: throne.id,
                authorName: profile.name,
                createdAt: now,
              },
            ]
          : []),
      ];

      const after = fiefControl(fiefId, influenceEvents, now);
      const points = basePoints + (isFirstRating ? 15 : 0);

      let ledger = state.ledger;
      const flipped =
        after.leader &&
        (!before.leader || before.leader.houseId !== after.leader.houseId);
      if (flipped && after.leader) {
        ledger = pushLedger(
          { ...state, ledger },
          `🏰 **${HOUSE_BY_ID[after.leader.houseId].name}** has seized the Fief around **${throne.name}**!`
        );
      } else {
        ledger = pushLedger(
          { ...state, ledger },
          `**${profile.name}** struck a banner for **${HOUSE_BY_ID[profile.houseId].name}** at **${throne.name}** (+${points} Influence).`
        );
      }

      let nextProfile = profile;
      if (isFirstRating) {
        nextProfile = withBadge(nextProfile, "first_of_their_name");
        ledger = pushLedger(
          { ...state, ledger },
          `🏅 **${profile.name}** earns "First of Their Name" — first rating at **${throne.name}**.`
        );
      }

      return {
        ...state,
        profile: nextProfile,
        ratings: [...state.ratings, rating],
        influenceEvents,
        thrones: state.thrones.map((t) =>
          t.id === throne.id ? { ...t, lastConfirmedAt: now } : t
        ),
        ledger,
      };
    }

    case "ADD_THRONE": {
      const { profile } = state;
      if (!profile) return state;
      const now = Date.now();
      const throne: Throne = {
        id: uid("throne"),
        name: action.name,
        lat: action.lat,
        lng: action.lng,
        category: action.category,
        status: "rumored",
        amenities: action.amenities,
        addedBy: profile.name,
        addedAt: now,
        lastConfirmedAt: now,
      };

      const nextProfile = withBadge(profile, "cartographer");
      const ledger = pushLedger(
        state,
        `📜 **${profile.name}** charts a new throne — **${throne.name}** enters the Realm as *Rumored*.`
      );

      return {
        ...state,
        profile: nextProfile,
        thrones: [...state.thrones, throne],
        ledger,
      };
    }

    case "CONFIRM_THRONE": {
      const { profile } = state;
      if (!profile) return state;
      const throne = state.thrones.find((t) => t.id === action.throneId);
      if (!throne || throne.status === "verified") return state;
      const now = Date.now();
      const fiefId = fiefIdForCoords(throne.lat, throne.lng);

      const influenceEvents = [
        ...state.influenceEvents,
        {
          id: uid("i"),
          fiefId,
          houseId: profile.houseId,
          points: 25,
          reason: "new_throne" as const,
          throneId: throne.id,
          authorName: profile.name,
          createdAt: now,
        },
      ];

      const ledger = pushLedger(
        state,
        `✅ **${profile.name}** confirms **${throne.name}** is real — it enters the Realm's official record (+25 Influence).`
      );

      return {
        ...state,
        influenceEvents,
        thrones: state.thrones.map((t) =>
          t.id === throne.id
            ? { ...t, status: "verified", lastConfirmedAt: now }
            : t
        ),
        ledger,
      };
    }

    default:
      return state;
  }
}

interface StoreContextValue {
  state: StoreState;
  setProfile: (name: string, houseId: HouseId) => void;
  switchHouse: (houseId: HouseId) => void;
  submitRating: (input: {
    throneId: string;
    verdict: 1 | 2 | 3 | 4 | 5;
    tags: string[];
    testimony: string;
    verified: boolean;
  }) => void;
  addThrone: (input: {
    name: string;
    lat: number;
    lng: number;
    category: ThroneCategory;
    amenities: Amenities;
  }) => void;
  confirmThrone: (throneId: string) => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) dispatch({ type: "HYDRATE", state: JSON.parse(raw) });
    } catch {
      // corrupt or inaccessible storage — fall back to seed state
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage full or unavailable — state stays in-memory for this session
    }
  }, [state]);

  const setProfile = useCallback(
    (name: string, houseId: HouseId) => dispatch({ type: "SET_PROFILE", name, houseId }),
    []
  );
  const switchHouse = useCallback(
    (houseId: HouseId) => dispatch({ type: "SWITCH_HOUSE", houseId }),
    []
  );
  const submitRating: StoreContextValue["submitRating"] = useCallback(
    (input) => dispatch({ type: "SUBMIT_RATING", ...input }),
    []
  );
  const addThrone: StoreContextValue["addThrone"] = useCallback(
    (input) => dispatch({ type: "ADD_THRONE", ...input }),
    []
  );
  const confirmThrone = useCallback(
    (throneId: string) => dispatch({ type: "CONFIRM_THRONE", throneId }),
    []
  );

  const value = useMemo<StoreContextValue>(
    () => ({ state, setProfile, switchHouse, submitRating, addThrone, confirmThrone }),
    [state, setProfile, switchHouse, submitRating, addThrone, confirmThrone]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
