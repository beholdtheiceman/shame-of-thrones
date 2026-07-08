"use client";

import { useStore } from "@/lib/store";

function renderDispatch(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <b key={i} className="text-ink">
        {part.slice(2, -2)}
      </b>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function Ledger() {
  const { state } = useStore();

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      <p className="font-mono text-[15px] uppercase tracking-widest text-brass">
        ▸ Realm-wide Event Feed
      </p>
      <h1 className="mt-2 font-display text-[17px] leading-relaxed text-ink">
        Today&rsquo;s Dispatches
      </h1>

      <div className="pixel-panel mt-4 divide-y-2 divide-vellum-line">
        {state.ledger.map((entry) => (
          <div key={entry.id} className="flex gap-3 px-4 py-3 text-[15px] text-ink-soft">
            <span className="w-16 shrink-0 font-mono text-[14px] text-ink-faint tabular">
              {timeAgo(entry.createdAt)}
            </span>
            <span>{renderDispatch(entry.text)}</span>
          </div>
        ))}
        {state.ledger.length === 0 && (
          <p className="px-4 py-6 text-center font-mono text-[14px] text-ink-faint">
            No dispatches yet. Strike a banner to make history.
          </p>
        )}
      </div>
    </div>
  );
}
