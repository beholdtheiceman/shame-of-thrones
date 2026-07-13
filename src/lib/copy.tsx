"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

/** Functional UI copy only — game identity (Houses, ranks, Ledger) stays
 * themed in both modes (spec §1). Themed strings must match the previous
 * hardcoded strings byte-for-byte. */
export const COPY = {
  sitHere: { themed: "Sit Here", plain: "Rate this restroom" },
  chartThrone: { themed: "+ Chart a Throne", plain: "+ Add a restroom" },
  nearestWorthy: { themed: "⚔️ Nearest Worthy Throne", plain: "Find the nearest good restroom" },
  confirmThrone: { themed: "Confirm this throne is real (+3 Influence)", plain: "Confirm this restroom exists (+3 points)" },
  rumored: { themed: "Rumored", plain: "Unverified" },
  verifiedChip: { themed: "✓ Verified", plain: "✓ Verified" },
  forgotten: { themed: "Forgotten by the Realm", plain: "Not confirmed in 120+ days" },
  unrated: { themed: "Unrated", plain: "No ratings yet" },
  sittingSingular: { themed: "sitting", plain: "rating" },
  sittingPlural: { themed: "sittings", plain: "ratings" },
  recentTestimony: { themed: "Recent testimony", plain: "Recent reviews" },
  offerPortrait: { themed: "Offer a Portrait", plain: "Photos" },
  photoRules: { themed: "Entrances, signage, and sinks only. No people — any face means rejection.", plain: "Entrances, signage, and sinks only. No people — photos with faces are rejected." },
  photoPendingChip: { themed: "awaits the Maesters' review", plain: "pending review" },
  photoRefusedChip: { themed: "refused", plain: "rejected" },
  photoPendingMsg: { themed: "This portrait awaits the Maesters' review.", plain: "Your photo is pending moderator review." },
  photoRefusedMsg: { themed: "The Maesters have refused this portrait.", plain: "Your photo was rejected." },
  reportTitle: { themed: "▸ Report to the Maesters", plain: "▸ Report content" },
  reportPlaceholder: { themed: "Anything the Maesters should know? (optional)", plain: "Additional details (optional)" },
  reportDone: { themed: "The Maesters will review", plain: "A moderator will review" },
  connectionError: { themed: "the ravens were lost", plain: "connection error — please try again" },
  thisFief: { themed: "This Fief", plain: "This area" },
  holdsThisLand: { themed: "holds this land", plain: "leads this area" },
  noHouseHolds: { themed: "No House holds this land", plain: "No team leads this area" },
  contested: { themed: "Contested", plain: "Contested" },
  offlineBanner: { themed: "The ravens cannot fly — you see the Realm as it was", plain: "You're offline — showing saved data" },
  ratingQueued: { themed: "Your deed will be sung when the ravens return.", plain: "Saved — your rating will submit when you're back online." },
  queueDropped: { themed: "A queued deed was refused by the Maesters.", plain: "A saved rating couldn't be submitted." },
  smallCouncil: { themed: "Small Council", plain: "Top Contributors" },
  houseStandings: { themed: "House Standings", plain: "Team Standings" },
  allHouses: { themed: "All Houses", plain: "All Teams" },
  myHouse: { themed: "My House", plain: "My Team" },
  noStandingsDeeds: { themed: "No deeds recorded here yet — be the first.", plain: "No contributions here yet — be the first." },
  standingsSignIn: { themed: "Sign in to take your seat on the Small Council.", plain: "Sign in to appear on the contributor list." },
} as const;

export type CopyKey = keyof typeof COPY;

export function copyFor(key: CopyKey, plain: boolean): string {
  const entry = COPY[key];
  if (!entry) return String(key); // never throw, never blank
  return plain ? entry.plain : entry.themed;
}

const PlainSpeechContext = createContext<{ plain: boolean; toggle: () => void }>({
  plain: false,
  toggle: () => {},
});

export function PlainSpeechProvider({ children }: { children: ReactNode }) {
  const [plain, setPlain] = useState(false); // themed on first paint (SSR-safe)
  useEffect(() => {
    try {
      setPlain(window.localStorage.getItem("sot-plain-speech") === "1");
    } catch {
      // storage unavailable — session-only state
    }
  }, []);
  const toggle = useCallback(() => {
    setPlain((p) => {
      const next = !p;
      try {
        window.localStorage.setItem("sot-plain-speech", next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);
  return (
    <PlainSpeechContext.Provider value={{ plain, toggle }}>
      {children}
    </PlainSpeechContext.Provider>
  );
}

export function usePlainSpeech() {
  return useContext(PlainSpeechContext);
}

export function useCopy() {
  const { plain } = useContext(PlainSpeechContext);
  return useCallback((key: CopyKey) => copyFor(key, plain), [plain]);
}
