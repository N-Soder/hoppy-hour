// The last venue list that loaded, kept on the device so the list still has
// something to show offline or when the request can't reach the server.
//
// The service worker's runtime cache only answers a byte-identical
// /api/venues URL, and a phone's location drifts between visits, so it rarely
// helps on its own. This keeps one entry: the most recent successful query.
import { ApiError } from "./api";
import type { VenueWithHappyHours } from "./api-types";
import { DAYS_SHORT } from "./constants";
import { formatClock } from "./format";

const KEY = "hoppyhour:last-venues";
/** Older than this, the deals may well have changed; don't offer them. */
export const SAVED_VENUES_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export interface SavedVenues {
  lng: number;
  lat: number;
  radius: number;
  /** When the response arrived (ms since epoch). */
  savedAt: number;
  venues: VenueWithHappyHours[];
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saveVenues(entry: SavedVenues, store: Storage | null = storage()): void {
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(entry));
  } catch {
    // Quota or private mode: the fallback is a nicety, never an error.
  }
}

export function parseSavedVenues(raw: unknown, now: number = Date.now()): SavedVenues | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<SavedVenues>;
  if (
    typeof s.lng !== "number" ||
    typeof s.lat !== "number" ||
    typeof s.radius !== "number" ||
    typeof s.savedAt !== "number" ||
    !Array.isArray(s.venues)
  ) {
    return null;
  }
  if (now - s.savedAt > SAVED_VENUES_MAX_AGE_MS || s.savedAt > now + 60_000) return null;
  const venues = s.venues.filter(
    (v) => v && typeof v.id === "string" && typeof v.name === "string" && Array.isArray(v.happy_hours),
  );
  return { lng: s.lng, lat: s.lat, radius: s.radius, savedAt: s.savedAt, venues };
}

export function loadSavedVenues(store: Storage | null = storage(), now: number = Date.now()): SavedVenues | null {
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    return raw ? parseSavedVenues(JSON.parse(raw), now) : null;
  } catch {
    return null;
  }
}

/** The request never reached the server (as opposed to the server failing). */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 0;
  return err instanceof TypeError;
}

export interface VenueSourceInput {
  /** The venues query's data, if it has any (possibly stale). */
  live: VenueWithHappyHours[] | undefined;
  online: boolean;
  /** The venues query's error, if its last fetch failed. */
  error: unknown;
  saved: SavedVenues | null;
}

export type VenueSource =
  | { kind: "live"; venues: VenueWithHappyHours[] }
  | { kind: "saved"; venues: VenueWithHappyHours[]; savedAt: number }
  | { kind: "none" };

/**
 * What the list and map show. Data from this session always wins. Without
 * it, the saved list stands in when the device is offline (the query is
 * paused, so it would sit on "loading" for ever) or the request failed
 * before reaching the server. A server error with nothing loaded still shows
 * the error state: saved results would hide a problem a retry might fix.
 */
export function selectVenueSource(i: VenueSourceInput): VenueSource {
  if (i.live !== undefined) return { kind: "live", venues: i.live };
  if (i.saved && (!i.online || (i.error != null && isNetworkError(i.error)))) {
    return { kind: "saved", venues: i.saved.venues, savedAt: i.saved.savedAt };
  }
  return { kind: "none" };
}

/** "6:42 pm", "yesterday, 6:42 pm" or "Tue 3 Nov, 6:42 pm" (device time), for the saved-results note. */
export function formatSavedTime(savedAt: number, now: number = Date.now()): string {
  const d = new Date(savedAt);
  const n = new Date(now);
  const time = formatClock(d.getHours() * 60 + d.getMinutes());
  if (d.toDateString() === n.toDateString()) return time;
  const yesterday = new Date(n);
  yesterday.setDate(n.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `yesterday, ${time}`;
  return `${DAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}, ${time}`;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
