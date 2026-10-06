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
  /** 'form' = public submit form; 'photo' = admin Snap-a-Deal photo upload. */
  source: "form" | "photo";
  /** R2 object key of the compressed photo (photo submissions only). */
  image_key: string | null;
  /** Existing venue this submission was attached to at approval (null = new venue / not approved). */
  venue_id: string | null;
  created_at: string;
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
}

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
  venue?: { name: string; address: string; country: string | null; lat: number; lng: number };
  venue_id?: string;
  /** Optional field updates applied to the existing venue on approve. */
  venue_update?: { name: string; address: string; country: string | null; lat: number; lng: number };
  happy_hours: ApproveDeal[];
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
