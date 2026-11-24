// Which of the venue list's states to show, and what an empty list should say.
// Pure functions so each state is unit-tested; Index.tsx only wires them up.
import { formatDistanceRadius } from "./radius";

export type ListState = "loading" | "error" | "empty" | "ready";

export interface ListStateInput {
  /** Location not known yet (geolocation pending, so the query is disabled). */
  locating: boolean;
  /** The venues query has no data yet and is fetching or about to. */
  pending: boolean;
  isError: boolean;
  /** The query has returned data at least once (possibly stale). */
  hasData: boolean;
  /** Venues left after the name/address search. */
  visibleCount: number;
}

/**
 * Loading while we don't know where to look or the first fetch is running;
 * error when a fetch failed and there is nothing to show; otherwise empty or
 * ready. A failed background refresh with data already on screen stays
 * "ready" — the caller shows a smaller notice instead of hiding the list.
 */
export function selectListState(i: ListStateInput): ListState {
  if (i.hasData) return i.visibleCount === 0 ? "empty" : "ready";
  if (i.isError) return "error";
  if (i.locating || i.pending) return "loading";
  return "empty";
}

export interface EmptyStateInput {
  searchQuery: string;
  tags: string[];
  /** Phrase for a non-current date/time ("Sat 5:15 pm"), or null when it's now. */
  whenPhrase: string | null;
  radiusMeters: number;
  /** Venues the API returned inside the radius, before the name search. */
  venuesInRadius: number;
}

export interface EmptyStateCopy {
  title: string;
  detail: string;
  /** Human-readable active filters, for the "Filters:" line. */
  activeFilters: string[];
  /** Offer "Clear filters" (something other than the radius is narrowing). */
  canClear: boolean;
}

export function describeEmptyState(i: EmptyStateInput): EmptyStateCopy {
  const q = i.searchQuery.trim();
  const activeFilters: string[] = [];
  if (q) activeFilters.push(`“${q}”`);
  if (i.tags.length > 0) {
    activeFilters.push(i.tags.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(", "));
  }
  if (i.whenPhrase) activeFilters.push(i.whenPhrase);
  const canClear = activeFilters.length > 0;

  if (i.venuesInRadius > 0 && q) {
    // The name search hid everything; the radius is not the reason.
    return {
      title: `No venues match “${q}”`,
      detail: "Check the spelling, or press Enter to look for a place with that name.",
      activeFilters,
      canClear,
    };
  }
  return {
    title: `No venues within ${formatDistanceRadius(i.radiusMeters)}`,
    detail: "Try a wider distance or another area, or submit a deal you know about.",
    activeFilters,
    canClear,
  };
}
