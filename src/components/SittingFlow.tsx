"use client";

import { useEffect, useState } from "react";
import { QUICK_TAGS, VERDICT_SCALE } from "@/lib/data";
import { haversineMeters } from "@/lib/geo";
import { useStore } from "@/lib/store";
import type { Throne } from "@/lib/types";

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
  const { submitRating } = useStore();
  const [verdict, setVerdict] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [testimony, setTestimony] = useState("");
  const [proximity, setProximity] = useState<ProximityState>("checking");

  useEffect(() => {
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
  }, [throne.lat, throne.lng]);

  function toggleTag(tag: string) {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  function handleSubmit() {
    if (verdict === null) return;
    submitRating({
      throneId: throne.id,
      verdict,
      tags,
      testimony: testimony.trim(),
      verified: proximity === "verified",
    });
    onSubmitted();
  }

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
              {v.glyph}
            </span>
            <span
              className={`text-center font-mono text-[10.5px] leading-tight ${
                verdict === v.value ? "text-brass" : "text-ink-faint"
              }`}
            >
              {v.label}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {QUICK_TAGS.map((tag) => (
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

      <div className="mt-4">
        <textarea
          value={testimony}
          onChange={(e) => setTestimony(e.target.value.slice(0, 280))}
          placeholder="Speak, traveler. What horrors or wonders did you find?"
          rows={3}
          className="pixel-panel-flat w-full resize-none px-3 py-2 font-mono text-[15px] italic text-ink-soft outline-none placeholder:text-ink-faint"
        />
        <p className="mt-1 text-right font-mono text-[13px] text-ink-faint tabular">
          {testimony.length} / 280
        </p>
      </div>

      <button
        type="button"
        disabled={verdict === null}
        onClick={handleSubmit}
        className="pixel-btn mt-2 w-full py-3 text-center font-display text-[11px] tracking-wider"
      >
        Strike Your Banner
      </button>
    </div>
  );
}
