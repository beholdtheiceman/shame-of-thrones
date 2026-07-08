"use client";

import { useState } from "react";
import { HOUSES } from "@/lib/data";
import { useStore } from "@/lib/store";
import type { HouseId } from "@/lib/types";

export function Onboarding() {
  const { setProfile } = useStore();
  const [name, setName] = useState("");
  const [houseId, setHouseId] = useState<HouseId | null>(null);

  const canSubmit = name.trim().length >= 2 && houseId !== null;

  return (
    <div className="fixed inset-0 z-[1002] flex items-end justify-center bg-ink/60 sm:items-center sm:p-6">
      <div className="w-full max-w-md rounded-t-2xl border border-vellum-line bg-vellum-raised p-6 shadow-2xl sm:rounded-2xl">
        <p className="font-mono text-[11px] uppercase tracking-widest text-brass-strong">
          Field Dossier · Onboarding
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-wide text-ink text-balance">
          Swear the Oath
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          Choose the name the Realm will know you by, then pledge to a House.
          You may switch Houses once per Season.
        </p>

        <label className="mt-5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Your name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ser.yourname"
          maxLength={24}
          className="mt-1.5 w-full rounded-lg border border-vellum-line bg-vellum px-3 py-2.5 text-sm text-ink outline-none focus:border-brass focus:ring-2 focus:ring-brass/30"
        />

        <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Choose your House
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {HOUSES.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => setHouseId(h.id)}
              className={`rounded-lg border p-3 text-left transition ${
                houseId === h.id
                  ? "border-brass bg-brass/15"
                  : "border-vellum-line bg-vellum hover:border-brass/50"
              }`}
            >
              <span
                className="mb-2 block h-3 w-6"
                style={{
                  background: h.colorVar,
                  clipPath:
                    "polygon(0 0,100% 0,100% 70%,50% 100%,0 70%)",
                }}
              />
              <span className="block font-display text-xs font-bold uppercase tracking-wide text-ink">
                {h.name}
              </span>
              <span className="mt-0.5 block text-[10.5px] italic text-ink-faint">
                &ldquo;{h.words}&rdquo;
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => houseId && setProfile(name.trim(), houseId)}
          className="mt-6 w-full rounded-lg bg-brass py-3 text-center text-xs font-bold uppercase tracking-widest text-on-brass transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          Enter the Realm
        </button>
      </div>
    </div>
  );
}
