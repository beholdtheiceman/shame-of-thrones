"use client";

import { useState } from "react";
import { useCopy } from "@/lib/copy";
import { useStore } from "@/lib/store";

/** Neutral COPPA age screen: no mention of a cutoff. The server computes and
 * discards the date; the client never learns why a lock happened. */
export function AgeGate() {
  const { state, submitAgeGate } = useStore();
  const t = useCopy();
  const [birthDate, setBirthDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.ageGate?.locked) {
    return (
      <div className="stone-wall fixed inset-0 z-[1002] flex items-center justify-center px-4">
        <div className="pixel-panel w-full max-w-md p-5 text-center">
          <p className="font-mono text-[15px] uppercase tracking-widest text-brass">▸ The Gates Are Closed</p>
          <p className="mt-3 text-[15px] leading-snug text-ink-soft">
            The Realm cannot admit you at this time. Travel well, and return another day.
          </p>
        </div>
      </div>
    );
  }

  async function handleSubmit() {
    if (!birthDate) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitAgeGate(birthDate);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("connectionError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="stone-wall fixed inset-0 z-[1002] flex items-center justify-center px-4">
      <div className="pixel-panel w-full max-w-md p-5">
        <p className="font-mono text-[15px] uppercase tracking-widest text-brass">▸ The Maester&rsquo;s Ledger</p>
        <p className="mt-2 text-[15px] leading-snug text-ink-soft">
          Before you enter the Realm, the Maester must record your date of birth.
        </p>
        <input
          type="date"
          value={birthDate}
          onChange={(e) => setBirthDate(e.target.value)}
          className="pixel-panel-flat mt-4 w-full px-3 py-2.5 font-mono text-[16px] text-ink outline-none"
        />
        <button
          type="button"
          disabled={!birthDate || submitting}
          onClick={handleSubmit}
          className="pixel-btn mt-4 w-full py-3 text-center font-display text-[10px] tracking-wider"
        >
          ▸ Enter It Into the Record
        </button>
        {error && <p className="mt-3 text-center font-mono text-[13px] text-crimson">{error}</p>}
      </div>
    </div>
  );
}
