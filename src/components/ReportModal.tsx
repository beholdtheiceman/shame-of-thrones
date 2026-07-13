"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useCopy } from "@/lib/copy";

const REASONS = [
  { value: "wrong_info", label: "The details are wrong" },
  { value: "closed", label: "This throne is closed or gone" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "not_public_restroom", label: "Not a public restroom" },
  { value: "harassment", label: "Harassment" },
  { value: "spam", label: "Spam" },
] as const;

export function ReportModal({ subjectKind, subjectId, subjectLabel, onClose }: {
  subjectKind: "throne" | "rating" | "photo";
  subjectId: string;
  subjectLabel: string;
  onClose: () => void;
}) {
  const t = useCopy();
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!reason) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.report({ subjectKind, subjectId, reason, note: note.trim() || undefined });
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("connectionError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1003] flex items-end justify-center bg-black/60 sm:items-center sm:p-6">
      <div className="pixel-panel w-full max-w-md p-5">
        {sent ? (
          <>
            <p className="font-mono text-[15px] uppercase tracking-widest text-brass">▸ Raven Sent</p>
            <p className="mt-2 text-[15px] text-ink-soft">{t("reportDone")} {subjectLabel}.</p>
            <button type="button" onClick={onClose} className="pixel-btn mt-4 w-full py-2.5 font-display text-[10px]">Close</button>
          </>
        ) : (
          <>
            <p className="font-mono text-[15px] uppercase tracking-widest text-brass">{t("reportTitle")}</p>
            <p className="mt-1 font-mono text-[13px] text-ink-faint">{subjectLabel}</p>
            <div className="mt-3 flex flex-col gap-2">
              {REASONS.map((r) => (
                <button key={r.value} type="button" onClick={() => setReason(r.value)}
                  className="pixel-chip px-3 py-2 text-left font-mono text-[13px]"
                  style={{
                    background: reason === r.value ? "var(--brass)" : "var(--vellum)",
                    color: reason === r.value ? "var(--on-brass)" : "var(--ink-soft)",
                  }}>
                  {r.label}
                </button>
              ))}
            </div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} rows={2}
              placeholder={t("reportPlaceholder")}
              className="pixel-panel-flat mt-3 w-full resize-none px-3 py-2 font-mono text-[13px] text-ink outline-none placeholder:text-ink-faint" />
            {error && <p className="mt-2 font-mono text-[13px] text-crimson">{error}</p>}
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={onClose} className="pixel-chip flex-1 bg-vellum py-2.5 font-mono text-[13px] uppercase text-ink-soft">Cancel</button>
              <button type="button" disabled={!reason || submitting} onClick={handleSubmit}
                className="pixel-btn flex-1 py-2.5 font-display text-[10px]">Send Raven</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
