// Field validation shared by the public submit endpoint and the admin write
// endpoints. Enforces the per-element rules SQLite CHECK constraints can't
// (day values, allowed tag set, exact time ranges) plus the length caps.

export const VALID_TAGS = ["beer", "wine", "cocktails", "food", "spirits"] as const;

export interface HappyHourFields {
  days_of_week: number[];
  start_time: string;
  end_time: string;
  description: string;
  tags: string[] | null;
}

/** 'HH:MM' or 'HH:MM:SS' with real 0-23 / 0-59 ranges (the GLOB CHECK only pins width). */
export function isValidTime(t: unknown): t is string {
  if (typeof t !== "string") return false;
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = m[3] === undefined ? 0 : Number(m[3]);
  return h <= 23 && min <= 59 && s <= 59;
}

export function isStringLen(v: unknown, max: number): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

/** Optional string: absent/null/"" is fine, but if present must be within max. */
export function isOptionalStringLen(v: unknown, max: number): boolean {
  if (v == null || v === "") return true;
  return typeof v === "string" && v.length <= max;
}

/** ISO 3166-1 alpha-2: two ASCII letters. */
export function isCountryCode(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z]{2}$/.test(v);
}

/** A latitude/longitude pair within valid ranges. */
export function isLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" && typeof lng === "number" &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  );
}

export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.filter(
    (t): t is string => typeof t === "string" && (VALID_TAGS as readonly string[]).includes(t),
  );
}

function validDays(days: unknown): days is number[] {
  return (
    Array.isArray(days) &&
    days.length > 0 &&
    days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  );
}

/**
 * Validate the happy-hour/deal fields common to submissions, happy_hours, and
 * approvals. Returns an error string, or null when valid. Does NOT enforce
 * end > start: the app supports midnight-crossing ranges (start > end), which
 * the client stores as-is (see filterByDayAndTime).
 */
export function validateDealFields(f: {
  days_of_week?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  description?: unknown;
  tags?: unknown;
}): string | null {
  if (!validDays(f.days_of_week)) return "days_of_week must be a non-empty array of 0-6";
  if (!isValidTime(f.start_time)) return "start_time must be HH:MM[:SS]";
  if (!isValidTime(f.end_time)) return "end_time must be HH:MM[:SS]";
  if (!isStringLen(f.description, 1000)) return "description is required (max 1000)";
  if (f.tags != null && !Array.isArray(f.tags)) return "tags must be an array";
  return null;
}

/**
 * Validate an `extra_deals` array (deals beyond the first). `firstDealCount`
 * is how many deals precede it (1 for submissions), so the cap applies to the
 * submission's total. Each element gets the same rules as deal #1.
 */
export function validateExtraDeals(
  extras: unknown,
  maxTotal: number,
  firstDealCount = 1,
): string | null {
  if (extras == null) return null; // absent = no extra deals
  if (!Array.isArray(extras)) return "extra_deals must be an array";
  if (firstDealCount + extras.length > maxTotal) {
    return `too many deals (max ${maxTotal} per submission)`;
  }
  for (let i = 0; i < extras.length; i++) {
    const el = extras[i];
    if (el === null || typeof el !== "object" || Array.isArray(el)) {
      return `extra_deals[${i}] must be an object`;
    }
    const err = validateDealFields(el as Record<string, unknown>);
    if (err) return `extra_deals[${i}]: ${err}`;
  }
  return null;
}

/** Max ids/records one admin batch call may touch (a grouped deal is at most 7 days). */
export const MAX_BATCH_ITEMS = 100;

/** A non-empty array of id strings, capped so one request can't build an unbounded D1 batch. */
export function validateIdList(ids: unknown, field = "ids"): string | null {
  if (!Array.isArray(ids) || ids.length === 0) return `${field} required`;
  if (ids.length > MAX_BATCH_ITEMS) return `too many ${field} (max ${MAX_BATCH_ITEMS})`;
  if (!ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= 64)) {
    return `${field} must be non-empty strings`;
  }
  return null;
}

/** Venue lat/lng: both null (no pin yet), or a valid pair. */
export function isOptionalLatLng(lat: unknown, lng: unknown): boolean {
  return (lat == null && lng == null) || isLatLng(lat, lng);
}

/**
 * Validate a full venue (create / approve). Country is optional; when present
 * it must be ISO alpha-2 (callers upper-case it to satisfy the DB GLOB CHECK).
 */
export function validateVenue(
  v: { name?: unknown; address?: unknown; country?: unknown; lat?: unknown; lng?: unknown },
  { requireCoords }: { requireCoords: boolean },
): string | null {
  if (!isStringLen(v.name, 200)) return "name is required (max 200)";
  if (!isStringLen(v.address, 500)) return "address is required (max 500)";
  if (v.country != null && !isCountryCode(v.country)) return "country must be a 2-letter ISO code";
  if (requireCoords ? !isLatLng(v.lat, v.lng) : !isOptionalLatLng(v.lat, v.lng)) {
    return requireCoords ? "lat and lng are required and must be in range" : "lat and lng must be a valid pair or both null";
  }
  return null;
}

/**
 * Validate a partial venue update (admin PUT). Only keys present are checked;
 * lat/lng are checked individually since one may be sent without the other.
 */
export function validateVenuePatch(p: Record<string, unknown>): string | null {
  if ("name" in p && !isStringLen(p.name, 200)) return "name must be 1-200 chars";
  if ("address" in p && !isStringLen(p.address, 500)) return "address must be 1-500 chars";
  if ("country" in p && p.country != null && !isCountryCode(p.country)) {
    return "country must be a 2-letter ISO code or null";
  }
  const coord = (v: unknown, max: number) =>
    v == null || (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max);
  if ("lat" in p && !coord(p.lat, 90)) return "lat must be a number in -90..90 or null";
  if ("lng" in p && !coord(p.lng, 180)) return "lng must be a number in -180..180 or null";
  if ("status" in p && p.status !== "active" && p.status !== "inactive") {
    return "status must be 'active' or 'inactive'";
  }
  return null;
}
