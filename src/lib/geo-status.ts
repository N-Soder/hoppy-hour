// Geolocation states and the copy that explains them. Kept apart from the hook
// so the mapping and wording are unit-testable without a browser.

export type GeoStatus =
  | "idle"
  | "requesting"
  /** Prompt still unanswered after a while: showing the fallback meanwhile. */
  | "waiting"
  | "granted"
  | "denied"
  | "timeout"
  | "unavailable"
  | "unsupported";

/** GeolocationPositionError.code → status (1 denied, 2 unavailable, 3 timeout). */
export function geoStatusForError(code: number | undefined): GeoStatus {
  switch (code) {
    case 1:
      return "denied";
    case 3:
      return "timeout";
    default:
      return "unavailable";
  }
}

/** The real location is known, so a "you are here" dot and recentre are honest. */
export function hasRealLocation(status: GeoStatus): boolean {
  return status === "granted";
}

/** Still working out where the user is — nothing to show yet. */
export function isLocating(status: GeoStatus, hasCoords: boolean): boolean {
  return !hasCoords && (status === "idle" || status === "requesting");
}

export interface GeoBanner {
  message: string;
  /** Label for the retry action, or null when retrying cannot help. */
  action: string | null;
}

/**
 * What the location banner says for a status, or null for no banner.
 * `userInitiated` marks a denial that answered the user's own retry: the
 * browser has location blocked for this site, so asking again is pointless
 * until they change the site setting.
 */
export function geoBanner(
  status: GeoStatus,
  fallbackName: string,
  userInitiated: boolean,
): GeoBanner | null {
  const near = `Showing venues near ${fallbackName}.`;
  switch (status) {
    case "waiting":
      return { message: `Waiting for location permission. ${near}`, action: null };
    case "denied":
      return userInitiated
        ? {
            message: `Location is blocked for this site. Allow it in your browser's site settings, then try again. ${near}`,
            action: "Try again",
          }
        : { message: `Location access is off. ${near}`, action: "Use my location" };
    case "timeout":
      return { message: `Finding your location took too long. ${near}`, action: "Try again" };
    case "unavailable":
      return { message: `Your location isn't available right now. ${near}`, action: "Try again" };
    case "unsupported":
      return { message: `This browser can't share your location. ${near}`, action: null };
    default:
      return null;
  }
}

/**
 * One-line version of the banner for the phone header's location chip:
 * a short status, the fallback place, and the same action. The full
 * sentence from geoBanner stays available as the chip's description.
 */
export function geoChip(
  status: GeoStatus,
  fallbackName: string,
  userInitiated: boolean,
): { label: string; action: string | null } | null {
  const banner = geoBanner(status, fallbackName, userInitiated);
  if (!banner) return null;
  const short: Partial<Record<GeoStatus, string>> = {
    waiting: "Waiting for location",
    denied: userInitiated ? "Location blocked" : "Location off",
    timeout: "Location timed out",
    unavailable: "Location unavailable",
    unsupported: "No location",
  };
  return { label: `${short[status] ?? "Location"} · near ${fallbackName}`, action: banner.action };
}
