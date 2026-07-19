"use client";

import { useMemo, useState } from "react";
import { COSMETICS, HOUSE_BY_ID, equippedFor } from "@sot/core";
import { useStore } from "@/lib/store";

const CHEVRON = "polygon(0 0,100% 0,100% 70%,50% 100%,0 70%)";

export function Treasury() {
  const { state, equipCosmetic } = useStore();
  const { profile, cosmetics } = state;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const owned = useMemo(() => new Set(cosmetics?.owned ?? []), [cosmetics]);
  const equippedSku = cosmetics ? equippedFor(cosmetics.equipped, "banner_style")?.sku : undefined;
  const colorVar = profile ? HOUSE_BY_ID[profile.houseId].colorVar : "var(--house-flush)";

  async function onEquip(sku: string | null) {
    setBusy(sku ?? "clear");
    setError(null);
    try {
      await equipCosmetic("banner_style", sku);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  if (!profile) {
    return (
      <p className="mx-auto max-w-2xl px-4 py-6 font-mono text-[14px] text-ink-faint">
        Swear an oath to enter the Treasury.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      <p className="font-mono text-[15px] uppercase tracking-widest text-brass">▸ The Treasury</p>
      <h1 className="mt-2 font-display text-[17px] leading-relaxed text-ink">Banners of the Realm</h1>
      <p className="mt-2 font-mono text-[13px] text-ink-faint">
        Cosmetic banners only — they change how your crest looks, never your standing.
      </p>
      {error && <p className="mt-3 font-mono text-[13px] text-crimson">{error}</p>}

      <div className="mt-4 space-y-3">
        {COSMETICS.map((c) => {
          const isOwned = owned.has(c.sku);
          const isEquipped = equippedSku === c.sku;
          return (
            <div key={c.sku} className="pixel-panel flex items-center gap-3 p-4">
              <span className="relative inline-block h-8 w-14 shrink-0">
                <span className="absolute inset-0" style={{ background: colorVar, clipPath: CHEVRON }} />
                <span className={`absolute inset-0 banner-art-${c.art}`} style={{ clipPath: CHEVRON }} aria-hidden />
              </span>
              <div className="flex-1">
                <p className="font-mono text-[14px] text-ink">{c.name}</p>
                <p className="font-mono text-[13px] text-ink-faint">{c.description}</p>
              </div>
              {isOwned ? (
                <button
                  type="button"
                  disabled={busy !== null || isEquipped}
                  onClick={() => void onEquip(isEquipped ? null : c.sku)}
                  className="pixel-chip bg-brass px-3 py-1.5 font-mono text-[13px] text-on-brass transition disabled:opacity-40"
                >
                  {isEquipped ? "Equipped" : "Equip"}
                </button>
              ) : (
                <span className="pixel-chip bg-vellum px-3 py-1.5 font-mono text-[13px] text-ink-soft">
                  ${c.priceUsd.toFixed(2)} · in app
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-4 font-mono text-[13px] text-ink-faint">
        Banners are purchased in the mobile app. Owned banners can be equipped here.
      </p>
    </div>
  );
}
