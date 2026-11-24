// The home page's view state as it lives in the query string, so a reload
// restores the view and a link opens the same venue and filters.
//
//   ?venue=<id>&date=2026-11-28&time=17:30&radius=10000&tags=beer,wine&q=bar&view=map
//
// Defaults stay out of the URL: no date/time means "now" (and keeps following
// the clock), the default radius, no tags, no search and the list tab are all
// implied, so the plain address stays clean. Every value is validated on the
// way in; anything malformed is dropped back to its default.
import { VALID_TAGS } from "./tags";
import { DEFAULT_RADIUS, RADIUS_OPTIONS } from "./radius";

export type HomeView = "list" | "map";

export interface HomeUrlState {
  venue: string | null;
  /** Selected date as local YYYY-MM-DD, or null for today. */
  date: string | null;
  /** Selected time as HH:MM, or null for now. */
  time: string | null;
  radius: number;
  tags: string[];
  q: string;
  view: HomeView;
}

export const DEFAULT_URL_STATE: HomeUrlState = {
  venue: null,
  date: null,
  time: null,
  radius: DEFAULT_RADIUS,
  tags: [],
  q: "",
  view: "list",
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
// Venue ids are UUIDs or similar slugs; keep anything sane and short.
const VENUE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_Q = 200;

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
  if (state.tags.length > 0) out.set("tags", state.tags.join(","));
  if (state.q) out.set("q", state.q);
  if (state.view !== "list") out.set("view", state.view);
  return out;
}

const OWN_KEYS = new Set(["venue", "date", "time", "radius", "tags", "q", "view"]);

/** Number of filters narrowing the list, for the collapsed header's badge. */
export function countActiveFilters(state: HomeUrlState): number {
  return (
    (state.date || state.time ? 1 : 0) +
    (state.radius !== DEFAULT_RADIUS ? 1 : 0) +
    state.tags.length +
    (state.q.trim() ? 1 : 0)
  );
}

/** Query string with ":" and "," left readable (?time=17:30&tags=beer,wine). */
export function toQueryString(params: URLSearchParams): string {
  return params.toString().replace(/%3A/gi, ":").replace(/%2C/gi, ",");
}
