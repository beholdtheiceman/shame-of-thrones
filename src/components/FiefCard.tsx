"use client";

import { HOUSE_BY_ID } from "@/lib/data";
import { useCopy } from "@/lib/copy";
import { fiefCardModel, type FiefControl } from "@/lib/selectors";

export function FiefCard({
  control,
  onClose,
}: {
  control: FiefControl | null;
  onClose: () => void;
}) {
  const t = useCopy();
  const model = fiefCardModel(control);
  const leader = model.leaderHouseId ? HOUSE_BY_ID[model.leaderHouseId] : null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[900] flex justify-center px-4">
      <div className="pixel-panel pointer-events-auto w-full max-w-md p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[13px] uppercase tracking-widest text-brass">
              {t("thisFief")}
            </p>
            {leader ? (
              <p className="mt-1 font-display text-[12px]" style={{ color: leader.colorVar }}>
                {leader.name} {t("holdsThisLand")}
              </p>
            ) : (
              <p className="mt-1 font-display text-[12px] text-ink-faint">
                {t("noHouseHolds")}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {model.contested && (
              <span className="pixel-chip bg-crimson/20 px-2.5 py-1 font-mono text-[12px] uppercase tracking-wide text-crimson">
                {t("contested")}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="pixel-chip shrink-0 bg-vellum px-2.5 py-1 font-mono text-sm text-ink-faint hover:text-ink"
            >
              ✕
            </button>
          </div>
        </div>

        <ul className="mt-3 space-y-2">
          {model.rows.map((row) => {
            const house = HOUSE_BY_ID[row.houseId];
            return (
              <li key={row.houseId}>
                <div className="flex items-center justify-between font-mono text-[13px]">
                  <span style={{ color: row.percent > 0 ? house.colorVar : "var(--ink-faint)" }}>
                    {house.name}
                  </span>
                  <span className="tabular text-ink-soft">{row.percent}%</span>
                </div>
                <div className="mt-1 h-2 w-full border border-vellum-line bg-vellum">
                  <div
                    className="h-full"
                    style={{ width: `${row.percent}%`, background: house.colorVar }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
