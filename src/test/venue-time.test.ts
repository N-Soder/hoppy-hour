// Live/next/"today" in the venue's time zone. Every case names its zones
// explicitly, so the results don't depend on the machine running the tests.
import { describe, it, expect } from "vitest";
import {
  hhmm,
  instantOfWallClock,
  isValidTimeZone,
  offsetMinutes,
  sameClock,
  supportedTimeZones,
  wallClockAt,
  zoneLabel,
  zoneOrFallback,
} from "@/lib/zoned-time";
import { areaTimeZone, dealsOnAt, nextDealLabel, selectionInstant, venueClock } from "@/lib/venue-time";
import type { HappyHour } from "@/lib/api-types";

const PERTH = "Australia/Perth"; // UTC+8, no DST
const SYDNEY = "Australia/Sydney"; // UTC+10, UTC+11 from first Sunday of October to first Sunday of April
const BRISBANE = "Australia/Brisbane"; // UTC+10, no DST
const NEW_YORK = "America/New_York";

const at = (iso: string) => Date.parse(iso);
const FRI = 5;
const SAT = 6;

function deal(overrides: Partial<HappyHour>): HappyHour {
  return {
    id: "d",
    venue_id: "v",
    days_of_week: [FRI],
    start_time: "17:00:00",
    end_time: "19:00:00",
    description: "Deal",
    tags: [],
    is_active: true,
    ...overrides,
  };
}

describe("zone conversion", () => {
  it("reads one instant on clocks either side of a date boundary", () => {
    // Fri 27 Nov 2026 20:00 UTC
    const t = at("2026-11-27T20:00:00Z");
    expect(wallClockAt(t, PERTH)).toEqual({ year: 2026, month: 11, day: 28, hour: 4, minute: 0, weekday: SAT });
    expect(wallClockAt(t, SYDNEY)).toMatchObject({ day: 28, hour: 7, weekday: SAT });
    expect(wallClockAt(t, NEW_YORK)).toMatchObject({ day: 27, hour: 15, weekday: FRI });
  });

  it("reports midnight as hour 0", () => {
    expect(wallClockAt(at("2026-11-27T16:00:00Z"), PERTH)).toMatchObject({ day: 28, hour: 0, minute: 0 });
  });

  it("round-trips a wall clock to an instant across a month and year boundary", () => {
    const w = { year: 2027, month: 1, day: 1, hour: 0, minute: 30 };
    const t = instantOfWallClock(w, PERTH);
    expect(new Date(t).toISOString()).toBe("2026-12-31T16:30:00.000Z");
    expect(wallClockAt(t, PERTH)).toMatchObject(w);
  });

  it("follows Sydney's offset across the October DST jump", () => {
    expect(offsetMinutes(at("2026-10-03T15:59:00Z"), SYDNEY)).toBe(600);
    expect(offsetMinutes(at("2026-10-03T16:00:00Z"), SYDNEY)).toBe(660);
    // 1:59 am is followed by 3:00 am.
    expect(hhmm(wallClockAt(at("2026-10-03T15:59:00Z"), SYDNEY))).toBe("01:59");
    expect(hhmm(wallClockAt(at("2026-10-03T16:00:00Z"), SYDNEY))).toBe("03:00");
  });

  it("maps a time skipped by spring-forward past the jump, and a repeated time to its first occurrence", () => {
    // 2:30 am on 4 Oct 2026 does not exist in Sydney; it reads as 3:30 am.
    const gap = instantOfWallClock({ year: 2026, month: 10, day: 4, hour: 2, minute: 30 }, SYDNEY);
    expect(hhmm(wallClockAt(gap, SYDNEY))).toBe("03:30");
    // 2:30 am on 5 Apr 2026 happens twice; the first is still on daylight time (UTC+11).
    const overlap = instantOfWallClock({ year: 2026, month: 4, day: 5, hour: 2, minute: 30 }, SYDNEY);
    expect(new Date(overlap).toISOString()).toBe("2026-04-04T15:30:00.000Z");
    // Ordinary times either side of the jump round-trip.
    for (const w of [
      { year: 2026, month: 10, day: 4, hour: 1, minute: 45 },
      { year: 2026, month: 10, day: 4, hour: 17, minute: 0 },
      { year: 2026, month: 4, day: 5, hour: 17, minute: 0 },
    ]) {
      expect(wallClockAt(instantOfWallClock(w, SYDNEY), SYDNEY)).toMatchObject(w);
    }
  });

  it("compares clocks by offset at the moment, not by name", () => {
    expect(sameClock("Australia/Melbourne", SYDNEY, at("2026-11-27T08:00:00Z"))).toBe(true);
    expect(sameClock(BRISBANE, SYDNEY, at("2026-07-01T08:00:00Z"))).toBe(true); // winter: both +10
    expect(sameClock(BRISBANE, SYDNEY, at("2026-11-27T08:00:00Z"))).toBe(false); // summer: +10 vs +11
    expect(sameClock(PERTH, SYDNEY, at("2026-07-01T08:00:00Z"))).toBe(false);
  });

  it("names zones briefly", () => {
    expect(zoneLabel(PERTH)).toBe("Perth time");
    expect(zoneLabel(NEW_YORK)).toBe("New York time");
    expect(zoneLabel("America/Indiana/Indianapolis")).toBe("Indianapolis time");
    expect(zoneLabel("Etc/UTC")).toBe("UTC");
    expect(zoneLabel("Etc/GMT-8")).toBe("UTC+8");
    expect(zoneLabel("Etc/GMT+5")).toBe("UTC-5");
  });

  it("lists the browser's zones for the picker, sorted, with UTC and the current value", () => {
    const zones = supportedTimeZones("Asia/Calcutta");
    expect(zones).toContain(PERTH);
    expect(zones).toContain("UTC");
    expect(zones).toContain("Asia/Calcutta");
    expect([...zones].sort()).toEqual(zones);
    expect(supportedTimeZones("Nowhere/Land")).not.toContain("Nowhere/Land");
  });

  it("validates zones and falls back for unknown ones", () => {
    expect(isValidTimeZone(PERTH)).toBe(true);
    expect(isValidTimeZone("Nowhere/Land")).toBe(false);
    expect(zoneOrFallback(null, SYDNEY)).toBe(SYDNEY);
    expect(zoneOrFallback("Nowhere/Land", SYDNEY)).toBe(SYDNEY);
    expect(zoneOrFallback(PERTH, SYDNEY)).toBe(PERTH);
  });
});

