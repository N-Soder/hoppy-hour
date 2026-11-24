import { describe, it, expect } from "vitest";
import {
  describeSelection,
  endsLate,
  formatClock,
  formatDistance,
  formatTimeRange,
  isAllDay,
  plural,
  toMinutes,
} from "@/lib/format";

describe("toMinutes", () => {
  it("parses HH:MM:SS and HH:MM", () => {
    expect(toMinutes("17:30:00")).toBe(1050);
    expect(toMinutes("17:30")).toBe(1050);
  });

  it("wraps picker minutes past midnight", () => {
    expect(toMinutes(1500)).toBe(60);
  });
});

describe("formatClock", () => {
  it("drops :00", () => {
    expect(formatClock("17:00:00")).toBe("5 pm");
  });

  it("keeps non-zero minutes", () => {
    expect(formatClock("17:30")).toBe("5:30 pm");
  });

  it("maps midnight to 12 am and noon to 12 pm", () => {
    expect(formatClock("00:00:00")).toBe("12 am");
    expect(formatClock("12:00:00")).toBe("12 pm");
    expect(formatClock("12:30:00")).toBe("12:30 pm");
  });

  it("drops the leading zero from morning hours", () => {
    expect(formatClock("09:05:00")).toBe("9:05 am");
  });

  it("accepts minutes since midnight, including past-midnight picker values", () => {
    expect(formatClock(1020)).toBe("5 pm");
    expect(formatClock(1530)).toBe("1:30 am");
  });
});

describe("formatTimeRange", () => {
  it("shares the meridiem when both ends match", () => {
    expect(formatTimeRange("17:00:00", "18:00:00")).toBe("5–6 pm");
  });

  it("keeps minutes where they are not zero", () => {
    expect(formatTimeRange("16:30", "18:45")).toBe("4:30–6:45 pm");
  });

  it("repeats the meridiem when the ends differ", () => {
    expect(formatTimeRange("11:30:00", "14:00:00")).toBe("11:30 am–2 pm");
  });

  it("reads noon to 1 pm as one meridiem", () => {
    expect(formatTimeRange("12:00", "13:00")).toBe("12–1 pm");
  });

  it("formats a deal that crosses midnight", () => {
    expect(formatTimeRange("22:00:00", "02:00:00")).toBe("10 pm–2 am");
  });

  it("formats a deal that ends at midnight", () => {
    expect(formatTimeRange("21:00:00", "00:00:00")).toBe("9 pm–12 am");
  });

  it("repeats the meridiem on a same-meridiem midnight crossing", () => {
    expect(formatTimeRange("23:00", "22:00")).toBe("11 pm–10 pm");
  });

  it("calls 00:00–23:59 All day", () => {
    expect(formatTimeRange("00:00:00", "23:59:00")).toBe("All day");
    expect(formatTimeRange("00:00", "23:59:59")).toBe("All day");
  });

  it("reads a 23:59 end as late", () => {
    expect(formatTimeRange("17:00:00", "23:59:00")).toBe("5 pm–late");
    expect(formatTimeRange("11:30", "23:59")).toBe("11:30 am–late");
    expect(formatTimeRange(1020, 1439)).toBe("5 pm–late");
  });

  it("accepts picker minutes", () => {
    expect(formatTimeRange(1320, 1500)).toBe("10 pm–1 am");
  });
});

describe("endsLate", () => {
  it("is true only for a 23:59 end, in any stored form", () => {
    expect(endsLate("23:59")).toBe(true);
    expect(endsLate("23:59:00")).toBe(true);
    expect(endsLate("23:59:59")).toBe(true);
    expect(endsLate(1439)).toBe(true);
    expect(endsLate("23:58")).toBe(false);
    expect(endsLate("00:00")).toBe(false);
  });

  it("only 23:59 reads late; a minute earlier is a clock time", () => {
    expect(formatTimeRange("22:00", "23:59")).toBe("10 pm–late");
    expect(formatTimeRange("17:00", "23:58")).toBe("5–11:58 pm");
  });
});

