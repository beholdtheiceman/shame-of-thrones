"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { AddThroneForm, AddThroneToggle } from "@/components/AddThroneFlow";
import { Ledger } from "@/components/Ledger";
import { NearestWorthyButton } from "@/components/NearestWorthyButton";
import { Onboarding } from "@/components/Onboarding";
import { ProfilePanel } from "@/components/ProfilePanel";
import { TabBar, type TabId } from "@/components/TabBar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ThroneSheet } from "@/components/ThroneSheet";
import { HOUSE_BY_ID, REALM_NAME } from "@/lib/data";
import { useStore } from "@/lib/store";

const RealmMap = dynamic(() => import("@/components/RealmMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center font-mono text-xs text-ink-faint">
      Charting the Realm…
    </div>
  ),
});

export default function Home() {
  const { state } = useStore();
  const [activeTab, setActiveTab] = useState<TabId>("realm");
  const [selectedThroneId, setSelectedThroneId] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [pendingCoords, setPendingCoords] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);

  const selectedThrone = useMemo(
    () => state.thrones.find((t) => t.id === selectedThroneId) ?? null,
    [state.thrones, selectedThroneId]
  );

  if (!state.profile) return <Onboarding />;

  const house = HOUSE_BY_ID[state.profile.houseId];

  return (
    <div className="flex h-dvh flex-col bg-vellum">
      <header className="flex items-center justify-between border-b border-vellum-line bg-vellum-raised px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-brass" />
          <div>
            <p className="font-display text-[13px] font-bold leading-tight text-ink">
              {REALM_NAME}
            </p>
            <p className="font-mono text-[10px] leading-tight text-ink-faint">
              Shame of Thrones
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <span
            className="h-6 w-6 rounded-full border-2"
            style={{ background: house.colorVar, borderColor: "var(--vellum-raised)" }}
            title={house.name}
          />
        </div>
      </header>

      <main className="relative min-h-0 flex-1">
        {activeTab === "realm" && (
          <div className="relative h-full w-full">
            <RealmMap
              thrones={state.thrones}
              ratings={state.ratings}
              influenceEvents={state.influenceEvents}
              selectedThroneId={selectedThroneId}
              onSelectThrone={setSelectedThroneId}
              addMode={addMode}
              onMapClick={(lat, lng) => {
                setPendingCoords({ lat, lng });
                setAddMode(false);
              }}
              flyTarget={flyTarget}
            />

            <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
              <AddThroneToggle addMode={addMode} onToggle={() => setAddMode((v) => !v)} />
            </div>

            <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
              <NearestWorthyButton
                onFound={(id, coords) => {
                  setSelectedThroneId(id);
                  setFlyTarget(coords);
                }}
              />
            </div>
          </div>
        )}

        {activeTab === "ledger" && (
          <div className="h-full overflow-y-auto">
            <Ledger />
          </div>
        )}

        {activeTab === "ranks" && (
          <div className="h-full overflow-y-auto">
            <ProfilePanel />
          </div>
        )}
      </main>

      <TabBar active={activeTab} onChange={setActiveTab} />

      {selectedThrone && (
        <ThroneSheet throne={selectedThrone} onClose={() => setSelectedThroneId(null)} />
      )}

      {pendingCoords && (
        <AddThroneForm coords={pendingCoords} onClose={() => setPendingCoords(null)} />
      )}
    </div>
  );
}
