// Shared request/response types for the /api Pages Functions.
// Imported by BOTH the SPA (src/) and the Functions (functions/), so the two
// sides of the wire can't drift.

export type VenueCountry = "AU" | "NZ" | "US" | "GB" | "CA";

export interface Venue {
  id: string;
  name: string;
  address: string;
  country: string | null;
  lat: number | null;
  lng: number | null;
  status: "active" | "inactive";
  /** IANA time zone derived from lat/lng (null when unknown or before migration 0005). */
  timezone?: string | null;
  /** Admin list only: deals as grouped in the editor (see GET /api/admin/venues). */
  deal_count?: number;
}

export interface HappyHour {
  id: string;
  venue_id: string;
  days_of_week: number[];
  start_time: string; // 'HH:MM:SS'
  end_time: string; // 'HH:MM:SS'
  description: string;
  tags: string[] | null;
  is_active: boolean;
}

export interface VenueWithHappyHours {
  id: string;
  name: string;
  address: string;
  country: string | null;
  lat: number;
  lng: number;
  /**
   * IANA time zone the venue's deal times are in ("Australia/Perth"), derived
   * from lat/lng on the server. Null when unknown (lookup failed, or migration
   * 0005 not applied yet): the client then uses the viewer's own zone.
   */
  timezone: string | null;
  distance_meters: number;
  happy_hours: HappyHour[];
}

/**
 * One deal within a submission. The first deal lives in the submission's own
 * columns (days_of_week/start_time/end_time/description/tags); deals beyond
 * the first travel as an array of these in `extra_deals`.
 */
export interface SubmissionDeal {
  days_of_week: number[];
  start_time: string;
  end_time: string;
  description: string;
  tags: string[] | null;
}

/** Hard cap on deals per submission (first deal + extras), enforced both sides. */
export const MAX_DEALS_PER_SUBMISSION = 7;

export interface Submission {
  id: string;
  venue_name: string;
  /** Optional free-text street address. */
  venue_address: string | null;
  /** City name (required at submit time). */
  city: string | null;
  /** ISO 3166-1 alpha-2 country code. */
  country: string | null;
  /** Coordinates from the submitter's city pick (map pin source). */
  lat: number | null;
  lng: number | null;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  description: string;
  tags: string[] | null;
  /** Deals beyond the first (which is in the fields above). */
  extra_deals: SubmissionDeal[];
  status: "pending" | "approved" | "rejected";
  /**
   * 'form' = public submit form; 'photo' = sent with a menu photo (admin
   * Snap-a-Deal, or the public form's "Snap a menu").
   */
  source: "form" | "photo";
  /** R2 object key of the compressed photo (photo submissions only). */
  image_key: string | null;
  /** Existing venue this submission was attached to at approval (null = new venue / not approved). */
  venue_id: string | null;
  created_at: string;
  /**
   * Cloudflare Access identity that approved or rejected it. Null while
   * pending, for decisions made before migration 0006, or before it is applied.
   */
  reviewed_by?: string | null;
  /** When it was approved or rejected (ISO UTC); null in the same cases. */
  reviewed_at?: string | null;
}

/** Body for POST /api/submissions (public form). */
export interface SubmissionInput {
  venue_name: string;
  /** Optional free-text street address. */
  venue_address: string | null;
  /** City name, picked from the city search (required). */
  city: string;
  /** ISO 3166-1 alpha-2 country code, picked (required). */
  country: string;
  /** Coordinates from the picked city (required — the map pin). */
  lat: number | null;
  lng: number | null;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  description: string;
  tags: string[] | null;
  /** Deals beyond the first (max MAX_DEALS_PER_SUBMISSION − 1). */
  extra_deals: SubmissionDeal[];
  honeypot: string;
  turnstile_token: string;
  /**
   * Opaque id from POST /api/menu-photo when the form was pre-filled from a
   * photo: attaches that photo (stored as source='photo'). Single use, expires
   * after an hour, only valid from the IP that uploaded it.
   */
  upload_id?: string | null;
}

/** Body for POST /api/menu-photo (public "Snap a menu" read). */
export interface MenuPhotoInput {
  /** Base64-encoded, canvas re-encoded (metadata-free) image, no data: prefix. */
  image_base64: string;
  media_type: "image/jpeg" | "image/png" | "image/webp";
  turnstile_token: string;
  honeypot: string;
}

