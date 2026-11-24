// A venue's IANA time zone from its coordinates, worked out in the Function.
//
// @photostructure/tz-lookup embeds a compressed time-zone map in one ~73 KB
// file (~28 KB gzipped), has no dependencies and no I/O, so it runs as-is in
// Cloudflare Workers. It trades some accuracy for that size: within a few km
// of a zone border it can return the neighbouring zone. An admin can correct a
// venue by sending `timezone` in PUT /api/admin/venues/:id.
import tzlookup from "@photostructure/tz-lookup";

/** The IANA zone at (lat, lng), or null when the coordinates are missing or invalid. */
export function timezoneFor(lat: unknown, lng: unknown): string | null {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  try {
    return tzlookup(lat, lng);
  } catch {
    return null;
  }
}

/** True for a zone name the runtime's Intl knows ("Australia/Perth", "UTC"). */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
