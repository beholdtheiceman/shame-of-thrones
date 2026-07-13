"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { AddThroneForm, AddThroneToggle } from "@/components/AddThroneFlow";
import { AgeGate } from "@/components/AgeGate";
import { FiefCard } from "@/components/FiefCard";
import { Ledger } from "@/components/Ledger";
import { NearestWorthyButton } from "@/components/NearestWorthyButton";
import { Onboarding } from "@/components/Onboarding";
import { OfflineBanner } from "@/components/OfflineBanner";
import { PlainSpeechToggle } from "@/components/PlainSpeechToggle";
import { ProfilePanel } from "@/components/ProfilePanel";
import { SignInGate } from "@/components/SignInGate";
import { TabBar, type TabId } from "@/components/TabBar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ThroneSheet } from "@/components/ThroneSheet";
import { HOUSE_BY_ID, REALM_NAME } from "@/lib/data";
import { useEscape } from "@/lib/useEscape";
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
  const [selectedFiefId, setSelectedFiefId] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [pendingCoords, setPendingCoords] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const [showAddSignInGate, setShowAddSignInGate] = useState(false);
  const thrones = state.realm?.thrones ?? [];

  const selectedThrone = useMemo(
    () => thrones.find((t) => t.id === selectedThroneId) ?? null,
    [thrones, selectedThroneId]
  );
  const selectedFief = useMemo(
    () => (state.realm?.fiefs ?? []).find((f) => f.fiefId === selectedFiefId) ?? null,
    [state.realm?.fiefs, selectedFiefId]
  );

  const signedIn = state.authStatus === "needs_profile" || state.authStatus === "ready";
  if (signedIn && state.ageGate !== null && (!state.ageGate.confirmed || state.ageGate.locked)) {
    return <AgeGate />;
  }
  if (state.authStatus === "needs_profile") return <Onboarding />;

  const house = state.profile ? HOUSE_BY_ID[state.profile.houseId] : null;

  return (
    <div className="stone-wall flex h-dvh flex-col">
      <header className="flex items-center justify-between border-b-4 border-vellum-line bg-vellum-raised px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="pixel-gem" />
          <div>
            <h1 className="font-display text-[9px] leading-tight text-brass">Shame of Thrones</h1>
            <p className="mt-1 font-mono text-[15px] leading-none text-ink-soft">{REALM_NAME}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <PlainSpeechToggle />
          <ThemeToggle />
          {house && (
            <span
              className="pixel-chip block h-7 w-7"
              style={{ background: house.colorVar }}
              title={house.name}
              role="img"
              aria-label={house.name}
            />
          )}
        </div>
      </header>

      <main className="relative min-h-0 flex-1">
        {activeTab === "realm" && (
          <div className="relative h-full w-full">
            <OfflineBanner />
            <RealmMap
              thrones={thrones}
              fiefs={state.realm?.fiefs ?? []}
              selectedThroneId={selectedThroneId}
              onSelectThrone={(id) => {
                setSelectedThroneId(id);
                setSelectedFiefId(null);
              }}
              onSelectFief={(id) => {
                setSelectedFiefId(id);
                setSelectedThroneId(null);
              }}
              onBackgroundClick={() => setSelectedFiefId(null)}
              addMode={addMode}
              onMapClick={(lat, lng) => {
                setPendingCoords({ lat, lng });
                setAddMode(false);
              }}
              flyTarget={flyTarget}
            />

            <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
              <AddThroneToggle
                addMode={addMode}
                onToggle={() => {
                  if (state.authStatus === "anonymous") {
                    setShowAddSignInGate(true);
                    return;
                  }
                  setAddMode((v) => !v);
                }}
              />
            </div>

            {!selectedFiefId && (
              <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
                <NearestWorthyButton
                  onFound={(id, coords) => {
                    setSelectedThroneId(id);
                    setFlyTarget(coords);
                  }}
                />
              </div>
            )}

            {selectedFiefId && (
              <FiefCard control={selectedFief} onClose={() => setSelectedFiefId(null)} />
            )}
          </div>
        )}

        {activeTab === "ledger" && (
          <div className="h-full overflow-y-auto">
            <Ledger />
          </div>
        )}

        {activeTab === "ranks" && (
          <div className="h-full overflow-y-auto">
            {state.authStatus === "anonymous" ? (
              <div className="mx-auto max-w-md px-4 py-5">
                <div className="pixel-panel p-5">
                  <Onboarding />
                </div>
              </div>
            ) : (
              <ProfilePanel />
            )}
          </div>
        )}
      </main>

      <TabBar active={activeTab} onChange={(tab) => { setActiveTab(tab); setSelectedFiefId(null); }} />

      {selectedThrone && (
        <ThroneSheet throne={selectedThrone} onClose={() => setSelectedThroneId(null)} />
      )}

      {pendingCoords && (
        <AddThroneForm coords={pendingCoords} onClose={() => setPendingCoords(null)} />
      )}

      {showAddSignInGate && (
        <AddSignInGateOverlay onClose={() => setShowAddSignInGate(false)} />
      )}
    </div>
  );
}

function AddSignInGateOverlay({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
  }, []);
  return (
    <div className="fixed inset-0 z-[1002] flex items-end justify-center bg-black/60 sm:items-center sm:p-6">
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Sign in"
        className="pixel-panel w-full max-w-md p-5"
      >
        <SignInGate />
        <button
          type="button"
          onClick={onClose}
          className="pixel-chip mt-4 w-full bg-vellum py-2.5 font-mono text-[13px] uppercase tracking-wide text-ink-soft"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
