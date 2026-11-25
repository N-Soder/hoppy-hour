import { useCallback, useMemo, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { parseHomeParams, serializeHomeParams, toQueryString, type HomeUrlState } from "@/lib/url-state";

/** History state on the entry pushed when a venue opens. */
interface VenueEntryState {
  venueOverlay: true;
  /** The query string (without venue) the venue was opened from. */
  base: string;
}

function isVenueEntry(s: unknown): s is VenueEntryState {
  return !!s && typeof s === "object" && (s as VenueEntryState).venueOverlay === true;
}

function withoutVenue(params: URLSearchParams): string {
  const p = new URLSearchParams(params);
  p.delete("venue");
  return p.toString();
}

/**
 * The home page's view state in the query string (see lib/url-state).
 *
 * - Filter and tab changes replace the current history entry.
 * - Opening a venue pushes one, so the browser's Back closes it.
 * - Closing goes back when that returns to the same filters, else replaces.
 */
export function useHomeUrlState() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const state = useMemo(() => parseHomeParams(params), [params]);
  const locationStateRef = useRef(location.state);
  locationStateRef.current = location.state;

  const update = useCallback(
    (patch: Partial<HomeUrlState>) => {
      setParams((prev) => toQueryString(serializeHomeParams({ ...parseHomeParams(prev), ...patch }, prev)), {
        replace: true,
        state: locationStateRef.current,
      });
    },
    [setParams],
  );

  /**
   * Open a venue. `patch` changes other state too (picking a venue from the
   * search suggestions clears the search text): it is applied to the entry the
   * venue opens from as well, so Back or closing returns to the patched state
   * rather than the one before it.
   */
  const openVenue = useCallback(
    (id: string, patch?: Partial<HomeUrlState>) => {
      const swapping = isVenueEntry(locationStateRef.current) || !!params.get("venue");
      let base = params;
      if (patch && !swapping) {
        base = serializeHomeParams({ ...parseHomeParams(params), ...patch }, params);
        setParams(toQueryString(base), { replace: true, state: locationStateRef.current });
      }
      const next = serializeHomeParams({ ...parseHomeParams(base), ...patch, venue: id }, base);
      setParams(
        toQueryString(next),
        swapping
          ? // Already showing a venue: swap it, so one Back still closes.
            { replace: true, state: locationStateRef.current }
          : { replace: false, state: { venueOverlay: true, base: withoutVenue(base) } satisfies VenueEntryState },
      );
    },
    [setParams, params],
  );

  const closeVenue = useCallback(() => {
    const s = locationStateRef.current;
    if (isVenueEntry(s) && s.base === withoutVenue(params)) {
      navigate(-1);
      return;
    }
    setParams((prev) => toQueryString(serializeHomeParams({ ...parseHomeParams(prev), venue: null }, prev)), {
      replace: true,
      state: null,
    });
  }, [navigate, params, setParams]);

  return { state, update, openVenue, closeVenue };
}
