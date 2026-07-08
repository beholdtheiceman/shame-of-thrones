"use client";

import { useState } from "react";
import { THRONE_CATEGORY_LABEL } from "@/lib/data";
import { useStore } from "@/lib/store";
import type { Amenities, ThroneCategory } from "@/lib/types";

const CATEGORIES: ThroneCategory[] = [
  "cafe",
  "restaurant",
  "park",
  "transit",
  "library",
  "retail",
  "municipal",
  "gas_station",
  "other",
];

export function AddThroneToggle({
  addMode,
  onToggle,
}: {
  addMode: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="pixel-chip pointer-events-auto px-3.5 py-2 font-mono text-[14px] uppercase tracking-wide"
      style={{
        background: addMode ? "var(--crimson)" : "var(--vellum-raised)",
        color: addMode ? "var(--on-brass)" : "var(--ink-soft)",
      }}
    >
      {addMode ? "Tap the map to place a pin ✕" : "+ Chart a Throne"}
    </button>
  );
}

export function AddThroneForm({
  coords,
  onClose,
}: {
  coords: { lat: number; lng: number };
  onClose: () => void;
}) {
  const { addThrone } = useStore();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ThroneCategory>("cafe");
  const [amenities, setAmenities] = useState<Amenities>({
    accessible: false,
    babyChanging: false,
    genderNeutral: false,
    freeAccess: true,
    open24h: false,
  });

  function toggleAmenity(key: keyof Amenities) {
    setAmenities((a) => ({ ...a, [key]: !a[key] }));
  }

  function handleSubmit() {
    if (name.trim().length < 2) return;
    addThrone({ name: name.trim(), lat: coords.lat, lng: coords.lng, category, amenities });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[1001] flex items-end justify-center bg-black/60 sm:items-center sm:p-6">
      <div className="pixel-panel w-full max-w-md p-5">
        <p className="font-mono text-[15px] uppercase tracking-widest text-brass">
          ▸ Charting a New Throne
        </p>
        <h2 className="mt-2 font-display text-[13px] leading-relaxed text-ink">
          Name the throne
        </h2>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Corner Bodega Restroom"
          maxLength={60}
          className="pixel-panel-flat mt-3 w-full px-3 py-2.5 font-mono text-[16px] text-ink outline-none placeholder:text-ink-faint"
        />

        <p className="mt-4 font-mono text-[13px] uppercase tracking-wide text-ink-faint">
          Category
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className="pixel-chip px-2.5 py-1 font-mono text-[13px] transition"
              style={{
                background: category === c ? "var(--brass)" : "var(--vellum)",
                color: category === c ? "var(--on-brass)" : "var(--ink-soft)",
              }}
            >
              {THRONE_CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
        <p className="mt-1.5 font-mono text-[13px] text-ink-faint">
          Private residences may not be charted as Thrones.
        </p>

        <p className="mt-4 font-mono text-[13px] uppercase tracking-wide text-ink-faint">
          Amenities
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {(
            [
              ["accessible", "Accessible"],
              ["babyChanging", "Baby changing"],
              ["genderNeutral", "Gender-neutral"],
              ["freeAccess", "Free access"],
              ["open24h", "Open 24h"],
            ] as [keyof Amenities, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleAmenity(key)}
              className="pixel-chip px-2.5 py-1 font-mono text-[13px] transition"
              style={{
                background: amenities[key] ? "var(--brass)" : "var(--vellum)",
                color: amenities[key] ? "var(--on-brass)" : "var(--ink-soft)",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="mt-4 font-mono text-[13px] text-ink-faint">
          New thrones enter the Realm as <b className="text-ink-soft">Rumored</b> until confirmed.
        </p>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="pixel-chip flex-1 bg-vellum py-2.5 font-mono text-[13px] uppercase tracking-wide text-ink-soft"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={name.trim().length < 2}
            onClick={handleSubmit}
            className="pixel-btn flex-1 py-2.5 font-display text-[10px] tracking-wide"
          >
            Chart It
          </button>
        </div>
      </div>
    </div>
  );
}
