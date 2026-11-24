import { useEffect, useRef, useCallback, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Locate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "next-themes";
import type { VenueWithHappyHours } from "@/hooks/use-venues";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { prefersReducedMotion } from "@/lib/motion";
import { plural } from "@/lib/format";
import { MapMessage } from "@/components/MapMessage";

/** Mapbox error events carry the failed request's HTTP status when there is one. */
type MapErrorEvent = { error?: { status?: number; message?: string }; sourceId?: string };

const flyDuration = () => (prefersReducedMotion() ? 0 : 1200);

interface MapViewProps {
  token: string;
  lng: number;
  lat: number;
  venues: VenueWithHappyHours[];
  liveVenueIds: Set<string>;
  liveVenueCounts: Map<string, number>;
  selectedVenueId: string | null;
  onSelectVenue: (id: string | null) => void;
  onBoundsChange: (bounds: { lng: number; lat: number }) => void;
  /** The user's real location. Leave null when it is unknown (fallback centre). */
  userLng?: number | null;
  userLat?: number | null;
  onRecenter?: () => void;
  onDragStart?: () => void;
}

export default function MapView({
  token,
  lng,
  lat,
  venues,
  liveVenueIds,
  liveVenueCounts,
  selectedVenueId,
  onSelectVenue,
  onBoundsChange,
  userLng,
  userLat,
  onRecenter,
  onDragStart,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const activeStyleRef = useRef<string>("");
  const { resolvedTheme } = useTheme();
  const isOnline = useOnlineStatus();
  // A fatal map failure (bad token, style that won't load, no WebGL). Tile
  // hiccups after the map has loaded are logged, not shown.
  const [mapError, setMapError] = useState<string | null>(null);
  // Bumped by Retry to tear the map down and build it again.
  const [attempt, setAttempt] = useState(0);

  const styleForTheme = (theme: string | undefined) =>
    theme === "dark"
      ? "mapbox://styles/mapbox/dark-v11"
      : "mapbox://styles/mapbox/light-v11";

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
      });
    } catch (err) {
      // Thrown synchronously when WebGL is unavailable.
      console.error("[map] init failed", err);
      setMapError("This browser can't display the map.");
      return;
    }
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
        // The style itself failed (network, bad URL): nothing will render.
        setMapError("The map couldn't load.");
      }
    });
    // Group the credits with the logo in the bottom-left corner, collapsed to
    // an "i" toggle — the bottom-right corner is reserved for the mobile FAB.
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-left");
    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.on("moveend", () => {
      const center = map.getCenter();
      onBoundsChange({ lng: center.lng, lat: center.lat });
    });
    mapRef.current = map;

    const ro = new ResizeObserver(() => {
      map.resize();
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, attempt]);

  const retryMap = useCallback(() => {
    setMapError(null);
    setAttempt((n) => n + 1);
  }, []);

  // Coming back online: rebuild a map that failed while offline, and ask a
  // working one to fetch the tiles it missed.
  useEffect(() => {
    if (!isOnline) return;
    if (mapError) retryMap();
    else mapRef.current?.triggerRepaint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  // Sync map style when dark/light theme changes.
  // Compare against activeStyleRef (not map.getStyle().name which returns a
  // display label, not the URL) to avoid double-setting on mount.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const nextStyle = styleForTheme(resolvedTheme);
    if (nextStyle === activeStyleRef.current) return;
    activeStyleRef.current = nextStyle;
    map.setStyle(nextStyle);
  }, [resolvedTheme]);

  // Drag-start — registered in its own effect so the current callback is always used
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !onDragStart) return;
    map.on("dragstart", onDragStart);
    return () => { map.off("dragstart", onDragStart); };
  }, [onDragStart, attempt]);

  // Fly to center
  useEffect(() => {
    if (mapRef.current && lng && lat) {
      mapRef.current.flyTo({ center: [lng, lat], zoom: 13, duration: flyDuration() });
    }
  }, [lng, lat]);

  // Update markers
  const updateMarkers = useCallback(() => {
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    if (!mapRef.current) return;

    const isDark = resolvedTheme === "dark";

    venues.forEach((venue) => {
      const el = document.createElement("div");
      el.className = "venue-marker";
      const isSelected = venue.id === selectedVenueId;
      const isLive = liveVenueIds.has(venue.id);
      const count = liveVenueCounts.get(venue.id) ?? 0;

      const size = isSelected ? "36px" : isLive ? "28px" : "18px";
      const zIndex = isSelected ? "3" : isLive ? "2" : "1";
      // Live fills are dark enough for white text in light mode (≥4.5:1) and
      // light enough for near-black text in dark mode.
      const bg = isLive
        ? isSelected
          ? isDark ? "hsl(31, 82%, 64%)" : "hsl(29, 87%, 30%)"
          : isDark ? "hsl(31, 82%, 56%)" : "hsl(29, 87%, 38%)"
        : isDark ? "hsl(20, 8%, 38%)" : "hsl(0, 0%, 72%)";
      // Selected ring must contrast with the map tiles: near-black on the
      // light style, warm white on the dark style.
      const border = isSelected
        ? `3px solid ${isDark ? "hsl(40, 20%, 95%)" : "hsl(20, 20%, 10%)"}`
        : isLive
          ? `3px solid ${isDark ? "hsl(20, 15%, 12%)" : "white"}`
          : `2px solid ${isDark ? "hsl(20, 8%, 55%)" : "hsl(0, 0%, 58%)"}`;

      el.style.cssText = `
        width: ${size};
        height: ${size};
        border-radius: 50%;
        background: ${bg};
        border: ${border};
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: ${isLive ? (isDark ? "hsl(24, 76%, 8%)" : "white") : isDark ? "hsl(0, 0%, 75%)" : "hsl(0, 0%, 40%)"};
        font-weight: 700;
        font-size: ${isLive ? "12px" : "10px"};
        box-shadow: ${isLive ? "0 2px 8px rgba(0,0,0,0.25)" : "0 1px 4px rgba(0,0,0,0.12)"};
        transition: all 0.15s ease;
        opacity: ${isLive ? "1" : "0.5"};
        z-index: ${zIndex};
      `;
      el.textContent = count > 0 ? String(count) : "";
      // Markers are plain DOM nodes: give them a name and keyboard access.
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.setAttribute(
        "aria-label",
        isLive ? `${venue.name}, ${plural(count, "deal")} on` : venue.name,
      );
      if (isSelected) el.setAttribute("aria-pressed", "true");
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectVenue(venue.id);
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelectVenue(venue.id);
        }
      });

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([venue.lng, venue.lat])
        .addTo(mapRef.current!);
      markersRef.current.push(marker);
    });
    // attempt: a rebuilt map (after Retry) needs its markers added again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venues, selectedVenueId, liveVenueIds, liveVenueCounts, onSelectVenue, resolvedTheme, attempt]);

  useEffect(() => {
    updateMarkers();
  }, [updateMarkers]);

  // User location marker (green pulsing dot). Only drawn for a real position:
  // a dot at the fallback city centre would claim the user is somewhere they
  // are not.
  useEffect(() => {
    if (!mapRef.current) return;

    // Remove old marker
    userMarkerRef.current?.remove();
    userMarkerRef.current = null;

    if (userLng == null || userLat == null || mapError) return;

    const el = document.createElement("div");
    el.style.cssText = `
      width: 18px;
      height: 18px;
      position: relative;
      pointer-events: none;
    `;
    // Inner solid dot
    const dot = document.createElement("div");
    dot.style.cssText = `
      width: 12px; height: 12px;
      background: #22c55e;
      border: 2px solid white;
      border-radius: 50%;
      position: absolute;
      top: 3px; left: 3px;
      z-index: 2;
      box-shadow: 0 0 6px rgba(34,197,94,0.6);
    `;
    // Pulsing ring
    const ring = document.createElement("div");
    ring.style.cssText = `
      width: 18px; height: 18px;
      background: rgba(34,197,94,0.3);
      border-radius: 50%;
      position: absolute;
      top: 0; left: 0;
      animation: user-loc-pulse 2s ease-out infinite;
    `;
    el.appendChild(ring);
    el.appendChild(dot);

    // Inject keyframes if not yet present
    if (!document.getElementById("user-loc-pulse-style")) {
      const style = document.createElement("style");
      style.id = "user-loc-pulse-style";
      style.textContent = `@keyframes user-loc-pulse { 0% { transform: scale(1); opacity: 1; } 100% { transform: scale(2.5); opacity: 0; } }`;
      document.head.appendChild(style);
    }

    const marker = new mapboxgl.Marker({ element: el })
      .setLngLat([userLng, userLat])
      .addTo(mapRef.current!);
    userMarkerRef.current = marker;

    return () => {
      marker.remove();
      userMarkerRef.current = null;
    };
    // attempt: a rebuilt map needs the marker re-added.
  }, [userLng, userLat, attempt, mapError]);

  // Click away deselects
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = () => onSelectVenue(null);
    map.on("click", handler);
    return () => { map.off("click", handler); };
  }, [onSelectVenue, attempt]);

  const handleRecenter = () => {
    if (mapRef.current && userLng != null && userLat != null) {
      mapRef.current.flyTo({ center: [userLng, userLat], zoom: 13, duration: flyDuration() });
    }
    onRecenter?.();
  };

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full rounded-lg" />
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
