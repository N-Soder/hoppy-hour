import { describe, it, expect } from "vitest";
import { filterByDayAndTime, filterByTags } from "@/hooks/use-venues";
import type { HappyHour } from "@/hooks/use-venues";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeHH(overrides: Partial<HappyHour> = {}): HappyHour {
  return {
    id: "id-1",
    venue_id: "venue-1",
    days_of_week: [1], // Monday
    start_time: "17:00:00",
    end_time: "19:00:00",
    description: "Happy hour",
    tags: ["beer"],
    is_active: true,
    ...overrides,
  };
}

// ─── filterByDayAndTime ───────────────────────────────────────────────────────

describe("filterByDayAndTime", () => {
  // Normal (non-crossing) ranges
  it("includes a time exactly at start", () => {
    const hh = makeHH({ start_time: "17:00:00", end_time: "19:00:00", days_of_week: [1] });
    expect(filterByDayAndTime([hh], 1, "17:00:00")).toHaveLength(1);
  });

  it("includes a time exactly at end", () => {
    const hh = makeHH({ start_time: "17:00:00", end_time: "19:00:00", days_of_week: [1] });
    expect(filterByDayAndTime([hh], 1, "19:00:00")).toHaveLength(1);
  });

  it("includes a time in the middle of the range", () => {
    const hh = makeHH({ start_time: "17:00:00", end_time: "19:00:00", days_of_week: [1] });
    expect(filterByDayAndTime([hh], 1, "18:00:00")).toHaveLength(1);
  });

  it("excludes a time before start", () => {
    const hh = makeHH({ start_time: "17:00:00", end_time: "19:00:00", days_of_week: [1] });
    expect(filterByDayAndTime([hh], 1, "16:59:00")).toHaveLength(0);
  });

  it("excludes a time after end", () => {
    const hh = makeHH({ start_time: "17:00:00", end_time: "19:00:00", days_of_week: [1] });
    expect(filterByDayAndTime([hh], 1, "19:01:00")).toHaveLength(0);
  });

  it("excludes a matching time on the wrong day", () => {
    const hh = makeHH({ start_time: "17:00:00", end_time: "19:00:00", days_of_week: [1] });
    expect(filterByDayAndTime([hh], 2, "18:00:00")).toHaveLength(0); // Tuesday
  });

  it("includes when a happy hour spans multiple days and day matches", () => {
    const hh = makeHH({ days_of_week: [1, 2, 3] });
    expect(filterByDayAndTime([hh], 3, "18:00:00")).toHaveLength(1);
  });

  // Midnight-crossing ranges (e.g. 22:00–02:00)
  it("includes a time after start for midnight-crossing range", () => {
    const hh = makeHH({ start_time: "22:00:00", end_time: "02:00:00", days_of_week: [5] });
    expect(filterByDayAndTime([hh], 5, "23:00:00")).toHaveLength(1);
  });

  it("includes a time before end for midnight-crossing range (on the NEXT day)", () => {
    // Fix B1: a Friday 22:00–02:00 deal is live at 01:00 on SATURDAY morning
    const hh = makeHH({ start_time: "22:00:00", end_time: "02:00:00", days_of_week: [5] });
    expect(filterByDayAndTime([hh], 6, "01:00:00")).toHaveLength(1);
  });

  it("excludes the early morning of the START day for a midnight-crossing range", () => {
    // Fix B1: Friday 01:00 is the morning BEFORE the Friday-evening deal starts
    const hh = makeHH({ start_time: "22:00:00", end_time: "02:00:00", days_of_week: [5] });
    expect(filterByDayAndTime([hh], 5, "01:00:00")).toHaveLength(0);
  });

  it("excludes the evening of the day AFTER a midnight-crossing range", () => {
    // Fix B1: the deal spills into Saturday morning, not Saturday evening
    const hh = makeHH({ start_time: "22:00:00", end_time: "02:00:00", days_of_week: [5] });
    expect(filterByDayAndTime([hh], 6, "23:00:00")).toHaveLength(0);
  });

  it("wraps across the week boundary for a Saturday midnight-crossing range", () => {
    // Fix B1: a Saturday 22:00–02:00 deal is live at 01:00 on SUNDAY (day 0)
    const hh = makeHH({ start_time: "22:00:00", end_time: "02:00:00", days_of_week: [6] });
    expect(filterByDayAndTime([hh], 0, "01:00:00")).toHaveLength(1);
  });

  it("excludes a time in the gap of a midnight-crossing range", () => {
    const hh = makeHH({ start_time: "22:00:00", end_time: "02:00:00", days_of_week: [5] });
    expect(filterByDayAndTime([hh], 5, "12:00:00")).toHaveLength(0);
  });

  // Fix #11: end_time exactly at midnight must NOT trigger midnight-crossing logic
  it("does not treat end_time=00:00:00 as midnight-crossing (closes at midnight)", () => {
    const hh = makeHH({ start_time: "23:00:00", end_time: "00:00:00", days_of_week: [5] });
    // 11:30 PM is within range (before midnight)
    expect(filterByDayAndTime([hh], 5, "23:30:00")).toHaveLength(1);
    // Noon should NOT be included (would be included if wrongly treated as crossing)
    expect(filterByDayAndTime([hh], 5, "12:00:00")).toHaveLength(0);
    // 01:00 AM should NOT be included
    expect(filterByDayAndTime([hh], 5, "01:00:00")).toHaveLength(0);
  });

  it("filters multiple happy hours correctly", () => {
    const live = makeHH({ id: "live", start_time: "17:00:00", end_time: "19:00:00", days_of_week: [1] });
    const notLive = makeHH({ id: "notLive", start_time: "20:00:00", end_time: "22:00:00", days_of_week: [1] });
    const result = filterByDayAndTime([live, notLive], 1, "18:00:00");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("live");
  });
});

// ─── filterByTags ─────────────────────────────────────────────────────────────

describe("filterByTags", () => {
  it("returns all items when selectedTags is empty", () => {
    const hhs = [makeHH({ tags: ["beer"] }), makeHH({ id: "id-2", tags: ["wine"] })];
    expect(filterByTags(hhs, [])).toHaveLength(2);
  });

  it("filters to matching tag", () => {
    const beer = makeHH({ id: "a", tags: ["beer"] });
    const wine = makeHH({ id: "b", tags: ["wine"] });
    const result = filterByTags([beer, wine], ["beer"]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });

  it("includes items matching any of the selected tags (OR logic)", () => {
    const beer = makeHH({ id: "a", tags: ["beer"] });
    const wine = makeHH({ id: "b", tags: ["wine"] });
    const food = makeHH({ id: "c", tags: ["food"] });
    const result = filterByTags([beer, wine, food], ["beer", "wine"]);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("excludes items with null tags", () => {
    const noTags = makeHH({ id: "a", tags: null });
    expect(filterByTags([noTags], ["beer"])).toHaveLength(0);
  });

  it("includes items that have the tag plus others", () => {
    const multi = makeHH({ tags: ["beer", "food"] });
    expect(filterByTags([multi], ["food"])).toHaveLength(1);
  });

  it("returns empty when no items match", () => {
    const hh = makeHH({ tags: ["spirits"] });
    expect(filterByTags([hh], ["food"])).toHaveLength(0);
  });
});
