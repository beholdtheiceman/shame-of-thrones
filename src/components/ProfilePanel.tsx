"use client";

import { useMemo, useState } from "react";
import { ApiError } from "@/lib/api";
import { HOUSES, HOUSE_BY_ID } from "@/lib/data";
import { HOUSE_SWITCH_WINDOW_MS } from "@/lib/game/rules";
import { useCopy } from "@/lib/copy";
import { useStore } from "@/lib/store";
import { useNow } from "@/lib/useNow";
import type { BadgeId, HouseId } from "@/lib/types";

const BADGE_META: Record<BadgeId, { icon: string; title: string; desc: string }> = {
  first_of_their_name: {
    icon: "🏅",
    title: "First of Their Name",
    desc: "Logged the first-ever rating at a throne.",
  },
  cartographer: {
    icon: "🗺️",
    title: "The Cartographer",
    desc: "Charted a new throne for the Realm.",
  },
  nights_watch: {
    icon: "🌙",
    title: "The Night's Watch",
    desc: "Rated a throne in the small hours (before 5am).",
  },
  oathkeeper: {
    icon: "🛡️",
    title: "Oathkeeper",
    desc: "Kept a 4-week streak of verified deeds.",
  },
};

export function ProfilePanel() {
  const { state, switchHouse } = useStore();
  const t = useCopy();
  const { profile } = state;
  const now = useNow();
  const [switchingHouse, setSwitchingHouse] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const standings = useMemo(() => {
    const totals = new Map<HouseId, { influence: number; fiefsHeld: number }>();
    for (const h of HOUSES) totals.set(h.id, { influence: 0, fiefsHeld: 0 });

    for (const control of state.realm?.fiefs ?? []) {
      for (const s of control.shares) {
        const entry = totals.get(s.houseId)!;
        entry.influence += s.influence;
      }
      if (control.leader) totals.get(control.leader.houseId)!.fiefsHeld += 1;
    }

    return HOUSES.map((h) => ({ house: h, ...totals.get(h.id)! })).sort(
      (a, b) => b.fiefsHeld - a.fiefsHeld || b.influence - a.influence
    );
  }, [state.realm?.fiefs]);

  if (!profile) return null;

  const rank = state.rank;
  if (!rank) return null;
  const house = HOUSE_BY_ID[profile.houseId];

  const canSwitch =
    !profile.lastHouseSwitchAt || now - profile.lastHouseSwitchAt > HOUSE_SWITCH_WINDOW_MS;

  async function handleSwitchHouse(houseId: HouseId) {
    setSwitchingHouse(true);
    setSwitchError(null);
    try {
      await switchHouse(houseId);
    } catch (e) {
      setSwitchError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : t("connectionError"));
    } finally {
      setSwitchingHouse(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      <p className="font-mono text-[15px] uppercase tracking-widest text-brass">
        ▸ Your Standing
      </p>
      <h1 className="mt-2 font-display text-[17px] leading-relaxed text-ink">{profile.name}</h1>

      <div className="pixel-panel mt-4 p-4">
        <div className="flex items-baseline justify-between">
          <span className="font-display text-[11px] tracking-wide text-ink">{rank.name}</span>
          <span className="font-mono text-[14px] text-ink-faint">
            {rank.nextName ?? "Max rank"}
          </span>
        </div>
        <div className="pixel-chip mt-3 h-3 overflow-hidden bg-vellum">
          <div className="h-full bg-brass" style={{ width: `${Math.round(rank.progress * 100)}%` }} />
        </div>
        <p className="mt-1.5 text-right font-mono text-[14px] text-ink-faint tabular">
          {rank.xp} {rank.ceiling ? `/ ${rank.ceiling}` : ""} XP
        </p>
        {state.streak && state.streak.weeks > 0 && (
          <p className="mt-2 font-mono text-[13px] text-ink-soft">
            🔥 {state.streak.weeks}-week streak
            {!state.streak.thisWeekActive && (
              <span className="text-ink-faint"> · {t("streakAtRisk")}</span>
            )}
          </p>
        )}
      </div>

      <div className="pixel-panel mt-4 p-4">
        <p className="font-mono text-[13px] uppercase tracking-wide text-ink-faint">Sworn to</p>
        <div className="mt-2 flex items-center gap-2.5">
          <span
            className="h-4 w-7"
            style={{
              background: house.colorVar,
              clipPath: "polygon(0 0,100% 0,100% 70%,50% 100%,0 70%)",
            }}
          />
          <span className="font-display text-[11px] text-ink">{house.name}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          {HOUSES.filter((h) => h.id !== profile.houseId).map((h) => (
            <button
              key={h.id}
              type="button"
              disabled={!canSwitch || switchingHouse}
              onClick={() => void handleSwitchHouse(h.id)}
              className="pixel-chip bg-vellum px-2.5 py-1.5 text-left font-mono text-[13px] text-ink-soft transition disabled:cursor-not-allowed disabled:opacity-40"
            >
              Ride for {h.name}
            </button>
          ))}
        </div>
        <p className="mt-2 font-mono text-[13px] text-ink-faint">
          Houses may be switched once per Season
          {!canSwitch && " — you've already switched recently"}.
        </p>
        {switchError && <p className="mt-2 font-mono text-[13px] text-crimson">{switchError}</p>}
      </div>

      {profile.badges.length > 0 && (
        <div className="pixel-panel mt-4 p-4">
          <p className="font-mono text-[13px] uppercase tracking-wide text-ink-faint">Badges</p>
          <div className="mt-2.5 space-y-2.5">
            {profile.badges.filter((b): b is BadgeId => b in BADGE_META).map((b) => (
              <div key={b} className="flex items-center gap-2.5">
                <span className="pixel-chip flex h-8 w-8 items-center justify-center bg-brass text-sm text-on-brass">
                  {BADGE_META[b].icon}
                </span>
                <div>
                  <p className="font-mono text-[14px] text-ink">{BADGE_META[b].title}</p>
                  <p className="font-mono text-[13px] text-ink-faint">{BADGE_META[b].desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="pixel-panel mt-4 p-4">
        <p className="font-mono text-[13px] uppercase tracking-wide text-ink-faint">
          Realm Standings — race for the Porcelain Crown
        </p>
        <div className="mt-3 space-y-2.5">
          {standings.map((s, i) => (
            <div key={s.house.id} className="flex items-center gap-2.5">
              <span className="w-4 font-mono text-[14px] text-ink-faint">{i + 1}</span>
              <span
                className="h-4 w-7 shrink-0"
                style={{
                  background: s.house.colorVar,
                  clipPath: "polygon(0 0,100% 0,100% 70%,50% 100%,0 70%)",
                }}
              />
              <span className="flex-1 font-mono text-[14px] text-ink">{s.house.name}</span>
              <span className="font-mono text-[13px] tabular text-ink-soft">
                {s.fiefsHeld} fief{s.fiefsHeld === 1 ? "" : "s"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
