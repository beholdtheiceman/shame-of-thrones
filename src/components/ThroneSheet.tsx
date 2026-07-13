"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type ThroneDTO } from "@/lib/api";
import { HOUSE_BY_ID, THRONE_CATEGORY_LABEL } from "@/lib/data";
import { useCopy, usePlainSpeech } from "@/lib/copy";
import { displayTier } from "@/lib/selectors";
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
  const t = useCopy();
  const { plain } = usePlainSpeech();
  const [mode, setMode] = useState<"detail" | "sitting">("detail");
  const [showSignInGate, setShowSignInGate] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [reporting, setReporting] = useState<{ kind: "throne" | "rating" | "photo"; id: string; label: string } | null>(null);
  const [photos, setPhotos] = useState<Awaited<ReturnType<typeof api.listPhotos>>["photos"]>([]);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const now = useNow();

  const loadPhotos = useCallback(async () => {
    try {
      const result = await api.listPhotos(throne.id);
      setPhotos(result.photos);
    } catch {
      setPhotos([]);
    }
  }, [throne.id]);

  useEffect(() => { void loadPhotos(); }, [loadPhotos]);

  const score = throne.score;
  const count = throne.ratingCount;
  const tier = score !== null ? displayTier(score) : null;

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
      setConfirmError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : t("connectionError"));
    }
  }

  async function handlePhotoUpload(file: File) {
    setPhotoUploading(true);
    setPhotoMessage(null);
    try {
      const result = await api.uploadPhoto(throne.id, file);
      setPhotoMessage(result.status === "rejected"
        ? t("photoRefusedMsg")
        : t("photoPendingMsg"));
      await loadPhotos();
    } catch (e) {
      setPhotoMessage(e instanceof ApiError ? e.message : t("connectionError"));
    } finally {
      setPhotoUploading(false);
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
                  {t("rumored")}
                </span>
              ) : (
                <span className="pixel-chip bg-emerald/20 px-2.5 py-1 font-mono text-[13px] uppercase tracking-wide text-emerald">
                  {t("verifiedChip")}
                </span>
              )}
              {tier && (
                <span className="pixel-chip bg-brass/20 px-2.5 py-1 font-mono text-[13px] uppercase tracking-wide text-brass-strong">
                  <span aria-hidden="true">{tier.glyph}</span>{" "}
                  {plain ? tier.plainLabel : tier.label}
                </span>
              )}
              {forgotten && (
                <span className="pixel-chip bg-crimson/20 px-2.5 py-1 font-mono text-[13px] uppercase tracking-wide text-crimson">
                  {t("forgotten")}
                </span>
              )}
              {score !== null ? (
                <span className="font-mono text-[15px] tabular text-ink-soft">
                  {score.toFixed(1)} · {count} {count === 1 ? t("sittingSingular") : t("sittingPlural")}
                </span>
              ) : (
                <span className="font-mono text-[15px] text-ink-faint">{t("unrated")}</span>
              )}
            </div>

            {throne.status === "rumored" && (
              <button
                type="button"
                onClick={handleConfirm}
                className="pixel-btn mt-3 w-full py-2.5 font-mono text-[14px] uppercase tracking-wide"
              >
                {t("confirmThrone")}
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
                  {t("recentTestimony")}
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

            <div className="mt-5">
              <p className="font-mono text-[13px] uppercase tracking-wide text-ink-faint">
                {t("offerPortrait")}
              </p>
              {photos.some((p) => p.status === "approved") && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {photos.filter((p) => p.status === "approved").map((p) => (
                    <div key={p.id}>
                      <img src={"/api/photos/" + p.id} alt="Throne portrait" className="pixel-panel-flat h-24 w-24 object-cover" />
                      {state.authStatus === "ready" && (
                        <button type="button" onClick={() => setReporting({ kind: "photo", id: p.id, label: `a portrait of ${throne.name}` })}
                          className="mt-1 block font-mono text-[10px] uppercase text-ink-faint underline">
                          Report
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {photos.filter((p) => p.mine && p.status !== "approved").length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {photos.filter((p) => p.mine && p.status !== "approved").map((p) => (
                    <span key={p.id} className="pixel-chip bg-vellum px-2.5 py-1 font-mono text-[12px] text-ink-soft">
                      {p.status === "pending" ? t("photoPendingChip") : t("photoRefusedChip")}
                    </span>
                  ))}
                </div>
              )}
              {state.authStatus === "ready" && (
                <div className="mt-3">
                  <p className="font-mono text-[12px] text-ink-faint">
                    {t("photoRules")}
                  </p>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={photoUploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handlePhotoUpload(file);
                      e.target.value = "";
                    }}
                    className="pixel-panel-flat mt-2 w-full px-3 py-2 font-mono text-[12px] text-ink-soft file:mr-3 file:border-0 file:bg-transparent file:font-mono file:text-[12px] file:uppercase file:text-brass"
                  />
                </div>
              )}
              {photoMessage && (
                <p className="mt-2 font-mono text-[13px] text-ink-soft">{photoMessage}</p>
              )}
            </div>

            <button
              type="button"
              onClick={() => setMode("sitting")}
              className="pixel-btn mt-5 w-full py-3 text-center font-display text-[11px] tracking-wider"
            >
              {t("sitHere")}
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
