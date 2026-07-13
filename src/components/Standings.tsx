"use client";

import { useEffect, useState } from "react";
import { api, type StandingsDTO } from "@/lib/api";
import { useCopy } from "@/lib/copy";
import { HOUSE_BY_ID } from "@/lib/data";
import type { WindowKey } from "@/lib/standings";
import { useStore } from "@/lib/store";

type Board = "council" | "houses";
const WINDOW_LABELS: { key: WindowKey; label: string }[] = [
  { key: "week", label: "This Week" },
  { key: "season", label: "This Season" },
  { key: "all", label: "All-Time" },
];

export function Standings() {
  const { state } = useStore();
  const t = useCopy();
  const anonymous = state.authStatus === "anonymous";
  const myHouse = state.profile?.houseId ?? null;

  const [board, setBoard] = useState<Board>("council");
  const [window, setWindow] = useState<WindowKey>("week");
  const [mine, setMine] = useState(false);
  const houseParam = mine && myHouse ? myHouse : "all";
  const requestKey = `${window}:${houseParam}`;
  const [result, setResult] = useState<{
    key: string;
    data: StandingsDTO | null;
    error: boolean;
  }>({ key: "", data: null, error: false });
  const data = result.key === requestKey ? result.data : null;
  const error = result.key === requestKey ? result.error : false;

  useEffect(() => {
    let live = true;
    api
      .standings(window, houseParam)
      .then((d) => {
        if (live) {
          setResult({ key: requestKey, data: d, error: false });
        }
      })
      .catch(() => live && setResult({ key: requestKey, data: null, error: true }));
    return () => {
      live = false;
    };
  }, [window, houseParam, requestKey]);

  return (
    <div className="mx-auto max-w-md px-4 py-4">
      <div className="mb-3 flex gap-2">
        <SegBtn on={board === "council"} onClick={() => setBoard("council")}>
          {t("smallCouncil")}
        </SegBtn>
        <SegBtn on={board === "houses"} onClick={() => setBoard("houses")}>
          {t("houseStandings")}
        </SegBtn>
      </div>

      {error && (
        <p className="pixel-panel p-4 font-mono text-[13px] text-ink-soft">
          The ravens could not reach the Citadel. Try again once you are back on the map.
        </p>
      )}

      {!error && board === "council" && (
        <>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {WINDOW_LABELS.map((w) => (
              <SegBtn key={w.key} on={window === w.key} onClick={() => setWindow(w.key)}>
                {w.label}
              </SegBtn>
            ))}
          </div>
          {!anonymous && myHouse && (
            <div className="mb-3 flex gap-1.5">
              <SegBtn on={!mine} onClick={() => setMine(false)}>{t("allHouses")}</SegBtn>
              <SegBtn on={mine} onClick={() => setMine(true)}>{t("myHouse")}</SegBtn>
            </div>
          )}
          <CouncilList data={data} viewerName={anonymous ? null : state.profile?.name ?? null} />
          {anonymous && (
            <p className="mt-3 font-mono text-[12px] text-ink-faint">
              {t("standingsSignIn")}
            </p>
          )}
        </>
      )}

      {!error && board === "houses" && <HouseList data={data} />}
    </div>
  );
}

function SegBtn({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`pixel-chip px-3 py-1.5 font-mono text-[12px] uppercase tracking-wide ${
        on ? "bg-brass text-on-brass" : "bg-vellum text-ink-soft"
      }`}
    >
      {children}
    </button>
  );
}

function Chip({ houseId }: { houseId: string }) {
  const house = HOUSE_BY_ID[houseId as keyof typeof HOUSE_BY_ID];
  return (
    <span
      className="pixel-chip inline-block h-4 w-4 shrink-0"
      style={{ background: house?.colorVar }}
      role="img"
      aria-label={house?.name ?? "House"}
    />
  );
}

function CouncilList({
  data,
  viewerName,
}: {
  data: StandingsDTO | null;
  viewerName: string | null;
}) {
  const t = useCopy();
  if (!data) return <p className="font-mono text-[13px] text-ink-faint">Summoning the Council…</p>;
  if (data.council.rows.length === 0) {
    return (
      <p className="pixel-panel p-4 font-mono text-[13px] text-ink-soft">
        {t("noStandingsDeeds")}
      </p>
    );
  }
  return (
    <div className="pixel-panel divide-y divide-vellum-line">
      {data.council.rows.map((r) => (
        <Row key={r.name} pos={r.position} name={r.name} houseId={r.houseId} points={r.points} me={r.name === viewerName} />
      ))}
      {data.council.viewerRow && (
        <Row
          pos={data.council.viewerRow.position}
          name={data.council.viewerRow.name}
          houseId={data.council.viewerRow.houseId}
          points={data.council.viewerRow.points}
          me
        />
      )}
    </div>
  );
}

function Row({
  pos,
  name,
  houseId,
  points,
  me,
}: {
  pos: number;
  name: string;
  houseId: string;
  points: number;
  me?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 font-mono text-[13px] ${
        me ? "bg-brass/15 text-brass" : "text-ink-soft"
      }`}
    >
      <span className="w-7 tabular-nums text-ink-faint">{pos}</span>
      <Chip houseId={houseId} />
      <span className="min-w-0 flex-1 truncate">{me ? `${name} (You)` : name}</span>
      <span className="tabular-nums">{points.toLocaleString()}</span>
    </div>
  );
}

function HouseList({ data }: { data: StandingsDTO | null }) {
  if (!data) return <p className="font-mono text-[13px] text-ink-faint">Counting the banners…</p>;
  return (
    <div className="flex flex-col gap-2">
      {data.houses.map((h) => {
        const house = HOUSE_BY_ID[h.houseId];
        return (
          <div key={h.houseId} className="pixel-panel p-3">
            <div className="flex items-center justify-between font-mono text-[13px] text-ink-soft">
              <span className="flex items-center gap-2">
                <Chip houseId={h.houseId} />
                {house?.name ?? h.houseId}
              </span>
              <span className="tabular-nums">
                {Math.round(h.share * 100)}% · {h.fiefsLed} {h.fiefsLed === 1 ? "fief" : "fiefs"}
              </span>
            </div>
            <div className="mt-2 h-2 bg-vellum-line">
              <div className="h-full" style={{ width: `${Math.round(h.share * 100)}%`, background: house?.colorVar }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
