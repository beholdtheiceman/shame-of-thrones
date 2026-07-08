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
      <p className="font-mono text-[10.5px] uppercase tracking-widest text-brass-strong">
        Realm-wide Event Feed
      </p>
      <h1 className="mt-1 font-display text-2xl font-bold text-ink">Today&rsquo;s Dispatches</h1>

      <div className="mt-4 divide-y divide-vellum-line rounded-xl border border-vellum-line bg-vellum-raised">
        {state.ledger.map((entry) => (
          <div key={entry.id} className="flex gap-3 px-4 py-3 text-[13px] text-ink-soft">
            <span className="w-14 shrink-0 font-mono text-[10.5px] text-ink-faint tabular">
              {timeAgo(entry.createdAt)}
            </span>
            <span>{renderDispatch(entry.text)}</span>
          </div>
        ))}
        {state.ledger.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-ink-faint">
            No dispatches yet. Strike a banner to make history.
          </p>
        )}
      </div>
    </div>
  );
}
