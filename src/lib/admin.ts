// Pure helpers for the admin screens: readable error copy, deal time rules,
// coordinate input, where a review's pin came from, what still blocks an
// approval, and the venues table's search/sort/count. Kept free of React so
// each rule is unit-tested (src/test/admin.test.ts).
import { ApiError, isAuthError } from "./api";
import { formatTimeRange, toMinutes } from "./format";
import { formatDayRange } from "./happy-hour-utils";
import { countryByCode } from "./countries";
import type { Submission, SubmissionDeal, Venue } from "./api-types";

// ─── Submissions ────────────────────────────────────────────────────────────

/** All deals of a submission: deal #1 from its own columns + extra_deals. */
export function dealsOf(sub: Submission): SubmissionDeal[] {
  return [
    {
      days_of_week: sub.days_of_week,
      start_time: sub.start_time,
      end_time: sub.end_time,
      description: sub.description,
      tags: sub.tags,
    },
    ...(sub.extra_deals ?? []),
  ];
}

/** Human-readable location line for a submission (street + city + country). */
export function locationLabel(sub: Pick<Submission, "venue_address" | "city" | "country">): string {
  const country = countryByCode(sub.country);
  // Approval records the venue's address, which may already be "City,
  // Country" (the fallback when no street was given): don't repeat parts.
  const parts: string[] = [];
  for (const p of [sub.venue_address, sub.city, country?.name]) {
    const t = p?.trim();
    if (t && !parts.join(", ").toLowerCase().includes(t.toLowerCase())) parts.push(t);
  }
  return parts.join(", ");
}

/** "24 Nov 2026" in the viewer's locale. */
export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Geocode query for a submission: the street address enriched with the stored
 * city + country. "5 Main St" is ambiguous; "5 Main St, Fremantle, Australia"
 * isn't, and a city with no street address still finds the city centre.
 */
export function geocodeQuery(address: string, sub: Pick<Submission, "city" | "country"> | null): string {
  return [address.trim(), sub?.city, countryByCode(sub?.country ?? null)?.name].filter(Boolean).join(", ");
}

// ─── Errors ─────────────────────────────────────────────────────────────────

