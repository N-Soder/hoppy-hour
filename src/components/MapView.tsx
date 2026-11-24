import { useEffect, useRef, useCallback, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Locate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "next-themes";
import type { VenueWithHappyHours } from "@/hooks/use-venues";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { prefersReducedMotion } from "@/lib/motion";
import type { SelectionLabel } from "@/lib/format";
import {
  CLUSTER_MAX_ZOOM,
  CLUSTER_PROPERTIES,
  CLUSTER_RADIUS,
  VENUE_SOURCE_ID,
  clusterLabel,
  clusterText,
  pinLabel,
  venuesToFeatureCollection,
} from "@/lib/map-clusters";
import { MapMessage } from "@/components/MapMessage";

/** Mapbox error events carry the failed request's HTTP status when there is one. */
type MapErrorEvent = { error?: { status?: number; message?: string }; sourceId?: string };

const flyDuration = () => (prefersReducedMotion() ? 0 : 1200);
const panDuration = () => (prefersReducedMotion() ? 0 : 400);

// An invisible layer on the clustered source: Mapbox only loads a source's
// tiles (which querySourceFeatures reads) while some layer uses it. The pins
// and clusters themselves are DOM markers so each can be a focusable button.
const HIDDEN_LAYER_ID = "venues-hidden";

interface MapViewProps {
  token: string;
  lng: number;
  lat: number;
  venues: VenueWithHappyHours[];
  liveVenueIds: Set<string>;
  liveVenueCounts: Map<string, number>;
  selectedVenueId: string | null;
  selection: SelectionLabel;
  onSelectVenue: (id: string) => void;
  /** A click on the map itself (not a pin or cluster). */
  onBackgroundClick?: () => void;
  onBoundsChange: (bounds: { lng: number; lat: number }) => void;
  /** The user's real location. Leave null when it is unknown (fallback centre). */
  userLng?: number | null;
  userLat?: number | null;
  onRecenter?: () => void;
  onDragStart?: () => void;
  /** Pixels at the bottom covered by a sheet; the selected pin is kept above them. */
  bottomInset?: number;
}

interface PinColours {
  bg: string;
  border: string;
  text: string;
}

function pinColours(isLive: boolean, isSelected: boolean, isDark: boolean): PinColours {
  // Live fills are dark enough for white text in light mode (≥4.5:1) and
  // light enough for near-black text in dark mode.
  const bg = isLive
    ? isSelected
      ? isDark ? "hsl(31, 82%, 64%)" : "hsl(29, 87%, 30%)"
      : isDark ? "hsl(31, 82%, 56%)" : "hsl(29, 87%, 38%)"
    : isDark ? "hsl(20, 8%, 46%)" : "hsl(0, 0%, 66%)";
  // Selected ring must contrast with the map tiles: near-black on the light
  // style, warm white on the dark style.
  const border = isSelected
    ? `3px solid ${isDark ? "hsl(40, 20%, 95%)" : "hsl(20, 20%, 10%)"}`
    : isLive
      ? `3px solid ${isDark ? "hsl(20, 15%, 12%)" : "white"}`
      : `2px solid ${isDark ? "hsl(20, 8%, 62%)" : "hsl(0, 0%, 52%)"}`;
  const text = isLive ? (isDark ? "hsl(24, 76%, 8%)" : "white") : isDark ? "hsl(0, 0%, 90%)" : "hsl(0, 0%, 20%)";
  return { bg, border, text };
}

function baseMarkerElement(className: string): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = className;
  Object.assign(el.style, {
    padding: "0",
    borderRadius: "9999px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: "700",
    lineHeight: "1",
    fontFamily: "inherit",
    transition: "width 0.15s ease, height 0.15s ease, background 0.15s ease",
  } satisfies Partial<CSSStyleDeclaration>);
  return el;
}

