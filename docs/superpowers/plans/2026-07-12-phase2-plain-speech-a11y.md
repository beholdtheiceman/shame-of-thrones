# Phase 2 Cycle 2: Plain Speech + Accessibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plain Speech toggle (functional copy rendered literally), code-level WCAG AA pass, and three Cycle-1 carry-forward fixes — per `docs/superpowers/specs/2026-07-12-phase2-plain-speech-a11y-design.md`.

**Architecture:** A client-only copy module (`src/lib/copy.tsx`) holds the themed/plain dictionary + React context + hooks; components route their strings through it. A11y is applied as conventions (aria-hidden emoji, dialog semantics, `useEscape` hook, focus-on-open). Contrast/axe auditing is Claude's own task with fixes applied directly to `globals.css` variables. **No schema, migration, or API changes.**

**Tech Stack:** Next.js 16 client components, React context, localStorage, axe-core (dev-only).

**Division of labor (lean mode):** Codex implements Tasks 1–3 (code + `npx.cmd tsc --noEmit` only — sandbox has no network/git); Claude runs tests, commits, does Task 4 (audit) itself, and runs ONE combined review pass at the end instead of per-task double reviews. **Push/deploy requires Larry's explicit OK.**

**File map:**

| File | Role |
|---|---|
| `src/lib/copy.tsx` (create) | COPY dictionary, PlainSpeechProvider, useCopy/usePlainSpeech, pure `copyFor` |
| `src/lib/copy.test.ts` (create) | units for `copyFor` fallback + plainLabel completeness |
| `src/lib/useEscape.ts` (create) | shared Esc-to-close hook |
| `src/lib/data.ts` (modify) | `plainLabel` on VERDICT_SCALE |
| `src/lib/selectors.ts` + `.test.ts` (modify) | `displayTier` (rounding unification) |
| `src/components/PlainSpeechToggle.tsx` (create) | header chip button |
| `src/app/layout.tsx` (modify) | mount PlainSpeechProvider |
| `src/app/page.tsx` (modify) | toggle in header; clear fief on tab change |
| `ThroneSheet/SittingFlow/AddThroneFlow/ReportModal/FiefCard/NearestWorthyButton/Onboarding/AgeGate/ThemeToggle` (modify) | copy sweep + a11y semantics |
| `src/app/globals.css` (modify) | contrast fixes (Task 4) |

---

### Task 1: Copy module, toggle, plainLabel, displayTier (+ units)

**Files:** Create `src/lib/copy.tsx`, `src/lib/copy.test.ts`, `src/components/PlainSpeechToggle.tsx`; Modify `src/lib/data.ts`, `src/lib/selectors.ts`, `src/lib/selectors.test.ts`, `src/app/layout.tsx`, `src/app/page.tsx` (header only).

- [ ] **Step 1: failing tests** — create `src/lib/copy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COPY, copyFor } from "./copy";
import { VERDICT_SCALE } from "./data";

describe("copyFor", () => {
  it("resolves themed and plain variants", () => {
    expect(copyFor("rumored", false)).toBe("Rumored");
    expect(copyFor("rumored", true)).toBe("Unverified");
  });
  it("every entry has non-empty themed and plain strings", () => {
    for (const [k, v] of Object.entries(COPY)) {
      expect(v.themed.length, k).toBeGreaterThan(0);
      expect(v.plain.length, k).toBeGreaterThan(0);
    }
  });
});

describe("VERDICT_SCALE plain labels", () => {
  it("all five tiers have a plainLabel", () => {
    expect(VERDICT_SCALE.map((t) => t.plainLabel)).toEqual([
      "Avoid", "Poor", "Okay", "Good", "Excellent",
    ]);
  });
});
```

and append to `src/lib/selectors.test.ts` (import `displayTier`):

```ts
describe("displayTier", () => {
  it("derives the tier from the displayed (toFixed 1) value", () => {
    expect(displayTier(4.45).value).toBe(5); // shows "4.5" → Iron Throne
    expect(displayTier(4.44).value).toBe(4); // shows "4.4" → Fit for a Knight
    expect(displayTier(2.449).value).toBe(2);
  });
});
```

- [ ] **Step 2: run to fail** — `npx.cmd vitest run src/lib/copy.test.ts src/lib/selectors.test.ts` → FAIL (missing exports).

- [ ] **Step 3: implement.**

