// Data and labels for the map's clustered venue pins. The map feeds venues to
// a Mapbox GeoJSON source with clustering on, then draws its own DOM markers
// for the clusters and single pins it reports (so every marker can be a real
// focusable button). These helpers are the parts that don't need a map.
import type { FeatureCollection, Point } from "geojson";
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
): FeatureCollection<Point, VenueFeatureProps> {
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

type LngLat = [number, number];

/** A feature as querySourceFeatures returns it (only the parts used here). */
export interface SourceFeatureLike {
  geometry: { type: string; coordinates?: unknown };
  properties: Record<string, unknown> | null;
}

export interface MarkerItems {
  pins: { key: string; lngLat: LngLat }[];
  clusters: { key: number; lngLat: LngLat }[];
  clusterCounts: Map<number, { count: number; live: number }>;
}

/**
 * The pins and cluster bubbles to show for what the clustered source reports.
 * Every cluster stays while a venue is selected; the selected venue (kept out
 * of the source by venuesToFeatureCollection) is added as its own pin, last,
 * so it is drawn whether or not its neighbours are clustered.
 */
export function markerItems(
  features: Iterable<SourceFeatureLike>,
  venueById: Map<string, VenuePoint>,
  selectedId: string | null,
): MarkerItems {
  const pins: MarkerItems["pins"] = [];
  const clusters: MarkerItems["clusters"] = [];
  const clusterCounts: MarkerItems["clusterCounts"] = new Map();
  for (const f of features) {
    const p = f.properties;
    if (!p || f.geometry.type !== "Point") continue;
    if (p.cluster) {
      const id = p.cluster_id as number;
      if (clusterCounts.has(id)) continue; // the same cluster in two tiles
      clusterCounts.set(id, { count: p.point_count as number, live: (p.live as number) ?? 0 });
      clusters.push({ key: id, lngLat: f.geometry.coordinates as LngLat });
    } else {
      const venue = venueById.get(p.id as string);
      // A venue's pin sits at its own coordinates, not the tile-rounded ones.
      if (venue && venue.id !== selectedId) pins.push({ key: venue.id, lngLat: [venue.lng, venue.lat] });
    }
  }
  const sel = selectedId ? venueById.get(selectedId) : undefined;
  if (sel) pins.push({ key: sel.id, lngLat: [sel.lng, sel.lat] });
  return { pins, clusters, clusterCounts };
}

/**
 * Marker stacking (CSS z-index on the marker element). Pins: plain 1, live 2,
 * selected 3. Cluster bubbles sit above every pin, so a count is never hidden
 * behind a pin; the selected venue is left out of the clusters, so its pin
 * often sits right next to one. The selected pin's ring still shows around a
 * bubble's edge, and a live bubble stays above a plain one.
 */
export function pinZIndex(isLive: boolean, isSelected: boolean): number {
  return isSelected ? 3 : isLive ? 2 : 1;
}

export function clusterZIndex(live: number): number {
  return live > 0 ? 5 : 4;
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
