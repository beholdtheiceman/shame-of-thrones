"use client";

export type TabId = "realm" | "ledger" | "ranks";

const TABS: { id: TabId; label: string }[] = [
  { id: "realm", label: "Realm" },
  { id: "ledger", label: "Ledger" },
  { id: "ranks", label: "Ranks" },
];

export function TabBar({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (tab: TabId) => void;
}) {
  return (
    <nav className="flex justify-around border-t border-vellum-line bg-vellum-raised py-2">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className="flex flex-col items-center gap-1 px-4 py-1"
        >
          <span
            className={`h-1 w-1 rounded-full ${
              active === t.id ? "bg-brass" : "bg-transparent"
            }`}
          />
          <span
            className={`text-[10.5px] uppercase tracking-wide ${
              active === t.id ? "font-bold text-brass-strong" : "text-ink-faint"
            }`}
          >
            {t.label}
          </span>
        </button>
      ))}
    </nav>
  );
}
