// Data and labels for the map's clustered venue pins. The map feeds venues to
// a Mapbox GeoJSON source with clustering on, then draws its own DOM markers
// for the clusters and single pins it reports (so every marker can be a real
// focusable button). These helpers are the parts that don't need a map.
import { plural, type SelectionLabel } from "./format";

export const VENUE_SOURCE_ID = "venues";
export const CLUSTER_RADIUS = 48;
/** Past this zoom every venue gets its own pin. */
export const CLUSTER_MAX_ZOOM = 15;

export interface VenuePoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface VenueFeatureProps {
  id: string;
  /** 1 when a deal is on at the selected time, else 0 (summed per cluster). */
  live: number;
}

/**
 * The clustered source's data. `excludeId` (the selected venue) is left out so
 * its pin is always drawn on its own and never swallowed into a cluster.
 */
export function venuesToFeatureCollection(
  venues: VenuePoint[],
  liveVenueIds: Set<string>,
  excludeId: string | null,
): GeoJSON.FeatureCollection<GeoJSON.Point, VenueFeatureProps> {
  return {
    type: "FeatureCollection",
    features: venues
      .filter((v) => v.id !== excludeId)
      .map((v) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [v.lng, v.lat] },
        properties: { id: v.id, live: liveVenueIds.has(v.id) ? 1 : 0 },
      })),
  };
}

/** Mapbox clusterProperties: count the live venues inside each cluster. */
export const CLUSTER_PROPERTIES = { live: ["+", ["get", "live"]] } as const;

/** "12 venues, 3 with deals on now. Zoom in" — the cluster button's name. */
export function clusterLabel(count: number, live: number, selection: SelectionLabel): string {
  const status =
    live > 0 ? `${live} with ${live === 1 ? "a deal" : "deals"} on ${selection.phrase}` : `none with a deal on ${selection.phrase}`;
  return `${plural(count, "venue")}, ${status}. Zoom in`;
}

/** "Ezra Pound, 2 deals on now" / "Ezra Pound, no deal on now" — a pin's name. */
export function pinLabel(name: string, liveCount: number, selection: SelectionLabel): string {
  return liveCount > 0
    ? `${name}, ${plural(liveCount, "deal")} on ${selection.phrase}`
    : `${name}, no deal on ${selection.phrase}`;
}

/** Short text inside a cluster bubble: "8", "99+". */
export function clusterText(count: number): string {
  return count > 99 ? "99+" : String(count);
}
