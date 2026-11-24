import { describe, it, expect } from "vitest";
import { describeNextDeal, findNextDeal } from "@/lib/next-deal";
import type { HappyHour } from "@/lib/api-types";

function hh(id: string, days: number[], start: string, end: string): HappyHour {
  return { id, venue_id: "v", days_of_week: days, start_time: start, end_time: end, description: id, tags: null, is_active: true };
}

// Days: 0=Sun … 6=Sat. 2 = Tuesday.
describe("findNextDeal", () => {
  it("finds a deal later the same day", () => {
    const n = findNextDeal([hh("a", [2], "19:00:00", "21:00:00")], 2, "17:00");
    expect(n).toMatchObject({ daysAhead: 0, day: 2 });
    expect(n?.deal.id).toBe("a");
  });

  it("looks forward through the week in order", () => {
    const deals = [hh("fri", [5], "16:00:00", "18:00:00"), hh("thu", [4], "17:00:00", "18:00:00")];
    expect(findNextDeal(deals, 2, "20:00")).toMatchObject({ daysAhead: 2, day: 4 });
  });

  it("wraps into next week", () => {
    // Monday-only deal seen from Tuesday: six days ahead.
    expect(findNextDeal([hh("mon", [1], "16:00:00", "18:00:00")], 2, "12:00")).toMatchObject({ daysAhead: 6, day: 1 });
    // Sunday 11 pm, deal on Mondays: tomorrow.
    expect(findNextDeal([hh("mon", [1], "16:00:00", "18:00:00")], 0, "23:00")).toMatchObject({ daysAhead: 1, day: 1 });
  });

  it("treats a deal that already started today as next week's", () => {
    expect(findNextDeal([hh("a", [2], "16:00:00", "17:00:00")], 2, "18:00")).toMatchObject({ daysAhead: 7, day: 2 });
  });

  it("does not count a deal starting exactly now as next", () => {
    expect(findNextDeal([hh("a", [2], "17:00:00", "18:00:00")], 2, "17:00")).toMatchObject({ daysAhead: 7 });
  });

  it("picks the earliest start when several are on the same day", () => {
    const deals = [hh("late", [3], "20:00:00", "22:00:00"), hh("early", [3], "16:00:00", "18:00:00")];
    expect(findNextDeal(deals, 2, "20:00")?.deal.id).toBe("early");
  });

  it("returns null when nothing has days", () => {
    expect(findNextDeal([], 2, "17:00")).toBeNull();
    expect(findNextDeal([hh("a", [], "16:00:00", "18:00:00")], 2, "17:00")).toBeNull();
  });
});

describe("describeNextDeal", () => {
  const fri = { deal: hh("a", [5], "16:00:00", "18:00:00"), daysAhead: 3, day: 5 };

  it("names the weekday", () => {
    expect(describeNextDeal(fri, true)).toBe("Fri 4–6 pm");
  });

  it("says today and tomorrow only when the selection is today", () => {
    expect(describeNextDeal({ ...fri, daysAhead: 0 }, true)).toBe("today 4–6 pm");
    expect(describeNextDeal({ ...fri, daysAhead: 1 }, true)).toBe("tomorrow 4–6 pm");
    expect(describeNextDeal({ ...fri, daysAhead: 1 }, false)).toBe("Fri 4–6 pm");
  });

  it("flags a deal a full week away", () => {
    expect(describeNextDeal({ ...fri, daysAhead: 7 }, true)).toBe("Fri 4–6 pm next week");
  });

  it("uses the shared all day and late wording", () => {
    expect(describeNextDeal({ ...fri, deal: hh("a", [5], "00:00:00", "23:59:00") }, false)).toBe("Fri all day");
    expect(describeNextDeal({ ...fri, deal: hh("a", [5], "17:00:00", "23:59:00") }, false)).toBe("Fri 5 pm–late");
  });
});
