import { useState, useEffect, useCallback } from "react";
import { DEFAULT_LNG, DEFAULT_LAT } from "@/lib/constants";

interface GeoState {
  lng: number | null;
  lat: number | null;
  status: "idle" | "requesting" | "granted" | "denied" | "error";
}

// Configurable via VITE_DEFAULT_LNG / VITE_DEFAULT_LAT environment variables.
const DEFAULT_COORDS = { lng: DEFAULT_LNG, lat: DEFAULT_LAT };

export function useGeolocation() {
  const [geo, setGeo] = useState<GeoState>({
    lng: null,
    lat: null,
    status: "idle",
  });

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGeo({ ...DEFAULT_COORDS, status: "denied" });
      return;
    }
    setGeo((s) => ({ ...s, status: "requesting" }));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({
          lng: pos.coords.longitude,
          lat: pos.coords.latitude,
          status: "granted",
        });
      },
      () => {
        setGeo({ ...DEFAULT_COORDS, status: "denied" });
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }, []);

  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  const setManualLocation = useCallback((lng: number, lat: number) => {
    setGeo({ lng, lat, status: "granted" });
  }, []);

  return { ...geo, requestLocation, setManualLocation };
}
