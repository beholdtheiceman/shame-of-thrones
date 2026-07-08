"use client";

import { useState } from "react";
import { REALM_CENTER } from "@/lib/data";
import { haversineMeters } from "@/lib/geo";
import { throneScore } from "@/lib/selectors";
import { useStore } from "@/lib/store";

export function NearestWorthyButton({
  onFound,
}: {
  onFound: (throneId: string, coords: [number, number]) => void;
}) {
  const { state } = useStore();
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function locateAndPick(origin: { lat: number; lng: number }, usedFallback: boolean) {
    const now = Date.now();
    const worthy = state.thrones.filter((t) => {
      const { score } = throneScore(t.id, state.ratings, now);
      return score !== null && score >= 3.5;
    });
    const pool = worthy.length > 0 ? worthy : state.thrones;

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
    <div className="pointer-events-auto flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="rounded-full bg-brass px-5 py-2.5 text-[11px] font-bold uppercase tracking-widest text-on-brass shadow-lg shadow-brass/30 disabled:opacity-60"
      >
        {busy ? "Scouting the Realm…" : "⚔ Nearest Worthy Throne"}
      </button>
      {notice && (
        <p className="max-w-[220px] rounded-md bg-vellum-raised/95 px-2.5 py-1 text-center text-[10px] text-ink-faint shadow">
          {notice}
        </p>
      )}
    </div>
  );
}
