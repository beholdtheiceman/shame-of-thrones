"use client";

import { useMemo, useState } from "react";
import { HOUSE_BY_ID, THRONE_CATEGORY_LABEL } from "@/lib/data";
import { throneScore } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { haversineMeters } from "@/lib/geo";
import { useNow } from "@/lib/useNow";
import type { Throne } from "@/lib/types";
import { SittingFlow } from "./SittingFlow";

const AMENITY_LABEL: Record<string, string> = {
  accessible: "Accessible",
  babyChanging: "Baby changing",
  genderNeutral: "Gender-neutral",
  freeAccess: "Free access",
  open24h: "Open 24h",
};

export function ThroneSheet({
  throne,
  onClose,
}: {
  throne: Throne;
  onClose: () => void;
}) {
  const { state, confirmThrone } = useStore();
  const [mode, setMode] = useState<"detail" | "sitting">("detail");
  const now = useNow();

  const { score, count } = useMemo(
    () => throneScore(throne.id, state.ratings, now),
    [throne.id, state.ratings, now]
  );

  const recentRatings = useMemo(
    () =>
      state.ratings
        .filter((r) => r.throneId === throne.id)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 4),
    [state.ratings, throne.id]
  );

  const daysSinceConfirmed = Math.floor((now - throne.lastConfirmedAt) / 86_400_000);
  const forgotten = now > 0 && daysSinceConfirmed > 120;

  const amenities = Object.entries(throne.amenities).filter(([, v]) => v);

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-ink/50 sm:items-center sm:p-6">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-vellum-line bg-vellum-raised shadow-2xl sm:rounded-2xl">
        {mode === "sitting" ? (
          <SittingFlow
            throne={throne}
            onCancel={() => setMode("detail")}
            onSubmitted={() => setMode("detail")}
          />
        ) : (
          <div className="p-5">
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-vellum-line sm:hidden" />

            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10.5px] uppercase tracking-widest text-ink-faint">
                  {THRONE_CATEGORY_LABEL[throne.category]}
                </p>
                <h2 className="mt-0.5 font-display text-xl font-bold text-ink text-balance">
                  {throne.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 rounded-full border border-vellum-line px-2.5 py-1 text-xs text-ink-faint hover:text-ink"
              >
                ✕
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {throne.status === "rumored" ? (
                <span className="rounded-full border border-brass/50 bg-brass/10 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-brass-strong">
                  Rumored
                </span>
              ) : (
                <span className="rounded-full border border-emerald/40 bg-emerald/10 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-emerald">
                  ✓ Verified
                </span>
              )}
              {forgotten && (
                <span className="rounded-full border border-crimson/40 bg-crimson/10 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-crimson">
                  Forgotten by the Realm
                </span>
              )}
              {score !== null ? (
                <span className="font-mono text-xs tabular text-ink-soft">
                  {score.toFixed(1)} / 5 · {count} sitting{count === 1 ? "" : "s"}
                </span>
              ) : (
                <span className="font-mono text-xs text-ink-faint">Unrated</span>
              )}
            </div>

            {throne.status === "rumored" && (
              <button
                type="button"
                onClick={() => confirmThrone(throne.id)}
                className="mt-3 w-full rounded-lg border border-brass py-2 text-xs font-semibold uppercase tracking-wide text-brass-strong hover:bg-brass/10"
              >
                Confirm this throne is real (+25 Influence)
              </button>
            )}

            {amenities.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {amenities.map(([k]) => (
                  <span
                    key={k}
                    className="rounded-full bg-vellum px-2.5 py-1 text-[10.5px] text-ink-soft"
                  >
                    {AMENITY_LABEL[k]}
                  </span>
                ))}
              </div>
            )}

            {recentRatings.length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  Recent testimony
                </p>
                <ul className="mt-2 space-y-2.5">
                  {recentRatings.map((r) => (
                    <li key={r.id} className="rounded-lg bg-vellum p-2.5 text-xs">
                      <div className="flex items-center justify-between text-[10.5px] text-ink-faint">
                        <span>
                          {r.authorName} ·{" "}
                          <span style={{ color: HOUSE_BY_ID[r.houseId].colorVar }}>
                            {HOUSE_BY_ID[r.houseId].name}
                          </span>
                        </span>
                        <span className="tabular">{r.verdict}/5</span>
                      </div>
                      {r.testimony && (
                        <p className="mt-1 italic text-ink-soft">&ldquo;{r.testimony}&rdquo;</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button
              type="button"
              onClick={() => setMode("sitting")}
              className="mt-5 w-full rounded-lg bg-brass py-3 text-center text-xs font-bold uppercase tracking-widest text-on-brass"
            >
              Sit Here
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function isWithinProximity(throne: Throne, lat: number, lng: number): boolean {
  return haversineMeters({ lat: throne.lat, lng: throne.lng }, { lat, lng }) <= 75;
}
