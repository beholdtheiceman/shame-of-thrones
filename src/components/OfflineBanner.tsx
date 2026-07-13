"use client";

import { useCopy } from "@/lib/copy";
import { useStore } from "@/lib/store";

function age(ms: number): string {
  const min = Math.max(1, Math.round((Date.now() - ms) / 60_000));
  return min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
}

export function OfflineBanner() {
  const { state, clearQueueNotice } = useStore();
  const t = useCopy();
  if (!state.offline && state.queuedCount === 0 && !state.queueDropped) return null;
  return (
    <div role="status" className="pointer-events-none absolute inset-x-0 top-2 z-[950] flex justify-center px-4">
      <div className="pixel-chip pointer-events-auto bg-vellum-raised px-3 py-1.5 text-center font-mono text-[13px] text-ink-soft">
        {state.offline && (
          <span>
            {t("offlineBanner")}
            {state.snapshotSavedAt ? ` (${age(state.snapshotSavedAt)})` : ""}
          </span>
        )}
        {state.queuedCount > 0 && <span>{state.offline ? " · " : ""}{state.queuedCount} ✉</span>}
        {state.queueDropped && (
          <>
            <span className="text-crimson-strong"> · {t("queueDropped")}</span>
            <button
              type="button"
              onClick={clearQueueNotice}
              aria-label="Dismiss notice"
              className="ml-2 font-mono text-[12px] uppercase text-ink-faint underline"
            >
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  );
}
