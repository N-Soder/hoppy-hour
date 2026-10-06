// Row <-> API-type mappers for D1. The DB stores days_of_week/tags as JSON
// TEXT, times as 'HH:MM:SS' TEXT, and is_active as INTEGER 0/1; these translate
// to/from the shapes the client expects (src/lib/api-types.ts).
import type { HappyHour, Submission, SubmissionDeal, Venue } from "../../src/lib/api-types";

export interface Env {
  DB: D1Database;
  RATE_LIMIT: KVNamespace;
  // R2 bucket holding compressed photos from admin Snap-a-Deal submissions.
  SUBMISSION_IMAGES: R2Bucket;
  // Secret (dashboard / .dev.vars): key for the vision-extraction model calls.
  ANTHROPIC_API_KEY: string;
  MAPBOX_ACCESS_TOKEN: string;
  GEOCODE_COUNTRY?: string;
  // Optional Referer to send with server-side Mapbox calls, for URL-restricted
  // tokens. Defaults to the request's own origin (see functions/api/geocode.ts).
  GEOCODE_REFERER?: string;
  TURNSTILE_SECRET_KEY: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  // Set ONLY in local dev (.dev.vars, gitignored) to bypass Access JWT
  // verification. Never set in production — the middleware fails closed there.
  DEV_BYPASS_ACCESS?: string;
}

/** Normalise a time value ('HH:MM' from <input type="time">, or 'HH:MM:SS') to 'HH:MM:SS'. */
export function toHms(t: string): string {
  return t.length === 5 ? `${t}:00` : t;
}

function parseJsonArray(value: unknown): unknown[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function rowToHappyHour(r: Record<string, unknown>): HappyHour {
  return {
    id: r.id as string,
    venue_id: r.venue_id as string,
    days_of_week: parseJsonArray(r.days_of_week) as number[],
    start_time: r.start_time as string,
    end_time: r.end_time as string,
    description: r.description as string,
    tags: parseJsonArray(r.tags) as string[],
    is_active: r.is_active === 1,
  };
}

export function rowToVenue(r: Record<string, unknown>): Venue {
  return {
    id: r.id as string,
    name: r.name as string,
    address: r.address as string,
    country: (r.country as string | null) ?? null,
    lat: (r.lat as number | null) ?? null,
    lng: (r.lng as number | null) ?? null,
    status: r.status as Venue["status"],
  };
}

export function rowToSubmission(r: Record<string, unknown>): Submission {
  return {
    id: r.id as string,
    venue_name: r.venue_name as string,
    venue_address: (r.venue_address as string | null) ?? null,
    city: (r.city as string | null) ?? null,
    country: (r.country as string | null) ?? null,
    lat: (r.lat as number | null) ?? null,
    lng: (r.lng as number | null) ?? null,
    days_of_week: parseJsonArray(r.days_of_week) as number[],
    start_time: r.start_time as string,
    end_time: r.end_time as string,
    description: r.description as string,
    tags: parseJsonArray(r.tags) as string[],
    // Column may be absent on rows read before migration 0003 ran; [] either way.
    extra_deals: parseJsonArray(r.extra_deals) as SubmissionDeal[],
    status: r.status as Submission["status"],
    // Columns from migration 0004; default for rows read before it ran.
    source: (r.source as Submission["source"]) ?? "form",
    image_key: (r.image_key as string | null) ?? null,
    venue_id: (r.venue_id as string | null) ?? null,
    created_at: r.created_at as string,
  };
}
