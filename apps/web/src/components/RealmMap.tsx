"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Polygon, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { HOUSE_BY_ID, REALM_CENTER, REALM_ZOOM } from "@sot/core";
import { fiefBoundary } from "@sot/core";
import { scoreBand, type FiefControl } from "@sot/core";
import type { ThroneDTO } from "@/lib/api";

const SCORE_BAND_VAR: Record<string, string> = {
  high: "var(--emerald)",
  mid: "var(--brass)",
  low: "var(--crimson)",
  unrated: "var(--ink-faint)",
};

function throneIcon(band: string, selected: boolean, status: ThroneDTO["status"]) {
  const color = SCORE_BAND_VAR[band];
  const size = selected ? 22 : 16;
  const dashed = status === "rumored" ? "border-style:dashed;" : "";
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<span style="display:block;width:${size}px;height:${size}px;background:${color};border:2px solid var(--vellum-line);${dashed}box-shadow:2px 2px 0 0 rgba(0,0,0,0.5)${selected ? ",0 0 0 2px var(--brass)" : ""};"></span>`,
  });
}

function FlyToController({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, 17, { duration: 0.8 });
  }, [target, map]);
  return null;
}

function ClickHandler({
  addMode,
  onAddClick,
  onBackgroundClick,
}: {
  addMode: boolean;
  onAddClick: (lat: number, lng: number) => void;
  onBackgroundClick: () => void;
}) {
  useMapEvents({
    click(e) {
      if (addMode) onAddClick(e.latlng.lat, e.latlng.lng);
      else onBackgroundClick();
    },
  });
  return null;
}

function FiefLayer({
  thrones,
  fiefs,
  addMode,
  onSelectFief,
}: {
  thrones: ThroneDTO[];
  fiefs: FiefControl[];
  addMode: boolean;
  onSelectFief: (fiefId: string) => void;
}) {
  const fiefIds = useMemo(
    () => [...new Set(thrones.map((t) => t.fiefId))],
    [thrones]
  );

  return (
    <>
      {fiefIds.map((fiefId) => {
        const control = fiefs.find((fief) => fief.fiefId === fiefId);
        if (!control) return null;
        if (!control.leader) return null;
        const color = HOUSE_BY_ID[control.leader.houseId].colorVar;
        return (
          <Polygon
            key={fiefId}
            positions={fiefBoundary(fiefId)}
            pathOptions={{
              color: control.contested ? "var(--crimson)" : "var(--vellum-line)",
              weight: control.contested ? 3 : 2,
              fillColor: color,
              fillOpacity: 0.3 + control.leader.share * 0.3,
              dashArray: control.contested ? "6 4" : undefined,
            }}
            eventHandlers={{
              click: (e) => {
                if (addMode) return;
                // Leaflet's stop helper is required because native stopPropagation runs too late for its internal dispatch.
                L.DomEvent.stopPropagation(e);
                onSelectFief(fiefId);
              },
            }}
          />
        );
      })}
    </>
  );
}

export interface RealmMapProps {
  thrones: ThroneDTO[];
  fiefs: FiefControl[];
  selectedThroneId: string | null;
  onSelectThrone: (id: string) => void;
  onSelectFief: (fiefId: string) => void;
  onBackgroundClick: () => void;
  addMode: boolean;
  onMapClick: (lat: number, lng: number) => void;
  flyTarget: [number, number] | null;
}

export default function RealmMap({
  thrones,
  fiefs,
  selectedThroneId,
  onSelectThrone,
  onSelectFief,
  onBackgroundClick,
  addMode,
  onMapClick,
  flyTarget,
}: RealmMapProps) {
  return (
    <MapContainer
      center={REALM_CENTER}
      zoom={REALM_ZOOM}
      scrollWheelZoom
      zoomControl={false}
      className="h-full w-full"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FiefLayer thrones={thrones} fiefs={fiefs} addMode={addMode} onSelectFief={onSelectFief} />
      {thrones.map((t) => {
        const band = scoreBand(t.score);
        return (
          <Marker
            key={t.id}
            position={[t.lat, t.lng]}
            icon={throneIcon(band, t.id === selectedThroneId, t.status)}
            title={t.name}
            alt={t.name}
            eventHandlers={{ click: () => onSelectThrone(t.id) }}
          />
        );
      })}
      <ClickHandler addMode={addMode} onAddClick={onMapClick} onBackgroundClick={onBackgroundClick} />
      <FlyToController target={flyTarget} />
    </MapContainer>
  );
}
