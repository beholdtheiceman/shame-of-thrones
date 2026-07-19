import { useCallback, useMemo, useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Mapbox, { Camera, FillLayer, LineLayer, MapView, MarkerView, ShapeSource, type MapState } from "@rnmapbox/maps";
import { fiefBoundary, HOUSE_BY_ID, REALM_CENTER, REALM_ZOOM, scoreBand, type FiefControl } from "@sot/core";
import type { ThroneDTO } from "../lib/api";
import { COLORS, HOUSE_COLOR, SCORE_BAND_COLOR } from "../lib/theme";

// Owner dep: without EXPO_PUBLIC_MAPBOX_TOKEN the map style will not load
// (renders blank) — token/style are device-QA concerns, not build blockers.
Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "");

const STYLE_URL = process.env.EXPO_PUBLIC_MAPBOX_STYLE_URL ?? "mapbox://styles/mapbox/dark-v11";

/** core's fiefBoundary()/REALM_CENTER are [lat, lng] (leaflet convention);
 * Mapbox GeoJSON positions are [lng, lat]. */
function toLngLat([lat, lng]: [number, number]): [number, number] {
  return [lng, lat];
}

function closedRing(points: [number, number][]): [number, number][] {
  if (points.length === 0) return points;
  const first = points[0];
  const last = points[points.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? points : [...points, first];
}

export interface RealmMapProps {
  thrones: ThroneDTO[];
  fiefs: FiefControl[];
  selectedThroneId: string | null;
  onSelectThrone: (id: string) => void;
  onSelectFief: (fiefId: string) => void;
  onBackgroundClick: () => void;
  onCenterChange: (center: { lat: number; lng: number }) => void;
}

function ThroneMarker({
  throne,
  selected,
  onPress,
}: {
  throne: ThroneDTO;
  selected: boolean;
  onPress: () => void;
}) {
  const band = scoreBand(throne.score);
  const size = selected ? 22 : 16;
  return (
    <MarkerView coordinate={[throne.lng, throne.lat]} anchor={{ x: 0.5, y: 0.5 }}>
      <Pressable onPress={onPress} hitSlop={12}>
        <View
          style={[
            styles.markerDot,
            {
              width: size,
              height: size,
              backgroundColor: SCORE_BAND_COLOR[band],
              borderStyle: throne.status === "rumored" ? "dashed" : "solid",
            },
            selected && styles.markerSelected,
          ]}
        />
      </Pressable>
    </MarkerView>
  );
}

// One ShapeSource per fief (mirrors the web FiefLayer's one-<Polygon>-per-fief
// structure) rather than a single merged FeatureCollection — this keeps
// per-fief onPress trivial instead of needing feature-property style
// expressions for a data-driven fill color.
function FiefPolygon({
  fiefId,
  control,
  onPress,
}: {
  fiefId: string;
  control: FiefControl | undefined;
  onPress: () => void;
}) {
  if (!control || !control.leader) return null;
  const color = HOUSE_COLOR[control.leader.houseId] ?? COLORS.inkFaint;
  const ring = closedRing(fiefBoundary(fiefId).map(toLngLat));
  const sourceId = `fief-${fiefId}`;

  return (
    <ShapeSource
      id={sourceId}
      shape={{ type: "Polygon", coordinates: [ring] }}
      onPress={onPress}
    >
      <FillLayer
        id={`${sourceId}-fill`}
        style={{
          fillColor: color,
          fillOpacity: 0.3 + control.leader.share * 0.3,
        }}
      />
      <LineLayer
        id={`${sourceId}-line`}
        style={{
          lineColor: control.contested ? COLORS.crimson : COLORS.vellumLine,
          lineWidth: control.contested ? 3 : 2,
          lineDasharray: control.contested ? [6, 4] : undefined,
        }}
      />
    </ShapeSource>
  );
}

export default function RealmMap({
  thrones,
  fiefs,
  selectedThroneId,
  onSelectThrone,
  onSelectFief,
  onBackgroundClick,
  onCenterChange,
}: RealmMapProps) {
  // Guards against a fief ShapeSource tap also being read as an empty-map
  // background tap (the native equivalent of leaflet's L.DomEvent.stopPropagation).
  const lastFeatureTapAt = useRef(0);

  const fiefIds = useMemo(() => [...new Set(thrones.map((t) => t.fiefId))], [thrones]);

  const handleFiefPress = useCallback(
    (fiefId: string) => {
      lastFeatureTapAt.current = Date.now();
      onSelectFief(fiefId);
    },
    [onSelectFief]
  );

  const handleThronePress = useCallback(
    (id: string) => {
      // Same guard as fiefs: a MarkerView tap can also register as a map
      // background tap on iOS, which would immediately deselect the throne
      // (so it "opens then closes" and needs several taps). Stamp the tap so
      // the trailing handleMapPress background press is ignored.
      lastFeatureTapAt.current = Date.now();
      onSelectThrone(id);
    },
    [onSelectThrone]
  );

  const handleMapPress = useCallback(() => {
    if (Date.now() - lastFeatureTapAt.current < 150) return;
    onBackgroundClick();
  }, [onBackgroundClick]);

  const handleMapIdle = useCallback(
    (state: MapState) => {
      const [lng, lat] = state.properties.center;
      onCenterChange({ lat, lng });
    },
    [onCenterChange]
  );

  return (
    <MapView style={styles.map} styleURL={STYLE_URL} onPress={handleMapPress} onMapIdle={handleMapIdle}>
      <Camera defaultSettings={{ centerCoordinate: toLngLat(REALM_CENTER), zoomLevel: REALM_ZOOM }} />
      {fiefIds.map((fiefId) => (
        <FiefPolygon
          key={fiefId}
          fiefId={fiefId}
          control={fiefs.find((f) => f.fiefId === fiefId)}
          onPress={() => handleFiefPress(fiefId)}
        />
      ))}
      {thrones.map((t) => (
        <ThroneMarker key={t.id} throne={t} selected={t.id === selectedThroneId} onPress={() => handleThronePress(t.id)} />
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
  markerDot: {
    borderWidth: 2,
    borderColor: COLORS.vellumLine,
  },
  markerSelected: {
    borderColor: COLORS.brass,
    borderWidth: 3,
  },
});
