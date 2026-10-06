import { useEffect, useState } from "react";
import { reverseGeocodeCity, type CityResult } from "@/lib/city-search";

export interface LocationPrefill {
  /** ISO alpha-2 from the edge (IP) — best-effort, may be null. */
  countryCode: string | null;
  /** City resolved from already-granted geolocation — null unless permitted. */
  city: CityResult | null;
}

/**
 * Best-effort, fully passive location suggestion for the submit form.
 *
 *  - Country comes from Cloudflare's IP header (/api/geo): no permission, no
 *    location services needed.
 *  - City is filled ONLY when the browser reports geolocation is already
 *    `granted` (checked via the Permissions API, which does not prompt). If the
 *    user has never allowed location, denied it, or the browser lacks the
 *    Permissions API, we skip it silently — the form stays blank and searchable.
 *
 * Nothing here ever triggers a permission prompt. Submitting a happy hour never
 * requires location services.
 */
export function useLocationPrefill(): LocationPrefill {
  const [prefill, setPrefill] = useState<LocationPrefill>({ countryCode: null, city: null });

  useEffect(() => {
    let cancelled = false;

    // 1. Passive country from the edge.
    fetch("/api/geo")
      .then((r) => r.json())
      .then((d: { country?: string | null }) => {
        if (!cancelled && d?.country) {
          setPrefill((p) => (p.countryCode ? p : { ...p, countryCode: d.country ?? null }));
        }
      })
      .catch(() => {});

    // 2. City only if geolocation is ALREADY granted — never prompt.
    if (!navigator.permissions || !navigator.geolocation) return;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        if (cancelled || status.state !== "granted") return;
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const city = await reverseGeocodeCity(pos.coords.longitude, pos.coords.latitude);
            if (!cancelled && city) {
              setPrefill((p) => ({
                countryCode: city.countryCode ?? p.countryCode,
                city,
              }));
            }
          },
          () => {},
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
        );
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  return prefill;
}
