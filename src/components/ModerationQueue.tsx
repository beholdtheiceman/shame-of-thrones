"use client";

import { useCallback, useEffect, useState } from "react";

interface ReviewItem {
  id: string;
  kind: string;
  severity: "low" | "medium" | "high";
  status: "pending" | "resolved";
  signals: { signal: string; [k: string]: unknown }[];
  actor: string;
  subject: string;
  aiAssessment: string | null;
  aiSeverity: "low" | "medium" | "high" | null;
  aiError: string | null;
  createdAt: number;
  resolutionNote: string | null;
}

const SEVERITY_BG: Record<string, string> = {
  low: "var(--vellum)", medium: "var(--brass)", high: "var(--crimson)",
};

export function ModerationQueue() {
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/review");
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      setItems((await res.json()).items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "the ravens were lost");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function act(id: string, path: string, body?: unknown) {
    setBusy(id);
    try {
      await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p className="mt-4 font-mono text-[13px] text-crimson">{error}</p>;
  if (items === null) return <p className="mt-4 font-mono text-[13px] text-ink-faint">Consulting the ledgers…</p>;
  if (items.length === 0) return <p className="mt-4 font-mono text-[13px] text-ink-faint">The queue is empty. The Realm is at peace.</p>;

  return (
    <div className="mt-4 flex flex-col gap-3">
      {items.map((item) => (
        <div key={item.id} className="pixel-panel p-4" style={{ opacity: item.status === "resolved" ? 0.6 : 1 }}>
          <div className="flex items-center gap-2">
            <span
              className="pixel-chip px-2 py-0.5 font-mono text-[12px] uppercase"
              style={{ background: SEVERITY_BG[item.severity], color: item.severity === "low" ? "var(--ink-soft)" : "var(--on-brass)" }}
            >
              {item.severity}
            </span>
            <span className="font-mono text-[12px] uppercase tracking-wide text-ink-faint">{item.kind}</span>
            <span className="ml-auto font-mono text-[12px] text-ink-faint">
              {new Date(item.createdAt).toLocaleString()}
            </span>
          </div>

          <p className="mt-2 font-mono text-[14px] text-ink">{item.subject}</p>
          <p className="mt-1 font-mono text-[13px] text-ink-soft">
            by <b>{item.actor}</b> · signals: {item.signals.map((s) => s.signal).join(", ")}
          </p>

          {item.aiAssessment ? (
            <div className="pixel-panel-flat mt-3 p-3">
              <p className="font-mono text-[12px] uppercase tracking-wide text-brass">
                Maester&rsquo;s note{item.aiSeverity ? ` · suggests ${item.aiSeverity}` : ""}
              </p>
              <p className="mt-1 text-[14px] leading-snug text-ink-soft">{item.aiAssessment}</p>
            </div>
          ) : (
            <p className="mt-3 font-mono text-[13px] text-ink-faint">
              {item.aiError ? `Triage failed: ${item.aiError}` : "Triage pending…"}
            </p>
          )}

          {item.status === "pending" ? (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busy === item.id}
                onClick={() => {
                  const note = window.prompt("Resolution note (optional):") ?? undefined;
                  void act(item.id, `/api/review/${item.id}`, { action: "resolve", note });
                }}
                className="pixel-btn flex-1 py-2 font-display text-[9px] tracking-wide"
              >
                Resolve
              </button>
              {!item.aiAssessment && (
                <button
                  type="button"
                  disabled={busy === item.id}
                  onClick={() => void act(item.id, `/api/review/${item.id}/triage`)}
                  className="pixel-chip flex-1 bg-vellum py-2 font-mono text-[13px] uppercase tracking-wide text-ink-soft"
                >
                  Ask the Maester again
                </button>
              )}
            </div>
          ) : (
            item.resolutionNote && (
              <p className="mt-2 font-mono text-[13px] italic text-ink-faint">Resolved: {item.resolutionNote}</p>
            )
          )}
        </div>
      ))}
    </div>
  );
}
