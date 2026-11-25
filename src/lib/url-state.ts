// The home page's view state as it lives in the query string, so a reload
// restores the view and a link opens the same venue and filters.
//
//   ?venue=<id>&date=2026-11-28&time=17:30&radius=10000&place=Sofia&near=23.3219,42.6977
//    &tags=beer,wine&q=bar&view=map
//
// `place` and `near` are a place picked in the search box: its name for the
// "Near Sofia" chip and its lng,lat, which becomes the search centre. They
// come and go together; one without the other (or a bad coordinate) is
// dropped, so links from before they existed are read exactly as before.
//
// Defaults stay out of the URL: no date/time means "now" (and keeps following
// the clock), the default radius, no tags, no search and the list tab are all
// implied, so the plain address stays clean. Every value is validated on the
// way in; anything malformed is dropped back to its default.
import { VALID_TAGS } from "./tags";
import { DEFAULT_RADIUS, RADIUS_OPTIONS } from "./radius";

export type HomeView = "list" | "map";

/** A place picked in the search box: the list and map search around it. */
export interface ChosenPlace {
  name: string;
  lng: number;
  lat: number;
}

export interface HomeUrlState {
  venue: string | null;
  /** Selected date as local YYYY-MM-DD, or null for today. */
  date: string | null;
  /** Selected time as HH:MM, or null for now. */
  time: string | null;
  radius: number;
  place: ChosenPlace | null;
  tags: string[];
  q: string;
  view: HomeView;
}

export const DEFAULT_URL_STATE: HomeUrlState = {
  venue: null,
  date: null,
  time: null,
  radius: DEFAULT_RADIUS,
  place: null,
  tags: [],
  q: "",
  view: "list",
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
// Venue ids are UUIDs or similar slugs; keep anything sane and short.
const VENUE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_Q = 200;
const MAX_PLACE_NAME = 100;
const NEAR_RE = /^(-?\d{1,3}(?:\.\d{1,7})?),(-?\d{1,2}(?:\.\d{1,7})?)$/;

/** A place from its `place` and `near` params, or null unless both are sane. */
export function parsePlaceParams(name: string | null, near: string | null): ChosenPlace | null {
  // Control characters out, whitespace collapsed.
  // eslint-disable-next-line no-control-regex
  const clean = (name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_PLACE_NAME);
  const m = near ? NEAR_RE.exec(near) : null;
  if (!clean || !m) return null;
  const lng = Number(m[1]);
  const lat = Number(m[2]);
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return { name: clean, lng, lat };
}

/** "23.3219,42.6977": lng,lat with five decimals (about a metre), zeros trimmed. */
export function formatNear(place: ChosenPlace): string {
  const f = (n: number) => String(Number(n.toFixed(5)));
  return `${f(place.lng)},${f(place.lat)}`;
}

/** A real calendar date in YYYY-MM-DD, or null. */
export function parseDateParam(v: string | null): string | null {
  if (!v) return null;
  const m = DATE_RE.exec(v);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3])
    ? v
    : null;
}

/** Local YYYY-MM-DD for a Date. */
export function toDateParam(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The Date (local midnight) a YYYY-MM-DD param names. */
export function fromDateParam(v: string): Date {
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function parseHomeParams(params: URLSearchParams): HomeUrlState {
  const venue = params.get("venue");
  const time = params.get("time");
  const radius = Number(params.get("radius"));
  const tags = (params.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t, i, all) => (VALID_TAGS as readonly string[]).includes(t) && all.indexOf(t) === i);
  return {
    venue: venue && VENUE_RE.test(venue) ? venue : null,
    date: parseDateParam(params.get("date")),
    time: time && TIME_RE.test(time) ? time : null,
    radius: (RADIUS_OPTIONS as readonly number[]).includes(radius) ? radius : DEFAULT_RADIUS,
    place: parsePlaceParams(params.get("place"), params.get("near")),
    tags,
    q: (params.get("q") ?? "").slice(0, MAX_Q),
    view: params.get("view") === "map" ? "map" : "list",
  };
}

/**
 * Serialise in a fixed order, leaving out every default. Parameters this
 * module does not own are kept, so an unrelated one (a campaign tag, say)
 * survives a filter change.
 */
export function serializeHomeParams(state: HomeUrlState, keep?: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  if (keep) {
    for (const [k, v] of keep) {
      if (!OWN_KEYS.has(k)) out.append(k, v);
    }
  }
  if (state.venue) out.set("venue", state.venue);
  if (state.date) out.set("date", state.date);
  if (state.time) out.set("time", state.time);
  if (state.radius !== DEFAULT_RADIUS) out.set("radius", String(state.radius));
  if (state.place) {
    out.set("place", state.place.name);
    out.set("near", formatNear(state.place));
  }
  if (state.tags.length > 0) out.set("tags", state.tags.join(","));
  if (state.q) out.set("q", state.q);
  if (state.view !== "list") out.set("view", state.view);
  return out;
}

const OWN_KEYS = new Set(["venue", "date", "time", "radius", "place", "near", "tags", "q", "view"]);

/**
 * Every filter back to its default (date and time to now, the default radius,
 * no place, no tags, no search), keeping the open venue and the list/map tab, which are
 * not filters. Serialised, the filters leave the URL entirely.
 */
export function clearedFilters(state: HomeUrlState): HomeUrlState {
  return {
    ...state,
    date: DEFAULT_URL_STATE.date,
    time: DEFAULT_URL_STATE.time,
    radius: DEFAULT_URL_STATE.radius,
    place: DEFAULT_URL_STATE.place,
    tags: DEFAULT_URL_STATE.tags,
    q: DEFAULT_URL_STATE.q,
  };
}

/** Number of filters narrowing the list, for the collapsed header's badge. */
export function countActiveFilters(state: HomeUrlState): number {
  return (
    (state.date || state.time ? 1 : 0) +
    (state.radius !== DEFAULT_RADIUS ? 1 : 0) +
    (state.place ? 1 : 0) +
    state.tags.length +
    (state.q.trim() ? 1 : 0)
  );
}

/** Query string with ":" and "," left readable (?time=17:30&tags=beer,wine). */
export function toQueryString(params: URLSearchParams): string {
  return params.toString().replace(/%3A/gi, ":").replace(/%2C/gi, ",");
}
