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
      <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-vellum-line sm:hidden" />
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10.5px] uppercase tracking-widest text-brass-strong">
          The Sitting
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-ink-faint hover:text-ink"
        >
          Cancel
        </button>
      </div>
      <h2 className="mt-1 font-display text-lg font-bold text-ink text-balance">
        {throne.name}
      </h2>
      <p className="mt-1 text-[11px] text-ink-faint">
        {proximity === "checking" && "Confirming your location…"}
        {proximity === "verified" && (
          <span className="text-emerald">✓ Verified — you&rsquo;re within 75m</span>
        )}
        {proximity === "hearsay" && (
          <span className="text-brass-strong">
            Hearsay — you&rsquo;re too far for a Verified sitting (counts for less Influence)
          </span>
        )}
        {proximity === "denied" && (
          <span className="text-brass-strong">
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
            className="flex w-1/5 flex-col items-center gap-1"
          >
            <span
              className={`flex h-10 w-10 items-center justify-center rounded-full border-2 text-lg transition ${
                verdict === v.value
                  ? "border-brass bg-brass/15"
                  : "border-transparent bg-vellum"
              }`}
            >
              {v.glyph}
            </span>
            <span
              className={`text-center text-[9px] leading-tight ${
                verdict === v.value ? "font-bold text-brass-strong" : "text-ink-faint"
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
            className={`rounded-full px-2.5 py-1 text-[11px] transition ${
              tags.includes(tag)
                ? "bg-brass font-semibold text-on-brass"
                : "border border-vellum-line text-ink-soft hover:border-brass/50"
            }`}
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
          className="w-full resize-none rounded-lg border border-dashed border-vellum-line bg-vellum px-3 py-2 text-[12.5px] italic text-ink-soft outline-none focus:border-brass"
        />
        <p className="mt-1 text-right font-mono text-[10px] text-ink-faint tabular">
          {testimony.length} / 280
        </p>
      </div>

      <button
        type="button"
        disabled={verdict === null}
        onClick={handleSubmit}
        className="mt-2 w-full rounded-lg bg-brass py-3 text-center text-xs font-bold uppercase tracking-widest text-on-brass disabled:cursor-not-allowed disabled:opacity-40"
      >
        Strike Your Banner
      </button>
    </div>
  );
}
