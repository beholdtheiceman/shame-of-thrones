"use client";

import { useEffect, useState } from "react";

/** Ticks periodically so time-based derived values (rating decay, Fief
 * Influence decay, "forgotten" status) stay fresh without user action. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(0);

  useEffect(() => {
    function tick() {
      setNow(Date.now());
    }
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
