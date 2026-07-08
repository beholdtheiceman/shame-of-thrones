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
    <div className="stone-wall fixed inset-0 z-[1002] flex flex-col items-center overflow-y-auto px-4 py-8">
      <div className="flex items-center gap-4">
        <span className="torch" />
        <h1 className="font-display leading-[1.9] text-brass [text-shadow:3px_3px_0_var(--vellum-line)]">
          <span className="block text-[26px] tracking-wide">SHAME</span>
          <span className="block text-center text-[13px] text-ink-soft">of</span>
          <span className="block text-[26px] tracking-wide">THRONES</span>
        </h1>
        <span className="torch" />
      </div>
      <p className="mt-4 text-center font-mono text-[17px] text-ink-soft">
        A toilet fantasy RPG
      </p>

      <div className="pixel-panel mt-7 w-full max-w-md p-5">
        <p className="font-mono text-[15px] uppercase tracking-widest text-brass">
          ▸ Character Creation
        </p>
        <p className="mt-2 text-[15px] leading-snug text-ink-soft">
          Choose the name the Realm will know you by, then pledge to a House.
          You may switch Houses once per Season.
        </p>

        <label className="mt-5 block font-mono text-[13px] uppercase tracking-wide text-ink-faint">
          Your name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ser.yourname"
          maxLength={24}
          className="pixel-panel-flat mt-1.5 w-full px-3 py-2.5 font-mono text-[16px] text-ink outline-none placeholder:text-ink-faint"
        />

        <p className="mt-5 font-mono text-[13px] uppercase tracking-wide text-ink-faint">
          Choose your House
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2.5">
          {HOUSES.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => setHouseId(h.id)}
              className="pixel-chip p-3 text-left transition"
              style={{
                background: "var(--vellum)",
                outline: houseId === h.id ? "3px solid var(--brass)" : "none",
                outlineOffset: houseId === h.id ? "-3px" : undefined,
              }}
            >
              <span
                className="mb-2 block h-3 w-6"
                style={{
                  background: h.colorVar,
                  clipPath: "polygon(0 0,100% 0,100% 70%,50% 100%,0 70%)",
                }}
              />
              <span className="block font-display text-[9px] leading-relaxed text-ink">
                {h.name}
              </span>
              <span className="mt-1 block text-[13px] italic leading-tight text-ink-faint">
                &ldquo;{h.words}&rdquo;
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => houseId && setProfile(name.trim(), houseId)}
          className="pixel-btn mt-6 w-full py-3.5 text-center font-display text-[11px] tracking-wider"
        >
          ▸ Press Start
        </button>
      </div>
    </div>
  );
}
