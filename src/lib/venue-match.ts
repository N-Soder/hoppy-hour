// Matching a submission against existing venues, so reviewers can attach a
// submission to a venue that's already in the database instead of creating a
// duplicate. Two signals:
//  * proximity — submissions carry coordinates (city pick, or the phone's GPS
//    for photo submissions), and two venues within ~100m are rarely distinct;
//  * name similarity — normalized token overlap tolerates "The Crown Hotel"
//    vs "Crown Hotel" and similar drift.
import type { Venue } from "./api-types";

export interface VenueMatch {
  venue: Venue;
  /** Meters from the submission's coordinates; null when either side lacks coords. */
  distance_m: number | null;
  /** 0..1 name similarity. */
  name_score: number;
}

const NOISE_WORDS = new Set(["the", "bar", "pub", "hotel", "tavern", "cafe", "restaurant", "and", "&"]);

export function normalizeVenueName(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics after NFD
    .replace(/['\u2019]/g, "") // "Murphy's" tokenizes as "murphys", not "murphy s"
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** Token-based similarity: Jaccard over normalized tokens, noise words down-weighted. */
export function venueNameScore(a: string, b: string): number {
  const ta = normalizeVenueName(a);
  const tb = normalizeVenueName(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const setA = new Set(ta);
  const setB = new Set(tb);
  let intersection = 0;
  let union = 0;
  for (const t of new Set([...setA, ...setB])) {
    const weight = NOISE_WORDS.has(t) ? 0.25 : 1;
    union += weight;
    if (setA.has(t) && setB.has(t)) intersection += weight;
  }
  return union === 0 ? 0 : intersection / union;
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** A candidate is worth showing when it's very close, or the names clearly overlap. */
const NEARBY_M = 250;
const NAME_THRESHOLD = 0.45;

export function suggestVenueMatches(
  name: string,
  coords: { lat: number; lng: number } | null,
  venues: Venue[],
  limit = 5,
): VenueMatch[] {
  const matches: VenueMatch[] = [];
  for (const venue of venues) {
    const name_score = venueNameScore(name, venue.name);
    const distance_m =
      coords && venue.lat != null && venue.lng != null
        ? haversineMeters(coords.lat, coords.lng, venue.lat, venue.lng)
        : null;
    const isNearby = distance_m != null && distance_m <= NEARBY_M;
    const nameMatches = name_score >= NAME_THRESHOLD;
    if (isNearby || nameMatches) {
      matches.push({ venue, distance_m, name_score });
    }
  }
  // Nearby-and-named first, then by distance (nulls last), then by name score.
  return matches
    .sort((a, b) => {
      const rank = (m: VenueMatch) =>
        (m.distance_m != null && m.distance_m <= NEARBY_M ? 2 : 0) + (m.name_score >= NAME_THRESHOLD ? 1 : 0);
      if (rank(b) !== rank(a)) return rank(b) - rank(a);
      if (a.distance_m != null && b.distance_m != null && a.distance_m !== b.distance_m) {
        return a.distance_m - b.distance_m;
      }
      return b.name_score - a.name_score;
    })
    .slice(0, limit);
}
