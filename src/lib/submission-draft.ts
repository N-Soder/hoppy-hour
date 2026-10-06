// Crash-proof draft for the "Submit a Hoppy Hour" form.
//
// The form can hold a lot of typing — a venue, a location, and up to
// MAX_DEALS_PER_SUBMISSION deals — and none of it used to survive a reload. A
// bot check that failed to load left the submit button dead with no way back
// but a refresh, which erased the lot. The draft is written to localStorage as
// the user types and offered back on the next visit.
//
// It is never applied silently: a stale draft re-appearing on its own would be
// worse than losing it, so restoring is always the user's explicit choice (see
// the restore banner in pages/Submit.tsx).

import type { CityResult } from "@/lib/city-search";
import { MAX_DEALS_PER_SUBMISSION } from "@/lib/api-types";

export const DRAFT_KEY = "hoppyhour:submission-draft:v1";
export const DRAFT_VERSION = 1;

/** Drafts older than a week are dropped on load — stale enough to be noise. */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Idle time before a change is written, so we don't hit storage per keystroke. */
export const DRAFT_SAVE_DEBOUNCE_MS = 600;

/**
 * One deal of a multi-deal submission. The form's deal fields always hold the
 * deal being edited (the "open" deal); the others live in this collapsed shape.
 * Picker state (activePreset/startMin/endMin) rides along so re-opening a deal
 * — or restoring a draft — puts the deal-hours picker back exactly as it was.
 */
export interface DealDraft {
  days_of_week: number[];
  start_time: string; // 'HH:MM'
  end_time: string; // 'HH:MM'
  description: string;
  tags: string[];
  activePreset: string | null;
  startMin: number | null;
  endMin: number | null;
}

export interface SubmissionDraft {
  version: number;
  /** Epoch ms of the last write, shown to the user as "saved 2 minutes ago". */
  savedAt: number;
  venue_name: string;
  venue_address: string;
  country: string;
  city: string;
  /** The picked city carries the coordinates the map pin needs. */
  selectedCity: CityResult | null;
  deals: DealDraft[];
  openIndex: number;
}

/** True once a deal holds anything the user actually chose or typed. */
export function dealHasContent(d: DealDraft): boolean {
  return d.days_of_week.length > 0 || d.description.trim() !== "" || d.tags.length > 0;
}

/**
 * Whether a draft is worth storing or offering back.
 *
 * Deliberately ignores country and city: both are filled passively from GPS/IP
 * on load (see lib/location-prefill.ts), so counting them would show a restore
 * banner to someone who had merely opened the page and left.
 */
export function isWorthKeeping(d: SubmissionDraft): boolean {
  return (
    d.venue_name.trim() !== "" ||
    d.venue_address.trim() !== "" ||
    d.deals.some(dealHasContent)
  );
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isNullableString(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

function isDealDraft(v: unknown): v is DealDraft {
  if (!v || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  return (
    Array.isArray(d.days_of_week) &&
    d.days_of_week.every((n) => typeof n === "number") &&
    typeof d.start_time === "string" &&
    typeof d.end_time === "string" &&
    typeof d.description === "string" &&
    isStringArray(d.tags) &&
    isNullableString(d.activePreset) &&
    (d.startMin === null || typeof d.startMin === "number") &&
    (d.endMin === null || typeof d.endMin === "number")
  );
}

function isCityResult(v: unknown): v is CityResult {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.city === "string" &&
    typeof c.lat === "number" &&
    typeof c.lng === "number" &&
    typeof c.label === "string" &&
    isNullableString(c.region ?? null) &&
    isNullableString(c.countryCode ?? null) &&
    isNullableString(c.countryName ?? null)
  );
}

/**
 * Validate an untrusted parsed value into a draft, or null if it is unusable.
 *
 * localStorage is user-editable and outlives deploys, so every field is checked
 * rather than trusted — a malformed draft must be dropped, not restored into a
 * half-broken form.
 */
export function parseDraft(raw: unknown, now: number = Date.now()): SubmissionDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;

  if (d.version !== DRAFT_VERSION) return null;
  if (typeof d.savedAt !== "number" || !Number.isFinite(d.savedAt)) return null;
  if (now - d.savedAt > DRAFT_MAX_AGE_MS) return null;

  if (
    typeof d.venue_name !== "string" ||
    typeof d.venue_address !== "string" ||
    typeof d.country !== "string" ||
    typeof d.city !== "string"
  ) {
    return null;
  }

  if (!Array.isArray(d.deals) || d.deals.length === 0) return null;
  if (d.deals.length > MAX_DEALS_PER_SUBMISSION) return null;
  if (!d.deals.every(isDealDraft)) return null;

  if (typeof d.openIndex !== "number" || !Number.isInteger(d.openIndex)) return null;
  if (d.openIndex < 0 || d.openIndex >= d.deals.length) return null;

  const draft: SubmissionDraft = {
    version: DRAFT_VERSION,
    savedAt: d.savedAt,
    venue_name: d.venue_name,
    venue_address: d.venue_address,
    country: d.country,
    city: d.city,
    selectedCity: isCityResult(d.selectedCity) ? d.selectedCity : null,
    deals: d.deals as DealDraft[],
    openIndex: d.openIndex,
  };

  return isWorthKeeping(draft) ? draft : null;
}

/** Read the stored draft, or null if there isn't a usable one. */
export function loadDraft(now: number = Date.now()): SubmissionDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return parseDraft(JSON.parse(raw), now);
  } catch {
    // Unavailable (private mode, storage disabled) or corrupt — no draft.
    return null;
  }
}

/** Store the draft, or drop any stored one if there's nothing worth keeping. */
export function saveDraft(draft: SubmissionDraft): void {
  if (!isWorthKeeping(draft)) {
    clearDraft();
    return;
  }
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage full or unavailable — autosave is a safety net, not a feature to
    // fail the form over.
  }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to do — see saveDraft.
  }
}

/** Short summary of what restoring would bring back, e.g. "The Golden Tap · 5 deals". */
export function describeDraft(d: SubmissionDraft): string {
  const parts: string[] = [];
  const venue = d.venue_name.trim();
  if (venue) parts.push(venue);
  const filled = d.deals.filter(dealHasContent).length;
  if (filled > 0) parts.push(`${filled} deal${filled === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(" · ") : "Unfinished submission";
}

/** Relative age of a draft for the restore banner, e.g. "2 minutes ago". */
export function formatSavedAt(savedAt: number, now: number = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - savedAt) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