describe("a Perth venue seen from Sydney", () => {
  // Fri 27 Nov 2026, 6 pm in Perth = 9 pm in Sydney (daylight time).
  const instant = at("2026-11-27T10:00:00Z");
  const happyHour = deal({ days_of_week: [FRI], start_time: "17:00:00", end_time: "19:00:00" });

  it("is live on Perth's clock and says so", () => {
    const clock = venueClock(PERTH, SYDNEY, instant, instant);
    expect(clock).toEqual({ zone: PERTH, day: FRI, time: "18:00", isToday: true, zoneNote: "Perth time" });
    expect(dealsOnAt([happyHour], clock)).toHaveLength(1);
  });

  it("would not be live on the viewer's clock (what the app did before)", () => {
    const viewerClock = venueClock(null, SYDNEY, instant, instant);
    expect(viewerClock).toMatchObject({ zone: SYDNEY, time: "21:00", zoneNote: null });
    expect(dealsOnAt([happyHour], viewerClock)).toHaveLength(0);
  });

  it("says nothing about the zone when the viewer is in Perth too", () => {
    expect(venueClock(PERTH, PERTH, instant, instant).zoneNote).toBeNull();
  });

  it("labels the next deal against Perth's today, not Sydney's", () => {
    // Sat 28 Nov 1 am in Sydney is still Fri 27 Nov 10 pm in Perth.
    const lateInSydney = at("2026-11-27T14:00:00Z");
    const clock = venueClock(PERTH, SYDNEY, lateInSydney, lateInSydney);
    expect(clock).toMatchObject({ day: FRI, time: "22:00", isToday: true });
    const late = deal({ days_of_week: [FRI], start_time: "23:00:00", end_time: "23:59:00" });
    const sat = deal({ id: "s", days_of_week: [SAT], start_time: "16:00:00", end_time: "18:00:00" });
    expect(nextDealLabel([late, sat], clock)).toBe("today 11 pm–late");
    expect(nextDealLabel([sat], clock)).toBe("tomorrow 4–6 pm");
  });
});

