import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { HappyHour, VenueWithHappyHours } from "@/lib/api-types";

// Re-exported so existing importers (components, tests) keep their import paths.
export type { HappyHour, VenueWithHappyHours } from "@/lib/api-types";

const STALE_TIME = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches active venues within `radiusMeters` of (lng, lat) with their active
 * happy hours embedded — one round trip via GET /api/venues.
 */
export function useVenuesWithinRadius(
  lng: number | null,
  lat: number | null,
  radiusMeters: number = 5000
) {
  return useQuery({
    queryKey: ["venues", lng, lat, radiusMeters],
    queryFn: async () => {
      if (lng === null || lat === null) return [];
      return api.get<VenueWithHappyHours[]>(
        `/api/venues?lng=${lng}&lat=${lat}&radius=${radiusMeters}`
      );
    },
    enabled: lng !== null && lat !== null,
    staleTime: STALE_TIME,
  });
}

export function filterByDayAndTime(
  happyHours: HappyHour[],
  dayOfWeek: number,
  timeStr: string
): HappyHour[] {
  return happyHours.filter((hh) => {
    const t = timeStr;
    const start = hh.start_time;
    const end = hh.end_time;
    const onDay = hh.days_of_week.includes(dayOfWeek);
    // Fix B1: three-way split on time range semantics:
    // 1. Normal range (start < end, e.g. 17:00–19:00): current day must be in
    //    days_of_week AND t must be in [start, end]
    // 2. Closes exactly at midnight (end == "00:00:00", e.g. 23:00–00:00):
    //    current day must be in days_of_week AND t >= start (valid until end of
    //    day; "00:00:00" can't be >= any evening time in a string comparison,
    //    so we special-case it rather than trigger case 3)
    // 3. Midnight-crossing (start > end, end != "00:00:00", e.g. Fri 22:00–02:00):
    //    days_of_week names the day the deal STARTS on, so it is live during the
    //    evening of a listed day (t >= start) OR during the early morning of the
    //    NEXT day — i.e. when the previous day ((dayOfWeek + 6) % 7) is listed
    //    AND t <= end
    if (end === "00:00:00" && start > "00:00:00") {
      return onDay && t >= start;
    } else if (start > end) {
      const previousDay = (dayOfWeek + 6) % 7;
      return (
        (onDay && t >= start) ||
        (hh.days_of_week.includes(previousDay) && t <= end)
      );
    } else {
      return onDay && t >= start && t <= end;
    }
  });
}

export function filterByTags(
  happyHours: HappyHour[],
  selectedTags: string[]
): HappyHour[] {
  if (selectedTags.length === 0) return happyHours;
  return happyHours.filter(
    (hh) => hh.tags && hh.tags.some((t) => selectedTags.includes(t))
  );
}
