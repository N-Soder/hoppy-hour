// The home page's search box suggests two kinds of thing as you type: venues
// already loaded (by name and address) and places from /api/geocode (to move
// the search there). This is the part that needs no browser: matching and
// ranking venues, reading Mapbox's answer, the keyboard order of the rows and
// what Enter picks.

/** Places are only looked up from this many characters (the endpoint is rate limited). */
export const MIN_PLACE_QUERY = 3;
/** Wait this long after the last keystroke before looking places up. */
export const PLACE_DEBOUNCE_MS = 350;
export const MAX_VENUE_SUGGESTIONS = 5;
export const MAX_PLACE_SUGGESTIONS = 5;

export interface VenueSuggestion {
  kind: "venue";
  id: string;
  name: string;
  address: string;
}

export interface PlaceSuggestion {
  kind: "place";
  id: string;
  /** "Sofia", "Main Street": what the chip says. */
  name: string;
  /** "Sofia City, Bulgaria": region and country, so same-named places differ. */
  context: string;
  lng: number;
  lat: number;
}

export type Suggestion = VenueSuggestion | PlaceSuggestion;

interface VenueLike {
  id: string;
  name: string;
  address: string;
  distance_meters?: number;
}

/** Lower case, accents off ("Café" matches "cafe"), whitespace collapsed. */
export function normalise(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Lower is better; null is no match. */
function venueScore(v: VenueLike, q: string): number | null {
  const name = normalise(v.name);
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.split(/[\s\-'’&,./()]+/).some((w) => w.startsWith(q))) return 2;
  if (name.includes(q)) return 3;
  if (normalise(v.address).includes(q)) return 4;
  return null;
}

/**
 * Loaded venues that match the query by name or address, best first: the
 * whole name, then the name's start, a word's start, anywhere in the name,
 * then the address; nearer first within each.
 */
export function rankVenues(venues: VenueLike[], query: string, limit = MAX_VENUE_SUGGESTIONS): VenueSuggestion[] {
  const q = normalise(query);
  if (!q) return [];
  return venues
    .map((v) => ({ v, score: venueScore(v, q) }))
    .filter((x): x is { v: VenueLike; score: number } => x.score !== null)
    .sort(
      (a, b) =>
        a.score - b.score ||
        (a.v.distance_meters ?? Infinity) - (b.v.distance_meters ?? Infinity) ||
        a.v.name.localeCompare(b.v.name),
    )
    .slice(0, limit)
    .map(({ v }) => ({ kind: "venue", id: v.id, name: v.name, address: v.address }));
}

/** Place lookups start at MIN_PLACE_QUERY characters. */
export function wantsPlaces(query: string): boolean {
  return normalise(query).length >= MIN_PLACE_QUERY;
}

interface MapboxFeature {
  id?: unknown;
  text?: unknown;
  address?: unknown;
  place_name?: unknown;
  place_type?: unknown;
  center?: unknown;
}

/** Mapbox's geocoding answer as place suggestions (empty for anything unexpected). */
export function parsePlaces(data: unknown, limit = MAX_PLACE_SUGGESTIONS): PlaceSuggestion[] {
  const features = (data as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: PlaceSuggestion[] = [];
  const seen = new Set<string>();
  for (const f of features as MapboxFeature[]) {
    const c = f.center;
    if (!Array.isArray(c) || typeof c[0] !== "number" || typeof c[1] !== "number") continue;
    if (typeof f.text !== "string" || !f.text.trim()) continue;
    const [lng, lat] = c as [number, number];
    const isAddress = Array.isArray(f.place_type) && f.place_type.includes("address");
    // An address's `text` is the street; its number comes separately.
    const name = isAddress && typeof f.address === "string" ? `${f.address} ${f.text}` : f.text;
    const full = typeof f.place_name === "string" ? f.place_name : name;
    // place_name is "<name>, <region>, <country>": the rest after the name.
    const context = full.startsWith(`${name}, `)
      ? full.slice(name.length + 2)
      : full.split(", ").slice(1).join(", ");
    const id = typeof f.id === "string" ? f.id : `${lng},${lat}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ kind: "place", id, name, context, lng, lat });
    if (out.length >= limit) break;
  }
  return out;
}

/** The rows in keyboard order: venues first, then places. */
export function suggestionOrder(venues: VenueSuggestion[], places: PlaceSuggestion[]): Suggestion[] {
  return [...venues, ...places];
}

/** A DOM id for a row (aria-activedescendant points at it). */
export function suggestionDomId(prefix: string, s: Suggestion): string {
  return `${prefix}-${s.kind}-${s.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/**
 * What Enter picks: the highlighted row, else the first place (the typed text
 * is most likely a place to go to: a venue match is one click away and
 * already filtering the list), else nothing.
 */
export function enterTarget(options: Suggestion[], activeIndex: number): Suggestion | null {
  if (activeIndex >= 0 && activeIndex < options.length) return options[activeIndex];
  return options.find((o) => o.kind === "place") ?? null;
}

/** Next highlighted row for an arrow key: wraps, and -1 (none) is a stop. */
export function moveActive(current: number, count: number, step: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0) return step === 1 ? 0 : count - 1;
  const next = current + step;
  return next < 0 || next >= count ? -1 : next;
}

/** "3 venues and 5 places" for the screen-reader status line. */
export function suggestionSummary(venues: number, places: number | null): string {
  const part = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  if (places === null) return venues ? `${part(venues, "venue")}. Looking up places.` : "Looking up places.";
  if (!venues && !places) return "No matches.";
  return `${part(venues, "venue")} and ${part(places, "place")}.`;
}