`src/lib/data.ts` — VERDICT_SCALE entries gain `plainLabel`:

```ts
export const VERDICT_SCALE = [
  { value: 1 as const, glyph: "⚔️", label: "The Dungeon", plainLabel: "Avoid" },
  { value: 2 as const, glyph: "💀", label: "Peasant's Privy", plainLabel: "Poor" },
  { value: 3 as const, glyph: "🛡️", label: "Soldier's Rest", plainLabel: "Okay" },
  { value: 4 as const, glyph: "🏰", label: "Fit for a Knight", plainLabel: "Good" },
  { value: 5 as const, glyph: "👑", label: "The Iron Throne", plainLabel: "Excellent" },
];
```

`src/lib/selectors.ts` — extend `VerdictTier` with `plainLabel: string;` and append:

```ts
/** Tier derived from the value the UI displays (score.toFixed(1)), so the
 * chip and the number can never disagree at the .45–.49 band. */
export function displayTier(score: number): VerdictTier {
  return tierForScore(Number(score.toFixed(1)));
}
```

`src/lib/copy.tsx` (complete file):

```tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

/** Functional UI copy only — game identity (Houses, ranks, Ledger) stays
 * themed in both modes (spec §1). Themed strings must match the previous
 * hardcoded strings byte-for-byte. */
export const COPY = {
  sitHere: { themed: "Sit Here", plain: "Rate this restroom" },
  chartThrone: { themed: "+ Chart a Throne", plain: "+ Add a restroom" },
  nearestWorthy: { themed: "⚔️ Nearest Worthy Throne", plain: "Find the nearest good restroom" },
  confirmThrone: { themed: "Confirm this throne is real (+3 Influence)", plain: "Confirm this restroom exists (+3 points)" },
  rumored: { themed: "Rumored", plain: "Unverified" },
  verifiedChip: { themed: "✓ Verified", plain: "✓ Verified" },
  forgotten: { themed: "Forgotten by the Realm", plain: "Not confirmed in 120+ days" },
  unrated: { themed: "Unrated", plain: "No ratings yet" },
  sittingSingular: { themed: "sitting", plain: "rating" },
  sittingPlural: { themed: "sittings", plain: "ratings" },
  recentTestimony: { themed: "Recent testimony", plain: "Recent reviews" },
  offerPortrait: { themed: "Offer a Portrait", plain: "Photos" },
  photoRules: { themed: "Entrances, signage, and sinks only. No people — any face means rejection.", plain: "Entrances, signage, and sinks only. No people — photos with faces are rejected." },
  photoPendingChip: { themed: "awaits the Maesters' review", plain: "pending review" },
  photoRefusedChip: { themed: "refused", plain: "rejected" },
  photoPendingMsg: { themed: "This portrait awaits the Maesters' review.", plain: "Your photo is pending moderator review." },
  photoRefusedMsg: { themed: "The Maesters have refused this portrait.", plain: "Your photo was rejected." },
  reportTitle: { themed: "▸ Report to the Maesters", plain: "▸ Report content" },
  reportPlaceholder: { themed: "Anything the Maesters should know? (optional)", plain: "Additional details (optional)" },
  reportDone: { themed: "The Maesters will review", plain: "A moderator will review" },
  connectionError: { themed: "the ravens were lost", plain: "connection error — please try again" },
  thisFief: { themed: "This Fief", plain: "This area" },
  holdsThisLand: { themed: "holds this land", plain: "leads this area" },
  noHouseHolds: { themed: "No House holds this land", plain: "No team leads this area" },
  contested: { themed: "Contested", plain: "Contested" },
} as const;

export type CopyKey = keyof typeof COPY;

export function copyFor(key: CopyKey, plain: boolean): string {
  const entry = COPY[key];
  if (!entry) return String(key); // never throw, never blank
  return plain ? entry.plain : entry.themed;
}

const PlainSpeechContext = createContext<{ plain: boolean; toggle: () => void }>({
  plain: false,
  toggle: () => {},
});

export function PlainSpeechProvider({ children }: { children: ReactNode }) {
  const [plain, setPlain] = useState(false); // themed on first paint (SSR-safe)
  useEffect(() => {
    try {
      setPlain(window.localStorage.getItem("sot-plain-speech") === "1");
    } catch {
      // storage unavailable — session-only state
    }
  }, []);
  const toggle = useCallback(() => {
    setPlain((p) => {
      const next = !p;
      try {
        window.localStorage.setItem("sot-plain-speech", next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);
  return (
    <PlainSpeechContext.Provider value={{ plain, toggle }}>
      {children}
    </PlainSpeechContext.Provider>
  );
}

export function usePlainSpeech() {
  return useContext(PlainSpeechContext);
}

export function useCopy() {
  const { plain } = useContext(PlainSpeechContext);
  return useCallback((key: CopyKey) => copyFor(key, plain), [plain]);
}
```

