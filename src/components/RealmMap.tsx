"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Polygon, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { HOUSE_BY_ID, REALM_CENTER, REALM_ZOOM } from "@/lib/data";
import { fiefBoundary, fiefIdForCoords } from "@/lib/geo";
import { fiefControl, scoreBand, throneScore } from "@/lib/selectors";
import { useNow } from "@/lib/useNow";
import type { InfluenceEvent, Throne } from "@/lib/types";

const SCORE_BAND_VAR: Record<string, string> = {
  high: "var(--emerald)",
  mid: "var(--brass)",
  low: "var(--crimson)",
  unrated: "var(--ink-faint)",
};

function throneIcon(band: string, selected: boolean, status: Throne["status"]) {
  const color = SCORE_BAND_VAR[band];
  const size = selected ? 26 : 20;
  const dashed = status === "rumored" ? "border-style:dashed;" : "";
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:2px solid var(--vellum-raised);${dashed}box-shadow:0 0 0 1px ${color}${selected ? ",0 0 10px 2px " + color : ""};"></span>`,
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
  active,
  onClick,
}: {
  active: boolean;
  onClick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      if (active) onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function FiefLayer({
  thrones,
  influenceEvents,
}: {
  thrones: Throne[];
  influenceEvents: InfluenceEvent[];
}) {
  const now = useNow();
  const fiefIds = useMemo(
    () => [...new Set(thrones.map((t) => fiefIdForCoords(t.lat, t.lng)))],
    [thrones]
  );

  return (
    <>
      {fiefIds.map((fiefId) => {
        const control = fiefControl(fiefId, influenceEvents, now);
        if (!control.leader) return null;
        const color = HOUSE_BY_ID[control.leader.houseId].colorVar;
        return (
          <Polygon
            key={fiefId}
            positions={fiefBoundary(fiefId)}
            pathOptions={{
              color: control.contested ? "var(--crimson)" : color,
              weight: control.contested ? 2 : 1,
              fillColor: color,
              fillOpacity: 0.22 + control.leader.share * 0.28,
              dashArray: control.contested ? "4 4" : undefined,
            }}
          />
        );
      })}
    </>
  );
}

export interface RealmMapProps {
  thrones: Throne[];
  ratings: import("@/lib/types").Rating[];
  influenceEvents: InfluenceEvent[];
  selectedThroneId: string | null;
  onSelectThrone: (id: string) => void;
  addMode: boolean;
  onMapClick: (lat: number, lng: number) => void;
  flyTarget: [number, number] | null;
}

export default function RealmMap({
  thrones,
  ratings,
  influenceEvents,
  selectedThroneId,
  onSelectThrone,
  addMode,
  onMapClick,
  flyTarget,
}: RealmMapProps) {
  const now = useNow();
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
      <FiefLayer thrones={thrones} influenceEvents={influenceEvents} />
      {thrones.map((t) => {
        const { score } = throneScore(t.id, ratings, now);
        const band = scoreBand(score);
        return (
          <Marker
            key={t.id}
            position={[t.lat, t.lng]}
            icon={throneIcon(band, t.id === selectedThroneId, t.status)}
            eventHandlers={{ click: () => onSelectThrone(t.id) }}
          />
        );
      })}
      <ClickHandler active={addMode} onClick={onMapClick} />
      <FlyToController target={flyTarget} />
    </MapContainer>
  );
}
