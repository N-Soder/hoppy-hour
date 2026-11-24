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
  it("shows metres under 1km", () => {
    expect(formatDistance(950)).toBe("950m");
  });

  it("rounds fractional metres", () => {
    expect(formatDistance(999.4)).toBe("999m");
  });

  it("switches to km at exactly 1000m", () => {
    expect(formatDistance(1000)).toBe("1.0km");
  });

  it("rounds 1250m up to 1.3km (toFixed half-up)", () => {
    expect(formatDistance(1250)).toBe("1.3km");
  });

  it("keeps one decimal for long distances", () => {
    expect(formatDistance(12345)).toBe("12.3km");
  });
});