export default function MapView({
  token,
  lng,
  lat,
  venues,
  liveVenueIds,
  liveVenueCounts,
  selectedVenueId,
  selection,
  onSelectVenue,
  onBackgroundClick,
  onBoundsChange,
  userLng,
  userLat,
  onRecenter,
  onDragStart,
  bottomInset = 0,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const activeStyleRef = useRef<string>("");
  const { resolvedTheme } = useTheme();
  const isOnline = useOnlineStatus();
  const [mapError, setMapError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Everything the marker renderer reads, kept in refs so the map's render
  // handler (registered once per map) always sees the latest props.
  const pinsRef = useRef(new Map<string, { marker: mapboxgl.Marker; el: HTMLButtonElement }>());
  const clustersRef = useRef(new Map<number, { marker: mapboxgl.Marker; el: HTMLButtonElement }>());
  const latest = useRef({ venues, liveVenueIds, liveVenueCounts, selectedVenueId, selection, onSelectVenue, isDark: resolvedTheme === "dark" });
  latest.current = { venues, liveVenueIds, liveVenueCounts, selectedVenueId, selection, onSelectVenue, isDark: resolvedTheme === "dark" };
  const venueById = useRef(new Map<string, VenueWithHappyHours>());
  venueById.current = new Map(venues.map((v) => [v.id, v]));
  const onBackgroundClickRef = useRef(onBackgroundClick);
  onBackgroundClickRef.current = onBackgroundClick;

  const styleForTheme = (theme: string | undefined) =>
    theme === "dark" ? "mapbox://styles/mapbox/dark-v11" : "mapbox://styles/mapbox/light-v11";

  /** Create or update the DOM pin for one venue. */
  const upsertPin = useCallback((map: mapboxgl.Map, venue: VenueWithHappyHours) => {
    const { liveVenueIds: live, liveVenueCounts: counts, selectedVenueId: sel, selection: s, isDark } = latest.current;
    const isLive = live.has(venue.id);
    const isSelected = venue.id === sel;
    const count = counts.get(venue.id) ?? 0;
    const label = pinLabel(venue.name, count, s);
    const sig = `${isLive}|${isSelected}|${count}|${isDark}|${label}`;
    let entry = pinsRef.current.get(venue.id);
    if (!entry) {
      const el = baseMarkerElement("venue-pin");
      el.dataset.venuePin = venue.id;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        latest.current.onSelectVenue(venue.id);
      });
      const marker = new mapboxgl.Marker({ element: el }).setLngLat([venue.lng, venue.lat]);
      entry = { marker, el };
      pinsRef.current.set(venue.id, entry);
    }
    const { el, marker } = entry;
    marker.setLngLat([venue.lng, venue.lat]);
    if (!marker.getElement().isConnected) marker.addTo(map);
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    const c = pinColours(isLive, isSelected, isDark);
    const size = isSelected ? 36 : isLive ? 28 : 18;
    Object.assign(el.style, {
      width: `${size}px`,
      height: `${size}px`,
      background: c.bg,
      border: c.border,
      color: c.text,
      fontSize: isLive ? "12px" : "10px",
      boxShadow: isLive || isSelected ? "0 2px 8px rgba(0,0,0,0.25)" : "0 1px 4px rgba(0,0,0,0.12)",
      opacity: isLive || isSelected ? "1" : "0.75",
      zIndex: isSelected ? "3" : isLive ? "2" : "1",
    } satisfies Partial<CSSStyleDeclaration>);
    el.textContent = count > 0 ? String(count) : "";
    el.setAttribute("aria-label", label);
    el.setAttribute("aria-pressed", String(isSelected));
  }, []);

  /** Create or update the DOM bubble for one cluster. */
  const upsertCluster = useCallback(
    (map: mapboxgl.Map, id: number, coords: [number, number], count: number, live: number) => {
      const { selection: s, isDark } = latest.current;
      let entry = clustersRef.current.get(id);
      if (!entry) {
        const el = baseMarkerElement("venue-cluster");
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          const source = map.getSource(VENUE_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
          const at = clustersRef.current.get(id)?.marker.getLngLat();
          source?.getClusterExpansionZoom(id, (err, zoom) => {
            if (err || zoom == null || !at) return;
            map.easeTo({ center: at, zoom: zoom + 0.25, duration: panDuration() });
          });
        });
        const pip = document.createElement("span");
        pip.className = "venue-cluster-pip";
        pip.setAttribute("aria-hidden", "true");
        el.appendChild(document.createElement("span"));
        el.appendChild(pip);
        const marker = new mapboxgl.Marker({ element: el }).setLngLat(coords);
        entry = { marker, el };
        clustersRef.current.set(id, entry);
      }
      const { el, marker } = entry;
      marker.setLngLat(coords);
      if (!marker.getElement().isConnected) marker.addTo(map);
      const label = clusterLabel(count, live, s);
      const sig = `${count}|${live}|${isDark}|${label}`;
      if (el.dataset.sig === sig) return;
      el.dataset.sig = sig;
      const size = count < 10 ? 34 : count < 50 ? 40 : 46;
      const liveC = pinColours(true, false, isDark);
      Object.assign(el.style, {
        width: `${size}px`,
        height: `${size}px`,
        background: live > 0 ? (isDark ? "hsl(25, 21%, 14%)" : "white") : isDark ? "hsl(20, 8%, 30%)" : "hsl(0, 0%, 88%)",
        border: live > 0 ? `3px solid ${liveC.bg}` : `2px solid ${isDark ? "hsl(20, 8%, 55%)" : "hsl(0, 0%, 55%)"}`,
        color: isDark ? "hsl(34, 43%, 90%)" : "hsl(33, 34%, 13%)",
        fontSize: "13px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
        zIndex: live > 0 ? "2" : "1",
      } satisfies Partial<CSSStyleDeclaration>);
      (el.firstChild as HTMLElement).textContent = clusterText(count);
      const pip = el.lastChild as HTMLElement;
      pip.textContent = live > 0 ? clusterText(live) : "";
      pip.style.display = live > 0 ? "flex" : "none";
      pip.style.background = liveC.bg;
      pip.style.color = liveC.text;
      el.setAttribute("aria-label", label);
    },
    [],
  );

  /** Draw the markers for whatever the clustered source currently shows. */
  const renderMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.getSource(VENUE_SOURCE_ID) || !map.isSourceLoaded(VENUE_SOURCE_ID)) return;
    const features = map.querySourceFeatures(VENUE_SOURCE_ID);
    const pinIds = new Set<string>();
    const clusterIds = new Set<number>();
    for (const f of features) {
      const p = f.properties as Record<string, unknown> | null;
      if (!p || f.geometry.type !== "Point") continue;
      const coords = f.geometry.coordinates as [number, number];
      if (p.cluster) {
        const id = p.cluster_id as number;
        if (clusterIds.has(id)) continue;
        clusterIds.add(id);
        upsertCluster(map, id, coords, p.point_count as number, (p.live as number) ?? 0);
      } else {
        const id = p.id as string;
        const venue = venueById.current.get(id);
        if (!venue || pinIds.has(id)) continue;
        pinIds.add(id);
        upsertPin(map, venue);
      }
    }
    // The selected venue is kept out of the clustered source: always its own pin.
    const sel = latest.current.selectedVenueId;
    const selVenue = sel ? venueById.current.get(sel) : undefined;
    if (selVenue) {
      pinIds.add(selVenue.id);
      upsertPin(map, selVenue);
    }
    for (const [id, { marker }] of pinsRef.current) {
      if (!pinIds.has(id)) {
        marker.remove();
        if (!venueById.current.has(id)) pinsRef.current.delete(id);
      }
    }
    for (const [id, { marker }] of clustersRef.current) {
      if (!clusterIds.has(id)) {
        marker.remove();
        clustersRef.current.delete(id);
      }
    }
  }, [upsertCluster, upsertPin]);

  const sourceData = useCallback(
    () => venuesToFeatureCollection(latest.current.venues, latest.current.liveVenueIds, latest.current.selectedVenueId),
    [],
  );

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = token;
    const initialStyle = styleForTheme(resolvedTheme);
    activeStyleRef.current = initialStyle;
    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: initialStyle,
        center: [lng, lat],
        zoom: 12,
        attributionControl: false,
        // North stays up: no rotation or tilt by mouse, touch or keyboard, so
        // there is never a rotated map to reset.
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
    } catch (err) {
      console.error("[map] init failed", err);
      setMapError("This browser can't display the map.");
      return;
    }
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    let loaded = false;
    map.on("load", () => {
      loaded = true;
    });
    map.on("error", (e: MapErrorEvent) => {
      const status = e.error?.status;
      console.warn("[map] error", status ?? "", e.error?.message ?? e);
      if (status === 401 || status === 403) {
        setMapError("The map service turned down this site's access token.");
      } else if (!loaded && !e.sourceId) {
        setMapError("The map couldn't load.");
      }
    });
    // Every style load (the first, and each light/dark switch) starts empty:
    // add the clustered venue source again.
    map.on("style.load", () => {
      if (map.getSource(VENUE_SOURCE_ID)) return;
      map.addSource(VENUE_SOURCE_ID, {
        type: "geojson",
        data: sourceData(),
        cluster: true,
        clusterRadius: CLUSTER_RADIUS,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterProperties: CLUSTER_PROPERTIES as unknown as Record<string, unknown>,
      });
      map.addLayer({
        id: HIDDEN_LAYER_ID,
        type: "circle",
        source: VENUE_SOURCE_ID,
        paint: { "circle-radius": 0, "circle-opacity": 0, "circle-stroke-opacity": 0 },
      });
    });
    map.on("render", renderMarkers);
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-left");
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.on("moveend", () => {
      const center = map.getCenter();
      onBoundsChange({ lng: center.lng, lat: center.lat });
    });
    map.on("click", () => onBackgroundClickRef.current?.());
    mapRef.current = map;

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    const pins = pinsRef.current;
    const clusters = clustersRef.current;
    return () => {
      ro.disconnect();
      pins.forEach(({ marker }) => marker.remove());
      clusters.forEach(({ marker }) => marker.remove());
      pins.clear();
      clusters.clear();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, attempt]);

  const retryMap = useCallback(() => {
    setMapError(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!isOnline) return;
    if (mapError) retryMap();
    else mapRef.current?.triggerRepaint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const nextStyle = styleForTheme(resolvedTheme);
    if (nextStyle === activeStyleRef.current) return;
    activeStyleRef.current = nextStyle;
    map.setStyle(nextStyle);
  }, [resolvedTheme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !onDragStart) return;
    map.on("dragstart", onDragStart);
    return () => { map.off("dragstart", onDragStart); };
  }, [onDragStart, attempt]);

  useEffect(() => {
    if (mapRef.current && lng && lat) {
      mapRef.current.flyTo({ center: [lng, lat], zoom: 13, duration: flyDuration() });
    }
  }, [lng, lat]);

  // New venues, liveness, selection or theme: refresh the source and markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource(VENUE_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    source?.setData(sourceData());
    renderMarkers();
    map.triggerRepaint();
  }, [venues, liveVenueIds, liveVenueCounts, selectedVenueId, selection, resolvedTheme, attempt, sourceData, renderMarkers]);

  // Keep the selected pin in view, above any sheet covering the bottom. Runs
  // once per selection/inset (not on every data refresh), after any camera
  // move in progress — e.g. the initial fly-in when a venue link loads.
  const pannedFor = useRef<string | null>(null);
  const selectedVenue = selectedVenueId ? venues.find((v) => v.id === selectedVenueId) : undefined;
  useEffect(() => {
    const map = mapRef.current;
    if (!selectedVenueId) pannedFor.current = null;
    if (!map || !selectedVenue) return;
    const key = `${selectedVenue.id}|${bottomInset}|${attempt}`;
    if (pannedFor.current === key) return;
    pannedFor.current = key;
    const run = () => {
      const { clientWidth: w, clientHeight: h } = map.getContainer();
      if (w === 0 || h === 0) return;
      const p = map.project([selectedVenue.lng, selectedVenue.lat]);
      const top = 72;
      const bottom = h - bottomInset - 32;
      if (p.x >= 32 && p.x <= w - 32 && p.y >= top && p.y <= bottom) return;
      const targetY = Math.max(top, (top + bottom) / 2);
      map.panBy([p.x - w / 2, p.y - targetY], { duration: panDuration() });
    };
    // Not gated on map.loaded(): that stays false while any tile is pending.
    if (map.isMoving()) map.once("moveend", run);
    else run();
  }, [selectedVenueId, selectedVenue, bottomInset, attempt]);

  // User location marker. Only drawn for a real position.
  useEffect(() => {
    if (!mapRef.current) return;
    userMarkerRef.current?.remove();
    userMarkerRef.current = null;
    if (userLng == null || userLat == null || mapError) return;

    const el = document.createElement("div");
    el.style.cssText = `width: 18px; height: 18px; position: relative; pointer-events: none;`;
    const dot = document.createElement("div");
    dot.style.cssText = `
      width: 12px; height: 12px; background: #22c55e; border: 2px solid white;
      border-radius: 50%; position: absolute; top: 3px; left: 3px; z-index: 2;
      box-shadow: 0 0 6px rgba(34,197,94,0.6);
    `;
    const ring = document.createElement("div");
    ring.style.cssText = `
      width: 18px; height: 18px; background: rgba(34,197,94,0.3); border-radius: 50%;
      position: absolute; top: 0; left: 0; animation: user-loc-pulse 2s ease-out infinite;
    `;
    el.appendChild(ring);
    el.appendChild(dot);
    if (!document.getElementById("user-loc-pulse-style")) {
      const style = document.createElement("style");
      style.id = "user-loc-pulse-style";
      style.textContent = `@keyframes user-loc-pulse { 0% { transform: scale(1); opacity: 1; } 100% { transform: scale(2.5); opacity: 0; } }`;
      document.head.appendChild(style);
    }
    const marker = new mapboxgl.Marker({ element: el }).setLngLat([userLng, userLat]).addTo(mapRef.current!);
    userMarkerRef.current = marker;
    return () => {
      marker.remove();
      userMarkerRef.current = null;
    };
  }, [userLng, userLat, attempt, mapError]);

  const handleRecenter = () => {
    if (mapRef.current && userLng != null && userLat != null) {
      mapRef.current.flyTo({ center: [userLng, userLat], zoom: 13, duration: flyDuration() });
    }
    onRecenter?.();
  };

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {!isOnline ? (
        <MapMessage
          overlay
          kind="offline"
          title="You're offline"
          detail="The map will refresh when your connection is back. Venues already loaded are still in the list."
        />
      ) : mapError ? (
        <MapMessage overlay kind="error" title={mapError} detail="The venue list still works." onRetry={retryMap} />
      ) : null}
      {userLng != null && userLat != null && onRecenter && !mapError && (
        <Button
          size="icon"
          variant="secondary"
          className="absolute top-4 left-4 z-10 shadow-lg h-10 w-10"
          onClick={handleRecenter}
          aria-label="Back to my location"
          title="Back to my location"
        >
          <Locate className="h-5 w-5" />
        </Button>
      )}
    </div>
  );
}
