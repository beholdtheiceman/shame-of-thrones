"use client";

import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { VERDICT_SCALE } from "@/lib/data";
import { useCopy, usePlainSpeech } from "@/lib/copy";
import { haversineMeters } from "@/lib/geo";
import { RATING_TAGS } from "@/lib/game/rules";
import { useStore } from "@/lib/store";
import type { Throne } from "@/lib/types";
import { SignInGate } from "./SignInGate";

type ProximityState = "checking" | "verified" | "hearsay" | "denied";

export function SittingFlow({
  throne,
  onCancel,
  onSubmitted,
}: {
  throne: Throne;
  onCancel: () => void;
  onSubmitted: () => void;
}) {
  const { state, submitRating } = useStore();
  const t = useCopy();
  const { plain } = usePlainSpeech();
  const [verdict, setVerdict] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [testimony, setTestimony] = useState("");
  const [blockedNote, setBlockedNote] = useState(false);
  const [proximity, setProximity] = useState<ProximityState>("checking");
  const [submitting, setSubmitting] = useState(false);
  const [influenceClaimed, setInfluenceClaimed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state.authStatus === "anonymous") return;
    function markDenied() {
      setProximity("denied");
    }
    if (!("geolocation" in navigator)) {
      markDenied();
      return;
    }
    const id = navigator.geolocation.getCurrentPosition(
      (pos) => {
        const meters = haversineMeters(
          { lat: throne.lat, lng: throne.lng },
          { lat: pos.coords.latitude, lng: pos.coords.longitude }
        );
        setProximity(meters <= 75 ? "verified" : "hearsay");
      },
      () => setProximity("denied"),
      { timeout: 6000 }
    );
    return () => {
      if (typeof id === "number") navigator.geolocation.clearWatch?.(id);
    };
  }, [state.authStatus, throne.lat, throne.lng]);

  function toggleTag(tag: string) {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  async function handleSubmit() {
    if (verdict === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitRating({
        throneId: throne.id,
        verdict,
        tags,
        testimony,
        verified: proximity === "verified",
      });
      if (result.testimonyBlocked) setBlockedNote(true);
      setInfluenceClaimed(true);
      window.setTimeout(onSubmitted, 700);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : t("connectionError"));
      setSubmitting(false);
    }
  }

  if (state.authStatus === "anonymous") return <SignInGate />;

  return (
    <div className="p-5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[15px] uppercase tracking-widest text-brass">
          ▸ The Sitting
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="pixel-chip bg-vellum px-2 py-1 font-mono text-[13px] text-ink-faint hover:text-ink"
        >
          Cancel
        </button>
      </div>
      <h2 className="mt-2 font-display text-[15px] leading-relaxed text-ink text-balance">
        {throne.name}
      </h2>
      <p className="mt-2 font-mono text-[14px] leading-snug text-ink-faint">
        {proximity === "checking" && "Confirming your location…"}
        {proximity === "verified" && (
          <span className="text-emerald">✓ Verified — you&rsquo;re within 75m</span>
        )}
        {proximity === "hearsay" && (
          <span className="text-brass">
            Hearsay — you&rsquo;re too far for a Verified sitting (counts for less Influence)
          </span>
        )}
        {proximity === "denied" && (
          <span className="text-brass">
            Location unavailable — this will be logged as Hearsay
          </span>
        )}
      </p>

      <div className="mt-4 flex justify-between gap-1">
        {VERDICT_SCALE.map((v) => (
          <button
            key={v.value}
            type="button"
            onClick={() => setVerdict(v.value)}
            className="flex w-1/5 flex-col items-center gap-1.5"
          >
            <span
              className="pixel-chip flex h-10 w-10 items-center justify-center text-lg transition"
              style={{
                background: verdict === v.value ? "var(--brass)" : "var(--vellum)",
              }}
            >
              <span aria-hidden="true">{v.glyph}</span>
            </span>
            <span
              className={`text-center font-mono text-[10.5px] leading-tight ${
                verdict === v.value ? "text-brass" : "text-ink-faint"
              }`}
            >
              {plain ? v.plainLabel : v.label}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {RATING_TAGS.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => toggleTag(tag)}
            className="pixel-chip px-2.5 py-1 font-mono text-[13px] transition"
            style={{
              background: tags.includes(tag) ? "var(--brass)" : "var(--vellum)",
              color: tags.includes(tag) ? "var(--on-brass)" : "var(--ink-soft)",
            }}
          >
            {tag}
          </button>
        ))}
      </div>

      <label className="mt-4 block font-mono text-[13px] uppercase tracking-wide text-ink-faint">
        Scroll of Testimony (optional)
      </label>
      <textarea
        value={testimony}
        onChange={(e) => setTestimony(e.target.value)}
        maxLength={280}
        rows={3}
        placeholder="Speak, traveler. What horrors or wonders did you find?"
        className="pixel-panel-flat mt-1.5 w-full resize-none px-3 py-2.5 font-mono text-[14px] text-ink outline-none placeholder:text-ink-faint"
      />
      <p className="mt-1 text-right font-mono text-[11px] text-ink-faint">{testimony.length}/280</p>

      {error && <p className="mt-4 font-mono text-[14px] text-crimson">{error}</p>}
      {influenceClaimed && (
        <p className="pixel-chip mt-4 animate-bounce bg-brass px-3 py-2 text-center font-mono text-[14px] text-on-brass">
          Influence claimed!
        </p>
      )}
      {blockedNote && (
        <p className="mt-2 font-mono text-[13px] text-crimson">
          The Maester declines to record those words. Your verdict stands.
        </p>
      )}

      <button
        type="button"
        disabled={verdict === null || submitting}
        onClick={handleSubmit}
        className="pixel-btn mt-4 w-full py-3 text-center font-display text-[11px] tracking-wider"
      >
        Strike Your Banner
      </button>
    </div>
  );
}
