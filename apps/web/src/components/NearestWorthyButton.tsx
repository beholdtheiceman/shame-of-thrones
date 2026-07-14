"use client";

import { useState } from "react";
import { REALM_CENTER } from "@/lib/data";
import { haversineMeters } from "@/lib/geo";
import { useCopy } from "@/lib/copy";
import { useStore } from "@/lib/store";

export function NearestWorthyButton({
  onFound,
}: {
  onFound: (throneId: string, coords: [number, number]) => void;
}) {
  const { state } = useStore();
  const t = useCopy();
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function locateAndPick(origin: { lat: number; lng: number }, usedFallback: boolean) {
    const thrones = state.realm?.thrones ?? [];
    const worthy = thrones.filter((t) => t.score !== null && t.score >= 3.5);
    const pool = worthy.length > 0 ? worthy : thrones;

    let best = pool[0];
    let bestDist = Infinity;
    for (const t of pool) {
      const d = haversineMeters(origin, { lat: t.lat, lng: t.lng });
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    if (!best) return;
    setNotice(
      usedFallback
        ? "Location unavailable — showing the Realm's most acclaimed throne instead."
        : null
    );
    onFound(best.id, [best.lat, best.lng]);
    setBusy(false);
  }

  function handleClick() {
    setBusy(true);
    setNotice(null);
    if (!("geolocation" in navigator)) {
      locateAndPick({ lat: REALM_CENTER[0], lng: REALM_CENTER[1] }, true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        locateAndPick(
          { lat: pos.coords.latitude, lng: pos.coords.longitude },
          false
        ),
      () => locateAndPick({ lat: REALM_CENTER[0], lng: REALM_CENTER[1] }, true),
      { timeout: 6000 }
    );
  }

  return (
    <div className="pointer-events-auto flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="pixel-btn px-5 py-3 font-display text-[10px] tracking-wide"
      >
        {busy ? (
          "Scouting…"
        ) : (
          t("nearestWorthy")
        )}
      </button>
      {notice && (
        <p className="pixel-chip max-w-[220px] bg-vellum-raised px-2.5 py-1 text-center font-mono text-[13px] text-ink-faint">
          {notice}
        </p>
      )}
    </div>
  );
}