describe("isAllDay", () => {
  it("is false for a long but partial day", () => {
    expect(isAllDay("00:00", "23:00")).toBe(false);
    expect(isAllDay("11:00", "23:59")).toBe(false);
  });
});

describe("plural", () => {
  it("uses the singular for one", () => {
    expect(plural(1, "deal")).toBe("1 deal");
    expect(plural(0, "deal")).toBe("0 deals");
    expect(plural(3, "venue")).toBe("3 venues");
  });
});

describe("describeSelection", () => {
  // Monday 24 Nov 2025, 5:10 pm local
  const now = new Date(2025, 10, 24, 17, 10);

  it("is live when the filter is the present moment", () => {
    expect(describeSelection(new Date(2025, 10, 24, 9, 0), "17:15", now)).toEqual({
      isNow: true,
      badge: "Live",
      phrase: "now",
    });
  });

  it("is not live at another time today", () => {
    const s = describeSelection(new Date(2025, 10, 24), "19:00", now);
    expect(s.isNow).toBe(false);
    expect(s.badge).toBe("On at 7 pm");
    expect(s.phrase).toBe("at 7 pm");
  });

  it("names the weekday for a day later this week", () => {
    const s = describeSelection(new Date(2025, 10, 29), "17:15", now);
    expect(s.isNow).toBe(false);
    expect(s.badge).toBe("On Sat 5:15 pm");
    expect(s.phrase).toBe("Sat 5:15 pm");
  });

  it("adds the date for a day a week or more away", () => {
    expect(describeSelection(new Date(2025, 11, 1), "17:00", now).badge).toBe("On Mon 1 Dec 5 pm");
  });

  it("adds the date for a past day", () => {
    expect(describeSelection(new Date(2025, 10, 23), "17:00", now).badge).toBe("On Sun 23 Nov 5 pm");
  });

  it("is not live on the same time on another day", () => {
    expect(describeSelection(new Date(2025, 10, 25), "17:15", now).isNow).toBe(false);
  });
});

describe("formatDistance", () => {
  // A no-break space between number and unit.
  const sp = "\u00a0";

  it("shows whole metres under 1 km", () => {
    expect(formatDistance(340, "en-AU")).toBe(`340${sp}m`);
    expect(formatDistance(0, "en-AU")).toBe(`0${sp}m`);
  });

  it("rounds fractional metres", () => {
    expect(formatDistance(999.4, "en-AU")).toBe(`999${sp}m`);
  });

  it("moves to km when the metres round up to 1000", () => {
    expect(formatDistance(999.6, "en-AU")).toBe(`1.0${sp}km`);
    expect(formatDistance(1000, "en-AU")).toBe(`1.0${sp}km`);
  });

  it("keeps one decimal up to 10 km", () => {
    expect(formatDistance(1250, "en-AU")).toBe(`1.3${sp}km`);
    expect(formatDistance(4500, "en-AU")).toBe(`4.5${sp}km`);
    expect(formatDistance(9940, "en-AU")).toBe(`9.9${sp}km`);
  });

  it("shows whole kilometres from 10 km, never 10.0", () => {
    expect(formatDistance(9960, "en-AU")).toBe(`10${sp}km`);
    expect(formatDistance(12345, "en-AU")).toBe(`12${sp}km`);
  });

  it("uses the locale's thousands separator for long distances", () => {
    expect(formatDistance(12_528_400, "en-AU")).toBe(`12,528${sp}km`);
    expect(formatDistance(12_528_400, "de-DE")).toBe(`12.528${sp}km`);
  });

  it("uses the locale's decimal separator", () => {
    expect(formatDistance(4500, "de-DE")).toBe(`4,5${sp}km`);
  });

  it("treats a missing or negative distance as zero", () => {
    expect(formatDistance(Number.NaN, "en-AU")).toBe(`0${sp}m`);
    expect(formatDistance(-5, "en-AU")).toBe(`0${sp}m`);
  });
});
