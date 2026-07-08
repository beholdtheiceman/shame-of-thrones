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
      className={`pointer-events-auto rounded-full border px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wide shadow-lg backdrop-blur transition ${
        addMode
          ? "border-crimson bg-crimson text-on-brass"
          : "border-vellum-line bg-vellum-raised/95 text-ink-soft"
      }`}
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
    <div className="fixed inset-0 z-[1001] flex items-end justify-center bg-ink/50 sm:items-center sm:p-6">
      <div className="w-full max-w-md rounded-t-2xl border border-vellum-line bg-vellum-raised p-5 shadow-2xl sm:rounded-2xl">
        <p className="font-mono text-[10.5px] uppercase tracking-widest text-brass-strong">
          Charting a New Throne
        </p>
        <h2 className="mt-1 font-display text-lg font-bold text-ink">Name the throne</h2>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Corner Bodega Restroom"
          maxLength={60}
          className="mt-3 w-full rounded-lg border border-vellum-line bg-vellum px-3 py-2.5 text-sm text-ink outline-none focus:border-brass"
        />

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Category
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`rounded-full px-2.5 py-1 text-[11px] transition ${
                category === c
                  ? "bg-brass font-semibold text-on-brass"
                  : "border border-vellum-line text-ink-soft"
              }`}
            >
              {THRONE_CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10.5px] text-ink-faint">
          Private residences may not be charted as Thrones.
        </p>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-faint">
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
              className={`rounded-full px-2.5 py-1 text-[11px] transition ${
                amenities[key]
                  ? "bg-brass font-semibold text-on-brass"
                  : "border border-vellum-line text-ink-soft"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="mt-4 text-[10.5px] text-ink-faint">
          New thrones enter the Realm as <b>Rumored</b> until confirmed.
        </p>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-vellum-line py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-soft"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={name.trim().length < 2}
            onClick={handleSubmit}
            className="flex-1 rounded-lg bg-brass py-2.5 text-xs font-bold uppercase tracking-wide text-on-brass disabled:cursor-not-allowed disabled:opacity-40"
          >
            Chart It
          </button>
        </div>
      </div>
    </div>
  );
}