/** One deal read from a menu photo. Empty values = not stated on the menu. */
export interface PhotoPrefillDeal {
  days_of_week: number[];
  /** 'HH:MM', or "" when the photo doesn't say. */
  start_time: string;
  end_time: string;
  description: string;
}

/** Response of POST /api/menu-photo. */
export interface MenuPhotoResult {
  /** False when the model found no deal in the photo (nothing is stored). */
  found: boolean;
  /** Send back as SubmissionInput.upload_id; null when nothing was found. */
  upload_id: string | null;
  /** Seconds until upload_id stops working. */
  expires_in: number | null;
  venue_name: string | null;
  venue_address: string | null;
  deals: PhotoPrefillDeal[];
}

/** Error strings POST /api/menu-photo and the photo claim can answer with. */
export const PHOTO_ERRORS = {
  /** Site-wide daily cap reached (429). */
  paused: "photo_paused",
  /** Limits couldn't be checked (KV error): fail closed (503). */
  unavailable: "photo_unavailable",
  /** Per-IP hourly/daily limit reached (429). */
  rateLimited: "photo_rate_limited",
  /** upload_id expired, already used, or sent from another IP (410). */
  expired: "photo_expired",
} as const;

/** Coordinates + resolved country from the geocode proxy. */
export interface Coords {
  lat: number;
  lng: number;
}

/** One deal in an approve request; `replaces_id` soft-deactivates an existing happy hour. */
export interface ApproveDeal extends SubmissionDeal {
  /** ID of an existing ACTIVE happy hour on the attached venue that this deal supersedes. */
  replaces_id?: string | null;
}

/**
 * Body for POST /api/admin/submissions/:id/approve.
 * Exactly one of `venue` (create a new venue) or `venue_id` (attach to an
 * existing venue) must be set. `venue_update` and per-deal `replaces_id` are
 * only valid with `venue_id`.
 */
export interface ApproveInput {
  venue?: ApproveVenue;
  venue_id?: string;
  /** Optional field updates applied to the existing venue on approve. */
  venue_update?: ApproveVenue;
  happy_hours: ApproveDeal[];
}

/**
 * How an approval's coordinates were confirmed. Approval needs a real
 * location, never a city-centre fallback:
 *  - address: a street address geocoded to an address or named place
 *  - manual:  coordinates entered by the reviewer
 *  - venue:   (venue_update only) the attached venue's existing coordinates
 */
export type ApproveLocationSource = "address" | "manual" | "venue";

export interface ApproveVenue {
  name: string;
  address: string;
  country: string | null;
  lat: number;
  lng: number;
  location_source: ApproveLocationSource;
}

/** Body for POST /api/admin/submissions/from-image (admin photo upload). */
export interface FromImageInput {
  /** Base64-encoded compressed image (no data: prefix). */
  image_base64: string;
  media_type: "image/jpeg" | "image/png" | "image/webp";
  /**
   * Optional coordinates: device GPS when the admin tapped "use my location",
   * else the picked city's coordinates (same coarse pin as the public form).
   */
  lat?: number | null;
  lng?: number | null;
  /** Typed venue name — overrides whatever the model reads from the image. */
  venue_name?: string | null;
  /** City name from the city picker. */
  city?: string | null;
  /** ISO 3166-1 alpha-2 country code. */
  country?: string | null;
}

/** Most descriptions one POST /api/admin/tidy-description call accepts. */
export const MAX_TIDY_DESCRIPTIONS = 10;

/** Body for POST /api/admin/tidy-description. */
export interface TidyDescriptionInput {
  descriptions: string[];
}

/** One tidied description. `changed: false` means "keep what you have". */
export interface TidyResult {
  original: string;
  /** The suggestion, or the original when nothing changed or the guard refused it. */
  tidied: string;
  changed: boolean;
  /** Why a suggestion was refused (guard failure), for logs and tests. */
  reason?: string;
}

/** Response of POST /api/admin/tidy-description, same order as the input. */
export interface TidyDescriptionResponse {
  results: TidyResult[];
}
