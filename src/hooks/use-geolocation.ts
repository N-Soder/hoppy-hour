import { useState, useEffect, useCallback, useRef } from "react";
import { DEFAULT_LNG, DEFAULT_LAT } from "@/lib/constants";
import { geoStatusForError, type GeoStatus } from "@/lib/geo-status";

export type { GeoStatus } from "@/lib/geo-status";

interface GeoState {
  lng: number | null;
  lat: number | null;
  status: GeoStatus;
  /**
   * True when the most recent request was started by the user ("Use my
   * location") rather than on page load. A denial that answers a user request
   * instantly means the browser has location hard-blocked for this site.
   */
  userInitiated: boolean;
}

// Configurable via VITE_DEFAULT_LNG / VITE_DEFAULT_LAT environment variables.
const DEFAULT_COORDS = { lng: DEFAULT_LNG, lat: DEFAULT_LAT };

// getCurrentPosition's own timeout does not include the time a permission
// prompt sits unanswered, so without this the page could wait forever. After
// this long we show venues near the fallback location and keep listening.
const PROMPT_WAIT_MS = 10_000;

export function useGeolocation() {
  const [geo, setGeo] = useState<GeoState>({
    lng: null,
    lat: null,
    status: "idle",
    userInitiated: false,
  });
  const waitTimer = useRef<number>();

  const request = useCallback((userInitiated: boolean) => {
    window.clearTimeout(waitTimer.current);
    if (!("geolocation" in navigator) || !navigator.geolocation) {
      setGeo({ ...DEFAULT_COORDS, status: "unsupported", userInitiated });
      return;
    }
    // Keep any coordinates we already have so the list and map stay put while
    // a retry is in flight.
    setGeo((s) => ({ ...s, status: "requesting", userInitiated }));
    waitTimer.current = window.setTimeout(() => {
      setGeo((s) =>
        s.status === "requesting" && s.lat === null
          ? { ...DEFAULT_COORDS, status: "waiting", userInitiated }
          : s,
      );
    }, PROMPT_WAIT_MS);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.clearTimeout(waitTimer.current);
        setGeo({
          lng: pos.coords.longitude,
          lat: pos.coords.latitude,
          status: "granted",
          userInitiated,
        });
      },
      (err) => {
        window.clearTimeout(waitTimer.current);
        // Keep whatever centre is already showing (the fallback, normally);
        // only a first failure needs to switch to it.
        setGeo((s) => ({
          ...(s.lat !== null && s.lng !== null ? { lng: s.lng, lat: s.lat } : DEFAULT_COORDS),
          status: geoStatusForError(err?.code),
          userInitiated,
        }));
      },
      { enableHighAccuracy: false, timeout: 8000 },
    );
  }, []);

  useEffect(() => {
    request(false);
    return () => window.clearTimeout(waitTimer.current);
  }, [request]);

  const requestLocation = useCallback(() => request(true), [request]);

  const setManualLocation = useCallback((lng: number, lat: number) => {
    setGeo({ lng, lat, status: "granted", userInitiated: true });
  }, []);

  return { ...geo, requestLocation, setManualLocation };
}