describe("deals that cross midnight, in the venue's zone", () => {
  const overnight = deal({ days_of_week: [FRI], start_time: "22:00:00", end_time: "02:00:00" });

  it("is on in the small hours of the next day at the venue", () => {
    // Sat 28 Nov 1 am in Perth = Sat 4 am in Sydney: over on Sydney's clock, on at the venue.
    const t = at("2026-11-27T17:00:00Z");
    const clock = venueClock(PERTH, SYDNEY, t, t);
    expect(clock).toMatchObject({ day: SAT, time: "01:00" });
    expect(dealsOnAt([overnight], clock)).toHaveLength(1);
    expect(dealsOnAt([overnight], venueClock(null, SYDNEY, t, t))).toHaveLength(0);
  });

  it("is on in the evening of the listed day and off after it ends", () => {
    const evening = venueClock(PERTH, SYDNEY, at("2026-11-27T15:00:00Z"), 0); // Fri 11 pm Perth
    expect(dealsOnAt([overnight], evening)).toHaveLength(1);
    const after = venueClock(PERTH, SYDNEY, at("2026-11-27T19:00:00Z"), 0); // Sat 3 am Perth
    expect(dealsOnAt([overnight], after)).toHaveLength(0);
  });

  it("crosses the Sydney DST jump correctly", () => {
    // Sat 3 Oct 2026 11 pm (+10) to Sun 4 Oct 2 am: 1:30 am Sunday is still standard time.
    const satNight = deal({ days_of_week: [SAT], start_time: "23:00:00", end_time: "03:00:00" });
    const t = instantOfWallClock({ year: 2026, month: 10, day: 4, hour: 1, minute: 30 }, SYDNEY);
    expect(new Date(t).toISOString()).toBe("2026-10-03T15:30:00.000Z");
    const clock = venueClock(SYDNEY, SYDNEY, t, t);
    expect(clock).toMatchObject({ day: 0, time: "01:30" });
    expect(dealsOnAt([satNight], clock)).toHaveLength(1);
  });
});

describe("the date/time filter", () => {
  it("is in the zone of the nearest venue with a known zone", () => {
    expect(areaTimeZone([{ timezone: null }, { timezone: PERTH }, { timezone: SYDNEY }], SYDNEY)).toBe(PERTH);
    expect(areaTimeZone([{ timezone: "Nowhere/Land" }], SYDNEY)).toBe(SYDNEY);
    expect(areaTimeZone([], NEW_YORK)).toBe(NEW_YORK);
  });

  it("turns a picked day and time into that moment in the area's zone", () => {
    const fri = new Date(2026, 10, 27); // a calendar day, read through its local getters
    expect(new Date(selectionInstant(fri, "17:00", PERTH)).toISOString()).toBe("2026-11-27T09:00:00.000Z");
    expect(new Date(selectionInstant(fri, "17:00", SYDNEY)).toISOString()).toBe("2026-11-27T06:00:00.000Z");
  });

  it("a picked 5 pm Friday in Perth finds Perth's 5 pm deal, wherever the viewer is", () => {
    const t = selectionInstant(new Date(2026, 10, 27), "17:30", PERTH);
    for (const viewer of [SYDNEY, NEW_YORK, PERTH]) {
      expect(dealsOnAt([deal({})], venueClock(PERTH, viewer, t, t))).toHaveLength(1);
    }
  });
});
