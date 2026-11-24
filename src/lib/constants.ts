export { VALID_TAGS, type ValidTag } from "./tags";

// Public source repository, linked from the options menu.
export const REPO_URL = "https://github.com/N-Soder/hoppy-hour";

// Day names indexed by the stored day value (0=Sun…6=Sat, matching
// Date.getDay() and the days_of_week column). Index into these; never iterate
// them for display — use WEEK_DAYS for anything the user sees in order.
export const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/**
 * Display order for days: weeks start on Monday everywhere in the UI. Values
 * are the stored day indices (0=Sun…6=Sat) — only the order changes, never the
 * data model.
 */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** Monday-first day list for chips, pickers and summaries. */
export const WEEK_DAYS: readonly { value: number; short: string; long: string }[] = WEEK_ORDER.map(
  (value) => ({ value, short: DAYS_SHORT[value], long: DAYS_LONG[value] }),
);

/** Position of a stored day (0=Sun…6=Sat) in the Monday-first week: Mon=0 … Sun=6. */
export function weekIndex(day: number): number {
  return (day + 6) % 7;
}

/** Sort stored day values into Monday-first week order (returns a new array). */
export function sortDaysInWeekOrder(days: readonly number[]): number[] {
  return [...days].sort((a, b) => weekIndex(a) - weekIndex(b));
}

// Default map center coordinates — configurable via VITE_DEFAULT_LNG / VITE_DEFAULT_LAT env vars.
// Falls back to Perth, WA which is the primary launch market.
export const DEFAULT_LNG = Number(import.meta.env.VITE_DEFAULT_LNG ?? 115.8605);
export const DEFAULT_LAT = Number(import.meta.env.VITE_DEFAULT_LAT ?? -31.9505);

// Human-readable name for the default location, shown in the geolocation banner.
// Configurable via VITE_DEFAULT_LOCATION_NAME env var.
export const DEFAULT_LOCATION_NAME: string =
  import.meta.env.VITE_DEFAULT_LOCATION_NAME ?? "Perth, Western Australia";
