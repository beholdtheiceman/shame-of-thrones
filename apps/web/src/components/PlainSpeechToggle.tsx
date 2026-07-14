"use client";

import { usePlainSpeech } from "@/lib/copy";

export function PlainSpeechToggle() {
  const { plain, toggle } = usePlainSpeech();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={plain}
      aria-label="Plain speech mode"
      title={plain ? "Plain speech: on" : "Plain speech: off"}
      className="pixel-chip flex h-8 w-8 items-center justify-center bg-vellum font-mono text-[13px] text-ink-soft"
    >
      Aa
    </button>
  );
}