`src/components/PlainSpeechToggle.tsx`:

```tsx
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
```

`src/app/layout.tsx`: wrap the existing providers/children with `<PlainSpeechProvider>` (import from `@/lib/copy`) — add it around whatever currently wraps `{children}`, keeping existing wrappers.

`src/app/page.tsx` header: render `<PlainSpeechToggle />` next to `<ThemeToggle />` (inside the same `flex items-center gap-2.5` div).

- [ ] **Step 4: run to pass** — `npx.cmd vitest run src/lib/copy.test.ts src/lib/selectors.test.ts` → PASS; `npx.cmd tsc --noEmit` clean.
- [ ] **Step 5: commit** — `git add -A src/lib src/components/PlainSpeechToggle.tsx src/app/layout.tsx src/app/page.tsx && git commit -m "feat: Plain Speech mode — copy module, toggle, plain tier labels"`

### Task 2: Copy sweep + plain tier gloss

**Files:** Modify `src/components/ThroneSheet.tsx`, `SittingFlow.tsx`, `AddThroneFlow.tsx`, `ReportModal.tsx`, `FiefCard.tsx`, `NearestWorthyButton.tsx`, `Onboarding.tsx`, `AgeGate.tsx`, `ProfilePanel.tsx`, `ModerationQueue.tsx`.

In each component: `const t = useCopy();` (import from `@/lib/copy`) and replace the hardcoded strings with `t("<key>")` per this mapping (themed strings in COPY were copied byte-for-byte from these call sites — if any differs, fix COPY to match the code, not vice versa):

| Call site | Key |
|---|---|
| ThroneSheet "Sit Here" button | `sitHere` |
| ThroneSheet Rumored / ✓ Verified / Forgotten chips | `rumored` / `verifiedChip` / `forgotten` |
| ThroneSheet "Unrated" | `unrated` |
| ThroneSheet `sitting{count === 1 ? "" : "s"}` | `count === 1 ? t("sittingSingular") : t("sittingPlural")` |
| ThroneSheet "Recent testimony" | `recentTestimony` |
| ThroneSheet "Offer a Portrait" / photo rules / photo status strings | `offerPortrait` / `photoRules` / `photoPendingChip` / `photoRefusedChip` / `photoPendingMsg` / `photoRefusedMsg` |
| ThroneSheet confirm button | `confirmThrone` |
| ThroneSheet tier chip label | `plain ? tier.plainLabel : tier.label` via `usePlainSpeech()` (switch to `displayTier(score)`; keep glyph, wrap it `<span aria-hidden="true">{tier.glyph}</span>`) |
| ThroneSheet + all `"the ravens were lost"` fallbacks (also AddThroneFlow, AgeGate, ModerationQueue, Onboarding, ProfilePanel, ReportModal, SittingFlow) | `connectionError` |
| SittingFlow verdict picker labels | `plain ? v.plainLabel : v.label` via `usePlainSpeech()` |
| AddThroneFlow toggle "+ Chart a Throne" (in `AddThroneToggle`) | `chartThrone` |
| NearestWorthyButton label | `nearestWorthy` (whole themed string includes the ⚔️ emoji; acceptable — plain string has none) |
| ReportModal title / placeholder / done-message prefix | `reportTitle` / `reportPlaceholder` / `` `${t("reportDone")} ${subjectLabel}.` `` |
| FiefCard "This Fief" / leader line / empty line / badge | `thisFief` / `` `${leader.name} ${t("holdsThisLand")}` `` / `noHouseHolds` / `contested` |

Rules: do NOT touch House names, rank names, Ledger rendering, server-message passthroughs (`e.message`), or `src/lib/store.tsx` (its fallback string stays themed — documented spec limitation). Decorative flavor lines that carry no functional info stay themed.