/** Sentence-case a server message ("name is required" → "Name is required"). */
function sentence(s: string): string {
  const t = s.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/**
 * Turn any failure from the admin API into a sentence an admin can act on.
 * Raw status texts ("Internal Server Error", "Forbidden") never reach the UI.
 */
export function readableError(err: unknown): string {
  if (isAuthError(err)) return "Your admin session has expired. Reload the page to sign in again.";
  if (!(err instanceof ApiError)) {
    return err instanceof Error && err.message ? sentence(err.message) : "Something went wrong. Try again.";
  }
  const msg = err.message.trim();
  if (err.status === 0) return msg; // network: api.ts already wrote a sentence
  if (err.status === 429) return "Too many requests. Wait a minute, then try again.";
  if (err.status >= 500 || /^internal server error$/i.test(msg) || !msg) {
    return `The server hit an error (${err.status}). Try again; if it keeps happening, check the Cloudflare Functions logs.`;
  }
  if (err.status === 409) {
    if (/not pending|already (approved|rejected|processed)/i.test(msg)) {
      return "This submission was already handled, maybe in another tab. The list has been refreshed.";
    }
    return sentence(msg);
  }
  if (err.status === 404) return `${sentence(msg)}. It may have been deleted; the list has been refreshed.`;
  return sentence(msg);
}

// ─── Deal times ─────────────────────────────────────────────────────────────

/**
 * True when a deal ends on the next calendar day (stored as start > end, e.g.
 * 22:00–02:00). "All day" (00:00–23:59) does not.
 */
export function endsNextDay(start: string, end: string): boolean {
  if (!start || !end) return false;
  return toMinutes(end) < toMinutes(start);
}

/**
 * Validation message for a deal's start/end, or null when fine. Overnight
 * deals (start after end) are allowed: the public form, the map filter and
 * the server all store and read them that way. Only an empty or zero-length
 * range is rejected.
 */
export function dealTimeError(start: string, end: string): string | null {
  if (!start || !end) return "Add a start and end time.";
  if (toMinutes(start) === toMinutes(end)) return "Start and end can't be the same time.";
  return null;
}

/** Accessible description of a deal: "Mon–Fri, 5–6 pm" (with "ends next day" when it does). */
export function dealSummary(d: { days_of_week: number[]; start_time: string; end_time: string }): string {
  const days = formatDayRange(d.days_of_week) || "No days";
  const next = endsNextDay(d.start_time, d.end_time) ? ", ends next day" : "";
  return `${days}, ${formatTimeRange(d.start_time, d.end_time)}${next}`;
}

// ─── Splitting a deal ───────────────────────────────────────────────────────

interface DealKeyFields {
  start_time: string;
  end_time: string;
  description: string;
  tags: string[] | null;
  is_active: boolean;
}

/**
 * True when two deals would be grouped as one in the editor (same times,
 * description, tags and active state; days don't matter). Mirrors
 * groupHappyHours and the server's dealGroupKey.
 */
export function sameDealFields(a: DealKeyFields, b: DealKeyFields): boolean {
  const key = (d: DealKeyFields) =>
    [
      d.start_time.slice(0, 5),
      d.end_time.slice(0, 5),
      d.description.trim(),
      (d.tags ?? []).map((t) => t.trim().toLowerCase()).sort().join(","),
      d.is_active,
    ].join("|");
  return key(a) === key(b);
}

/**
 * Why the days picked for a deal split off from `originalDays` don't work, or
 * null. The new deal must take at least one of the original's days and leave
 * it at least one.
 */
export function splitDaysError(originalDays: number[], newDays: number[]): string | null {
  const taken = newDays.filter((d) => originalDays.includes(d));
  if (taken.length === 0) return `Pick at least one of the original deal's days (${formatDayRange(originalDays)}).`;
  if (taken.length === originalDays.length) {
    return "Leave at least one day in the original deal. To change every day, edit the original instead.";
  }
  return null;
}

/** The original deal's days left after splitting `newDays` off it. */
export function daysLeftAfterSplit(originalDays: number[], newDays: number[]): number[] {
  return originalDays.filter((d) => !newDays.includes(d));
}

export const SPLIT_IDENTICAL =
  "This is identical to the original deal, so it would be shown together with it. Change its times, description or tags, or cancel to keep one deal.";

// ─── Coordinates ────────────────────────────────────────────────────────────

export interface CoordInputs {
  lat: string;
  lng: string;
}

export interface CoordCheck {
  /** Per-field message, shown under the input. null = fine (or still empty). */
  latError: string | null;
  lngError: string | null;
  /** Both present and valid. */
  coords: { lat: number; lng: number } | null;
}

const NUMBER = /^-?\d+(\.\d+)?$/;

function checkAxis(raw: string, max: number, name: string): { value: number | null; error: string | null } {
  const t = raw.trim();
  if (!t) return { value: null, error: null };
  if (!NUMBER.test(t)) return { value: null, error: `${name} must be a number, like ${max === 90 ? "-31.95" : "115.86"}.` };
  const n = Number(t);
  if (Math.abs(n) > max) return { value: null, error: `${name} must be between -${max} and ${max}.` };
  return { value: n, error: null };
}

/** Inline validation for the manual latitude/longitude inputs. */
export function checkCoordInputs({ lat, lng }: CoordInputs): CoordCheck {
  const a = checkAxis(lat, 90, "Latitude");
  const b = checkAxis(lng, 180, "Longitude");
  return {
    latError: a.error,
    lngError: b.error,
    coords: a.value != null && b.value != null ? { lat: a.value, lng: b.value } : null,
  };
}

/**
 * A pasted "lat, lng" pair (Google Maps' "Copy coordinates" gives
 * "-31.95004, 115.86056"), or null if the text isn't one.
 */
export function splitCoordPair(text: string): CoordInputs | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  return m ? { lat: m[1], lng: m[2] } : null;
}

// ─── Review location ────────────────────────────────────────────────────────

/**
 * Where a review's pin came from:
 * - address: geocoded from a street address, and the match is a street
 *            address or a named place (Mapbox "address"/"poi")
 * - area:    a street lookup with no exact match: Mapbox's fuzzy fallback
 *            matched only a town, suburb, postcode or region, or a different
 *            street (low relevance), not the venue
 * - city:    only a city-centre fallback (the submitter's city pick)
 * - upload:  sent with a Snap-a-Deal photo (device GPS or the picked city)
 * - manual:  typed in by the reviewer
 */
