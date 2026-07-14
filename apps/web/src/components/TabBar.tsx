"use client";

export type TabId = "realm" | "ledger" | "ranks" | "standings";

const TABS: { id: TabId; label: string }[] = [
  { id: "realm", label: "Realm" },
  { id: "ledger", label: "Ledger" },
  { id: "ranks", label: "Ranks" },
  { id: "standings", label: "Standings" },
];

export function TabBar({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (tab: TabId) => void;
}) {
  return (
    <nav className="flex justify-around border-t-4 border-vellum-line bg-vellum-raised py-2.5">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className="flex flex-col items-center gap-1.5 px-4 py-1"
        >
          <span className="h-1.5 w-1.5" style={{ background: active === t.id ? "var(--brass)" : "transparent" }} />
          <span
            className={`font-mono text-[14px] uppercase tracking-wide ${
              active === t.id ? "text-brass" : "text-ink-faint"
            }`}
          >
            {t.label}
          </span>
        </button>
      ))}
    </nav>
  );
}