- [ ] Implement per table; `npx.cmd tsc --noEmit` clean.
- [ ] Claude: `npx.cmd vitest run` (full) → all pass; commit `git add -A src/components && git commit -m "feat: route functional copy through Plain Speech dictionary"`

### Task 3: A11y semantics + carry-forward fixes

**Files:** Create `src/lib/useEscape.ts`; Modify `ThroneSheet.tsx`, `ReportModal.tsx`, `AddThroneFlow.tsx`, `FiefCard.tsx`, `SittingFlow.tsx`, `ThemeToggle.tsx`, `src/app/page.tsx`.

`src/lib/useEscape.ts`:

```ts
"use client";

import { useEffect } from "react";

/** Closes an overlay on Escape. Attach once per open overlay. */
export function useEscape(onClose: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}
```

Apply, per modal overlay (ThroneSheet, ReportModal, AddThroneForm):
- `useEscape(onClose)` at top of component.
- Panel div: `role="dialog"` `aria-modal="true"` `aria-labelledby="<title id>"` `tabIndex={-1}` + ref focused on mount:

```tsx
const panelRef = useRef<HTMLDivElement>(null);
useEffect(() => { panelRef.current?.focus(); }, []);
// <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="throne-sheet-title" className="pixel-panel ...">
// title element gets a unique id per component: throne-sheet-title, report-modal-title, add-throne-title
```

FiefCard (map stays interactive → NOT a modal): `role="region"` + `aria-label={t("thisFief")}` + `useEscape(onClose)`; no focus steal.

Decorative emoji sweep — wrap literal JSX emoji in `<span aria-hidden="true">`: tier chip glyph (done in Task 2), verdict glyphs in SittingFlow picker, ThemeToggle 🔥 (button already has aria-label). Header house-color chip in `page.tsx`: add `role="img" aria-label={house.name}` (keep `title`). Emoji living inside translated strings or DB-stored ledger text are left alone.

Carry-forward fixes:
- `page.tsx` TabBar: `onChange={(tab) => { setActiveTab(tab); setSelectedFiefId(null); }}`
- ThroneSheet tier chip classes → `pixel-chip border border-brass bg-vellum px-2.5 py-1 font-mono text-[13px] uppercase tracking-wide text-brass-strong` (distinct from the Rumored chip's `bg-brass/20`).
- Verify ThroneSheet uses `displayTier` (Task 2).

- [ ] Implement; `npx.cmd tsc --noEmit` clean.
- [ ] Claude: full `npx.cmd vitest run` → pass; commit `git add -A src && git commit -m "feat: dialog semantics, Esc-to-close, aria-hidden emoji; cycle-1 carry-forward fixes"`

### Task 4 (Claude): contrast + axe audit, combined review, verification, push gate

- [ ] **Contrast:** compute WCAG ratios for the palette pairs actually used (ink/ink-soft/ink-faint/brass/brass-strong/crimson/emerald on vellum/vellum-raised, both themes) with a scratchpad Node script (relative luminance, ratio = (L1+0.05)/(L2+0.05); AA: 4.5:1 normal text, 3:1 large/UI). Fix failing pairs by adjusting variable values in `src/app/globals.css` minimally (preserve hue, adjust lightness). Record before/after ratios as an amendment in the spec's §2.
- [ ] **Axe scan:** `npm i -D axe-core`; inject `node_modules/axe-core/axe.min.js` into the dev page via the browser pane's JS tool; run `axe.run()` on: themed+Torchlit, themed+Moonlit, plain+Torchlit, with ThroneSheet open and FiefCard open. Fix violations or record waivers in the spec amendment.
- [ ] **Combined review (lean):** ONE reviewer pass over the whole cycle diff (spec compliance + quality together); fix anything Critical/Important.
- [ ] **Verify:** full `npm test` + `npm run build`; browser: toggle flips copy live + persists across reload; Esc closes each overlay; tier chip visually distinct from Rumored; fief card gone after tab switch.
- [ ] **Push gate:** ask Larry before pushing (prod deploys).

## Self-review notes
- Spec §1 → Tasks 1–2; §2 → Tasks 3–4; §3 → Tasks 2–3; testing → Tasks 1, 4.
- Names consistent: `copyFor`/`useCopy`/`usePlainSpeech`/`CopyKey`, `displayTier`, `useEscape`; COPY keys match the Task 2 table.
- Themed strings in COPY must match current hardcoded strings exactly — implementer verifies against the live files and corrects COPY (not the code) on drift.