export type PinSource = "address" | "area" | "city" | "upload" | "manual";

export interface ReviewPin {
  coords: { lat: number; lng: number };
  country: string | null;
  source: PinSource;
  /** What the geocoder matched, e.g. "12 Hay St, Perth WA 6000, Australia". */
  matched?: string;
}

/**
 * Only a looked-up street address or coordinates typed by the reviewer place
 * a venue. Everything else is approximate and blocks approval; the approve
 * endpoint enforces the same rule.
 */
export function isConfirmedPin(source: PinSource | null | undefined): boolean {
  return source === "address" || source === "manual";
}

export function describePin(source: PinSource): { label: string; exact: boolean } {
  switch (source) {
    case "address":
      return { label: "Located from the address", exact: true };
    case "manual":
      return { label: "Entered by hand", exact: true };
    case "area":
      return { label: "Approximate (no exact match for the address)", exact: false };
    case "upload":
      return { label: "From the photo upload (device location or city)", exact: false };
    case "city":
      return { label: "Approximate (city centre)", exact: false };
  }
}

/** Mapbox place types that pin an actual venue rather than an area. */
const PRECISE_PLACE_TYPES = new Set(["address", "poi"]);
/**
 * Below this Mapbox relevance an "address" match is a guess: "12 Example St,
 * Perth" comes back as "Australia Ii Drive, Crawley" at 0.63, while real
 * addresses score 1.
 */
export const MIN_ADDRESS_RELEVANCE = 0.9;

/**
 * Pin source for a street-address lookup result. Only an address or named
 * place that Mapbox matched with high relevance counts as the address; a
 * town, postcode or region, or a low-relevance guess, is only the area. A
 * result with no type or relevance is trusted (the proxy passes both on).
 */
export function lookupPinSource(placeType: string | undefined, relevance?: number): PinSource {
  if (placeType && !PRECISE_PLACE_TYPES.has(placeType)) return "area";
  if (relevance != null && relevance < MIN_ADDRESS_RELEVANCE) return "area";
  return "address";
}

/** Pin to start a review with, from what the submission carried. */
export function initialPin(sub: {
  lat: number | null;
  lng: number | null;
  country: string | null;
  source: "form" | "photo";
}): ReviewPin | null {
  if (sub.lat == null || sub.lng == null) return null;
  return {
    coords: { lat: sub.lat, lng: sub.lng },
    country: sub.country,
    // The public form only ever sends the picked city's centre.
    source: sub.source === "photo" ? "upload" : "city",
  };
}

/**
 * A public-form submission that arrived with a typed city and no
 * coordinates: the city search didn't recognise it. Its city must never be
 * geocoded on its own, since Mapbox answers an unknown town with a fuzzy
 * match somewhere else.
 */
export function cityUnrecognised(sub: Pick<Submission, "lat" | "lng" | "source">): boolean {
  return sub.source === "form" && (sub.lat == null || sub.lng == null);
}

// ─── Approval ───────────────────────────────────────────────────────────────

export interface ReviewDealInput {
  days_of_week: number[];
  start_time: string;
  end_time: string;
  description: string;
}

export interface ApproveCheckInput {
  venueName: string;
  deals: ReviewDealInput[];
  /** Attaching to an existing venue instead of creating one. */
  attached: boolean;
  /** With attached: also overwrite the venue's details. */
  updateAttachedDetails: boolean;
  attachedHasCoords: boolean;
  /** Source of the current pin, or null when there is none. */
  pin: PinSource | null;
  geocoding: boolean;
}

export const LOCATION_REQUIRED =
  "A street address must be looked up, or coordinates entered, before this can be approved.";

