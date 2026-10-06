export { VALID_TAGS, type ValidTag } from "./tags";

export const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

// Default map center coordinates — configurable via VITE_DEFAULT_LNG / VITE_DEFAULT_LAT env vars.
// Falls back to Perth, WA which is the primary launch market.
export const DEFAULT_LNG = Number(import.meta.env.VITE_DEFAULT_LNG ?? 115.8605);
export const DEFAULT_LAT = Number(import.meta.env.VITE_DEFAULT_LAT ?? -31.9505);

// Human-readable name for the default location, shown in the geolocation-denied banner.
// Configurable via VITE_DEFAULT_LOCATION_NAME env var.
export const DEFAULT_LOCATION_NAME: string =
  import.meta.env.VITE_DEFAULT_LOCATION_NAME ?? "Perth, Western Australia";
