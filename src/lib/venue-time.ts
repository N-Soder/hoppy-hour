// "Live now", "Next: Fri 4–6 pm" and "today" in each venue's own time zone.
//
// How the date/time filter reads when the viewer is somewhere else:
//
//  * The filter is in the time zone of the AREA BEING SEARCHED (the zone of
//    the venue nearest the search centre). Searching Perth from Sydney, the
//    default "now" shows Perth's date and time, and a picked "Fri 5 pm" means
//    5 pm Friday in Perth. The URL's ?date=&time= are read the same way, so a
//    shared link means the same thing wherever it is opened.
//  * That date and time is turned into one instant, and every venue is checked
//    at that instant on its own wall clock. Within one zone (the usual case)
//    that is just "5 pm Friday at the venue"; for a search area that spans a
//    border (Tweed Heads / Coolangatta in summer) each venue is still right
//    about what is on at that moment.
//  * A venue with no known zone (migration not applied, lookup failed) uses
//    the viewer's zone, which is how the app behaved before zones existed.
import { filterByDayAndTime } from "@/hooks/use-venues";
import { findNextDeal, describeNextDeal } from "./next-deal";
import type { HappyHour } from "./api-types";
import {
  hhmm,
  instantOfWallClock,
  sameClock,
  wallClockAt,
  zoneLabel,
  zoneOrFallback,
  type WallClock,
} from "./zoned-time";

/** A venue's wall clock at the selected instant. */
export interface VenueClock {
  zone: string;
  /** Weekday at the venue, 0=Sun…6=Sat. */
  day: number;
  /** "HH:MM" at the venue. */
  time: string;
  /** The selected moment falls on the venue's today (for "today"/"tomorrow" labels). */
  isToday: boolean;
  /** "Perth time" when the venue's clock reads differently from the viewer's; else null. */
  zoneNote: string | null;
}

function sameDate(a: WallClock, b: WallClock): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/**
 * The venue's clock at `instant` (the selection), compared with `now` for
 * "today", and with the viewer's zone for whether to point out the zone.
 */
export function venueClock(
  venueZone: string | null | undefined,
  viewerZone: string,
  instant: number,
  now: number,
): VenueClock {
  const zone = zoneOrFallback(venueZone, viewerZone);
  const at = wallClockAt(instant, zone);
  return {
    zone,
    day: at.weekday,
    time: hhmm(at),
    isToday: sameDate(at, wallClockAt(now, zone)),
    zoneNote: sameClock(zone, viewerZone, instant) ? null : zoneLabel(zone),
  };
}

/** The deals on at the venue's clock (midnight-crossing deals included). */
export function dealsOnAt(deals: HappyHour[], clock: VenueClock): HappyHour[] {
  return filterByDayAndTime(deals, clock.day, `${clock.time}:00`);
}

/** "today 7–9 pm", "Fri 4–6 pm"… for the venue's next deal after its clock, or null. */
export function nextDealLabel(deals: HappyHour[], clock: VenueClock): string | null {
  const next = findNextDeal(deals, clock.day, clock.time);
  return next ? describeNextDeal(next, clock.isToday) : null;
}

/**
 * The zone the filter is in: that of the first venue (nearest the search
 * centre; the API sorts by distance) with a known zone, else the viewer's.
 */
export function areaTimeZone(venues: { timezone?: string | null }[], viewerZone: string): string {
  for (const v of venues) {
    if (v.timezone) {
      const zone = zoneOrFallback(v.timezone, "");
      if (zone) return zone;
    }
  }
  return viewerZone;
}

/**
 * The instant a selected local Date (calendar day) and "HH:MM" name in the
 * area's zone. `date` is read through its local getters (a calendar day, as
 * the date picker and URL state hold it).
 */
export function selectionInstant(date: Date, time: string, areaZone: string): number {
  const [h, m] = time.split(":").map(Number);
  return instantOfWallClock(
    { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: h || 0, minute: m || 0 },
    areaZone,
  );
}
