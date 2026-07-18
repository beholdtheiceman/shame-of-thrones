import { cellToBoundary, cellToLatLng, latLngToCell } from "h3-js";

// Resolution 7 (~1-2km edge) — the PRD target for full-city coverage.
// Fiefs are computed from H3, not stored, so this constant alone tunes
// fief granularity. (Was res-9 for the single-neighborhood demo seed.)
export const FIEF_RESOLUTION = 7;

export function fiefIdForCoords(lat: number, lng: number): string {
  return latLngToCell(lat, lng, FIEF_RESOLUTION);
}

/** Returns [lat, lng] pairs for react-leaflet Polygon `positions`. */
export function fiefBoundary(fiefId: string): [number, number][] {
  return cellToBoundary(fiefId) as [number, number][];
}

export function fiefCenter(fiefId: string): [number, number] {
  return cellToLatLng(fiefId) as [number, number];
}

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
