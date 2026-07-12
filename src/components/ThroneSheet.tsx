"use client";

import { useMemo, useState } from "react";
import { ApiError, type ThroneDTO } from "@/lib/api";
import { HOUSE_BY_ID, THRONE_CATEGORY_LABEL } from "@/lib/data";
import { useStore } from "@/lib/store";
import { haversineMeters } from "@/lib/geo";
import { useNow } from "@/lib/useNow";
import type { Throne } from "@/lib/types";
import { ReportModal } from "./ReportModal";
import { SignInGate } from "./SignInGate";
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
  throne: ThroneDTO;
  onClose: () => void;
}) {
  const { state, confirmThrone } = useStore();
  const [mode, setMode] = useState<"detail" | "sitting">("detail");
  const [showSignInGate, setShowSignInGate] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [reporting, setReporting] = useState<{ kind: "throne" | "rating"; id: string; label: string } | null>(null);
  const now = useNow();

  const score = throne.score;
  const count = throne.ratingCount;

  const recentRatings = useMemo(
    () =>
      (state.realm?.ratings ?? [])
        .filter((r) => r.throneId === throne.id)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 4),
    [state.realm?.ratings, throne.id]
  );

  async function handleConfirm() {
    if (state.authStatus === "anonymous") {
      setShowSignInGate(true);
      return;
    }
    setConfirmError(null);
    try {
      await confirmThrone(throne.id);
    } catch (e) {
      setConfirmError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "the ravens were lost");
    }
  }

  const daysSinceConfirmed = Math.floor((now - throne.lastConfirmedAt) / 86_400_000);
  const forgotten = now > 0 && daysSinceConfirmed > 120;

  const amenities = Object.entries(throne.amenities).filter(([, v]) => v);

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/60 sm:items-center sm:p-6">
      <div className="pixel-panel max-h-[85vh] w-full max-w-md overflow-y-auto sm:mt-0">
        {mode === "sitting" ? (
          <SittingFlow
            throne={throne}
            onCancel={() => setMode("detail")}
            onSubmitted={() => setMode("detail")}
          />
        ) : (
          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[13px] uppercase tracking-widest text-brass">
                  {THRONE_CATEGORY_LABEL[throne.category]}
                </p>
                <h2 className="mt-1 font-display text-[15px] leading-relaxed text-ink text-balance">
                  {throne.name}
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {state.authStatus === "ready" && (
                  <button type="button" onClick={() => setReporting({ kind: "throne", id: throne.id, label: throne.name })}
                    className="font-mono text-[11px] uppercase tracking-wide text-ink-faint underline">
                    Report
                  </button>
                )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="pixel-chip shrink-0 bg-vellum px-2.5 py-1 font-mono text-sm text-ink-faint hover:text-ink"
              >
                ✕
              </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {throne.status === "rumored" ? (
                <span className="pixel-chip bg-brass/20 px-2.5 py-1 font-mono text-[13px] uppercase tracking-wide text-brass-strong">
                  Rumored
                </span>
              ) : (
                <span className="pixel-chip bg-emerald/20 px-2.5 py-1 font-mono text-[13px] uppercase tracking-wide text-emerald">
                  ✓ Verified
                </span>
              )}
              {forgotten && (
                <span className="pixel-chip bg-crimson/20 px-2.5 py-1 font-mono text-[13px] uppercase tracking-wide text-crimson">
                  Forgotten by the Realm
                </span>
              )}
              {score !== null ? (
                <span className="font-mono text-[15px] tabular text-ink-soft">
                  {score.toFixed(1)} / 5 · {count} sitting{count === 1 ? "" : "s"}
                </span>
              ) : (
                <span className="font-mono text-[15px] text-ink-faint">Unrated</span>
              )}
            </div>

            {throne.status === "rumored" && (
              <button
                type="button"
                onClick={handleConfirm}
                className="pixel-btn mt-3 w-full py-2.5 font-mono text-[14px] uppercase tracking-wide"
              >
                Confirm this throne is real (+3 Influence)
              </button>
            )}
            {showSignInGate && <SignInGate />}
            {confirmError && (
              <p className="mt-3 font-mono text-[13px] text-crimson">{confirmError}</p>
            )}

            {amenities.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {amenities.map(([k]) => (
                  <span
                    key={k}
                    className="pixel-chip bg-vellum px-2.5 py-1 font-mono text-[13px] text-ink-soft"
                  >
                    {AMENITY_LABEL[k]}
                  </span>
                ))}
              </div>
            )}

            {recentRatings.length > 0 && (
              <div className="mt-5">
                <p className="font-mono text-[13px] uppercase tracking-wide text-ink-faint">
                  Recent testimony
                </p>
                <ul className="mt-2 space-y-2.5">
                  {recentRatings.map((r) => (
                    <li key={r.id} className="pixel-chip bg-vellum p-2.5 text-[14px]">
                      <div className="flex items-center justify-between font-mono text-[13px] text-ink-faint">
                        <span>
                          {r.authorName} ·{" "}
                          <span style={{ color: HOUSE_BY_ID[r.houseId].colorVar }}>
                            {HOUSE_BY_ID[r.houseId].name}
                          </span>
                        </span>
                        <span>
                          <span className="tabular">{r.verdict}/5</span>
                          {state.authStatus === "ready" && (
                            <button type="button" onClick={() => setReporting({ kind: "rating", id: r.id, label: `a rating at ${throne.name}` })}
                              className="ml-2 font-mono text-[10px] uppercase text-ink-faint underline">
                              Report
                            </button>
                          )}
                        </span>
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
              className="pixel-btn mt-5 w-full py-3 text-center font-display text-[11px] tracking-wider"
            >
              Sit Here
            </button>
          </div>
        )}
      </div>
      {reporting && (
        <ReportModal subjectKind={reporting.kind} subjectId={reporting.id} subjectLabel={reporting.label} onClose={() => setReporting(null)} />
      )}
    </div>
  );
}

export function isWithinProximity(throne: Throne, lat: number, lng: number): boolean {
  return haversineMeters({ lat: throne.lat, lng: throne.lng }, { lat, lng }) <= 75;
}
