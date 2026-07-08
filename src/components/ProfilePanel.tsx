"use client";

import { useMemo } from "react";
import { HOUSES, HOUSE_BY_ID } from "@/lib/data";
import { fiefIdForCoords } from "@/lib/geo";
import { fiefControl, lifetimeXp, rankForXp } from "@/lib/selectors";
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
};

const SWITCH_COOLDOWN_MS = 60 * 60 * 1000; // demo cooldown; a real Season is 8 weeks

export function ProfilePanel() {
  const { state, switchHouse } = useStore();
  const { profile } = state;
  const now = useNow();

  const standings = useMemo(() => {
    const fiefIds = [
      ...new Set(state.thrones.map((t) => fiefIdForCoords(t.lat, t.lng))),
    ];
    const totals = new Map<HouseId, { influence: number; fiefsHeld: number }>();
    for (const h of HOUSES) totals.set(h.id, { influence: 0, fiefsHeld: 0 });

    for (const fiefId of fiefIds) {
      const control = fiefControl(fiefId, state.influenceEvents, now);
      for (const s of control.shares) {
        const entry = totals.get(s.houseId)!;
        entry.influence += s.influence;
      }
      if (control.leader) totals.get(control.leader.houseId)!.fiefsHeld += 1;
    }

    return HOUSES.map((h) => ({ house: h, ...totals.get(h.id)! })).sort(
      (a, b) => b.fiefsHeld - a.fiefsHeld || b.influence - a.influence
    );
  }, [state.thrones, state.influenceEvents, now]);

  if (!profile) return null;

  const xp = lifetimeXp(profile.name, state.influenceEvents);
  const rank = rankForXp(xp);
  const house = HOUSE_BY_ID[profile.houseId];

  const canSwitch =
    !profile.lastHouseSwitchAt || now - profile.lastHouseSwitchAt > SWITCH_COOLDOWN_MS;

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      <p className="font-mono text-[10.5px] uppercase tracking-widest text-brass-strong">
        Your Standing
      </p>
      <h1 className="mt-1 font-display text-2xl font-bold text-ink">{profile.name}</h1>

      <div className="mt-4 rounded-xl border border-vellum-line bg-vellum-raised p-4">
        <div className="flex items-baseline justify-between">
          <span className="font-display text-base font-bold tracking-wide text-ink">
            {rank.name}
          </span>
          <span className="font-mono text-[11px] text-ink-faint">
            {rank.nextName ?? "Max rank"}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-vellum-line">
          <div
            className="h-full bg-brass"
            style={{ width: `${Math.round(rank.progress * 100)}%` }}
          />
        </div>
        <p className="mt-1.5 text-right font-mono text-[10.5px] text-ink-faint tabular">
          {xp} {rank.ceiling ? `/ ${rank.ceiling}` : ""} XP
        </p>
      </div>

      <div className="mt-4 rounded-xl border border-vellum-line bg-vellum-raised p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Sworn to
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <span
            className="h-3 w-6"
            style={{
              background: house.colorVar,
              clipPath: "polygon(0 0,100% 0,100% 70%,50% 100%,0 70%)",
            }}
          />
          <span className="font-display text-sm font-bold text-ink">{house.name}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          {HOUSES.filter((h) => h.id !== profile.houseId).map((h) => (
            <button
              key={h.id}
              type="button"
              disabled={!canSwitch}
              onClick={() => switchHouse(h.id)}
              className="rounded-lg border border-vellum-line px-2.5 py-1.5 text-left text-[11px] text-ink-soft transition hover:border-brass/50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Ride for {h.name}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-ink-faint">
          Houses may be switched once per Season
          {!canSwitch && " — you've already switched recently"}.
        </p>
      </div>

      {profile.badges.length > 0 && (
        <div className="mt-4 rounded-xl border border-vellum-line bg-vellum-raised p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Badges
          </p>
          <div className="mt-2 space-y-2">
            {profile.badges.map((b) => (
              <div key={b} className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brass text-xs text-on-brass">
                  {BADGE_META[b].icon}
                </span>
                <div>
                  <p className="text-xs font-semibold text-ink">{BADGE_META[b].title}</p>
                  <p className="text-[10.5px] text-ink-faint">{BADGE_META[b].desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-vellum-line bg-vellum-raised p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Realm Standings — race for the Porcelain Crown
        </p>
        <div className="mt-2.5 space-y-2.5">
          {standings.map((s, i) => (
            <div key={s.house.id} className="flex items-center gap-2.5">
              <span className="w-3.5 font-mono text-[10.5px] text-ink-faint">{i + 1}</span>
              <span
                className="h-3 w-6 shrink-0"
                style={{
                  background: s.house.colorVar,
                  clipPath: "polygon(0 0,100% 0,100% 70%,50% 100%,0 70%)",
                }}
              />
              <span className="flex-1 text-xs font-medium text-ink">{s.house.name}</span>
              <span className="font-mono text-[10.5px] tabular text-ink-soft">
                {s.fiefsHeld} fief{s.fiefsHeld === 1 ? "" : "s"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