/** Why "Save & approve" is disabled, as sentences to show beside it. Empty = ready. */
export function approveBlockers(i: ApproveCheckInput): string[] {
  const out: string[] = [];
  if (!i.venueName.trim()) out.push("Add the venue name.");
  const confirmed = isConfirmedPin(i.pin);
  if (i.geocoding) {
    out.push("Looking up the address…");
  } else if (i.attached) {
    // Attaching uses the venue's own location, unless the reviewer also
    // replaces its details with a confirmed pin.
    if (!i.attachedHasCoords && !(i.updateAttachedDetails && confirmed)) {
      out.push(
        i.updateAttachedDetails
          ? `The venue has no location yet. ${LOCATION_REQUIRED}`
          : "The venue has no location yet. Tick “Also replace…” and look up a street address or enter coordinates.",
      );
    }
  } else if (!confirmed) {
    const why: Record<PinSource, string> = {
      city: "The pin is only the city centre.",
      area: "The lookup found no exact match for the address.",
      upload: "The pin is where the photo was uploaded from, or the city centre.",
      address: "",
      manual: "",
    };
    out.push(i.pin ? `${why[i.pin]} ${LOCATION_REQUIRED}` : LOCATION_REQUIRED);
  }
  if (i.deals.length === 0) out.push("Keep at least one deal.");
  i.deals.forEach((d, idx) => {
    const name = i.deals.length > 1 ? `Deal ${idx + 1}` : "The deal";
    const missing: string[] = [];
    if (d.days_of_week.length === 0) missing.push("a day");
    if (!d.description.trim()) missing.push("a description");
    const timeErr = dealTimeError(d.start_time, d.end_time);
    if (missing.length) out.push(`${name} needs ${missing.join(" and ")}.`);
    if (timeErr) out.push(`${name}: ${timeErr.charAt(0).toLowerCase()}${timeErr.slice(1)}`);
  });
  return out;
}

// ─── Venues table ───────────────────────────────────────────────────────────

export type VenueSortKey = "name" | "status" | "deals";
export interface VenueSort {
  key: VenueSortKey;
  dir: "asc" | "desc";
}

export function filterVenues(venues: Venue[], query: string): Venue[] {
  const q = query.trim().toLowerCase();
  if (!q) return venues;
  return venues.filter((v) => v.name.toLowerCase().includes(q) || v.address.toLowerCase().includes(q));
}

const byName = (a: Venue, b: Venue) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.address.localeCompare(b.address);

/** Sort a copy. Status ascending = active first; ties fall back to name. */
export function sortVenues(venues: Venue[], { key, dir }: VenueSort): Venue[] {
  const sign = dir === "asc" ? 1 : -1;
  const cmp = (a: Venue, b: Venue): number => {
    if (key === "status") {
      const s = (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1);
      return s !== 0 ? s * sign : byName(a, b);
    }
    if (key === "deals") {
      const d = (a.deal_count ?? 0) - (b.deal_count ?? 0);
      return d !== 0 ? d * sign : byName(a, b);
    }
    return byName(a, b) * sign;
  };
  return [...venues].sort(cmp);
}

/** The phone-width sort select: every column sort, both directions, in words. */
export const VENUE_SORT_OPTIONS: readonly (VenueSort & { label: string })[] = [
  { key: "name", dir: "asc", label: "Name, A to Z" },
  { key: "name", dir: "desc", label: "Name, Z to A" },
  { key: "status", dir: "asc", label: "Active first" },
  { key: "status", dir: "desc", label: "Inactive first" },
  { key: "deals", dir: "desc", label: "Most deals first" },
  { key: "deals", dir: "asc", label: "Fewest deals first" },
];

/**
 * Keep the table's rows where they were. With the previous order's ids and
 * the freshly sorted list: when both hold the same venues, return the fresh
 * venue objects in the previous order (a status switch under a Status sort
 * leaves its row in place); otherwise the fresh sort wins. Callers pass null
 * after an explicit sort or search so it re-sorts.
 */
export function keepRowOrder<T extends { id: string }>(previousIds: string[] | null, sorted: T[]): T[] {
  if (!previousIds || previousIds.length !== sorted.length) return sorted;
  const byId = new Map(sorted.map((v) => [v.id, v]));
  if (!previousIds.every((id) => byId.has(id))) return sorted;
  return previousIds.map((id) => byId.get(id)!);
}

/** "62 venues", or "3 of 62 venues" while a search narrows the table. */
export function venueCountLabel(shown: number, total: number): string {
  const noun = total === 1 ? "venue" : "venues";
  return shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`;
}
