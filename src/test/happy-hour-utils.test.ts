import { describe, it, expect } from "vitest";
import {
  groupHappyHours,
  formatDayRange,
  groupByDaySet,
  ungroupHappyHour,
} from "@/lib/happy-hour-utils";
import type { HappyHour } from "@/hooks/use-venues";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeHH(overrides: Partial<HappyHour> = {}): HappyHour {
  return {
    id: "id-1",
    venue_id: "venue-1",
    days_of_week: [1],
    start_time: "17:00:00",
    end_time: "19:00:00",
    description: "Half-price beers",
    tags: ["beer"],
    is_active: true,
    ...overrides,
  };
}

// ─── formatDayRange ──────────────────────────────────────────────────────────

describe("formatDayRange", () => {
  it("returns empty string for empty array", () => {
    expect(formatDayRange([])).toBe("");
  });

  it("returns single day name", () => {
    expect(formatDayRange([3])).toBe("Wed");
  });

  it("returns two non-contiguous days comma-separated", () => {
    expect(formatDayRange([1, 3])).toBe("Mon, Wed");
  });

  it("returns two adjacent days comma-separated (< 3 run)", () => {
    expect(formatDayRange([1, 2])).toBe("Mon, Tue");
  });

  it("formats Mon–Fri as a range", () => {
    expect(formatDayRange([1, 2, 3, 4, 5])).toBe("Mon–Fri");
  });

  it("formats all 7 days as Every day", () => {
    expect(formatDayRange([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
  });

  it("lists days Monday-first, with Sunday last", () => {
    expect(formatDayRange([0, 3])).toBe("Wed, Sun");
  });

  it("formats a non-contiguous set in week order", () => {
    expect(formatDayRange([0, 2, 5])).toBe("Tue, Fri, Sun");
  });

  it("formats a six-day run that wraps the week", () => {
    expect(formatDayRange([2, 3, 4, 5, 6, 0])).toBe("Tue–Sun");
  });

  it("handles non-contiguous 3-day set with commas", () => {
    expect(formatDayRange([1, 3, 5])).toBe("Mon, Wed, Fri");
  });

  it("handles unsorted input", () => {
    expect(formatDayRange([5, 1, 3])).toBe("Mon, Wed, Fri");
  });

  // Fix #10: week-wrapping cases
  it("formats Fri–Sun wrap correctly", () => {
    expect(formatDayRange([5, 6, 0])).toBe("Fri–Sun");
  });

  it("formats Thu–Sun wrap correctly", () => {
    expect(formatDayRange([4, 5, 6, 0])).toBe("Thu–Sun");
  });

  it("formats Sat–Mon wrap correctly", () => {
    expect(formatDayRange([6, 0, 1])).toBe("Sat–Mon");
  });

  it("lists Sat+Sun weekend in week order (only 2 days, no range)", () => {
    // [0, 6] — two days, not a run of 3+
    expect(formatDayRange([0, 6])).toBe("Sat, Sun");
  });
});

// ─── groupHappyHours ─────────────────────────────────────────────────────────

describe("groupHappyHours", () => {
  it("returns empty array for empty input", () => {
    expect(groupHappyHours([])).toEqual([]);
  });

  it("groups identical deals across different days", () => {
    const mon = makeHH({ id: "a", days_of_week: [1] });
    const tue = makeHH({ id: "b", days_of_week: [2] });
    const result = groupHappyHours([mon, tue]);
    expect(result).toHaveLength(1);
    expect(result[0].days_of_week).toEqual([1, 2]);
    expect(result[0].ids).toEqual(["a", "b"]);
  });

  it("does NOT group deals with different times", () => {
    const a = makeHH({ id: "a", start_time: "17:00:00", end_time: "19:00:00" });
    const b = makeHH({ id: "b", start_time: "16:00:00", end_time: "18:00:00" });
    expect(groupHappyHours([a, b])).toHaveLength(2);
  });

  it("does NOT group deals with different descriptions", () => {
    const a = makeHH({ id: "a", description: "Half-price beers" });
    const b = makeHH({ id: "b", description: "Free wine" });
    expect(groupHappyHours([a, b])).toHaveLength(2);
  });

  it("does NOT group deals with different tags", () => {
    const a = makeHH({ id: "a", tags: ["beer"] });
    const b = makeHH({ id: "b", tags: ["wine"] });
    expect(groupHappyHours([a, b])).toHaveLength(2);
  });

  it("groups deals regardless of tag order", () => {
    const a = makeHH({ id: "a", tags: ["beer", "wine"], days_of_week: [1] });
    const b = makeHH({ id: "b", tags: ["wine", "beer"], days_of_week: [2] });
    const result = groupHappyHours([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].days_of_week).toEqual([1, 2]);
  });

  it("merges days sorted ascending", () => {
    const fri = makeHH({ id: "a", days_of_week: [5] });
    const mon = makeHH({ id: "b", days_of_week: [1] });
    const result = groupHappyHours([fri, mon]);
    expect(result[0].days_of_week).toEqual([1, 5]);
  });

  it("preserves insertion order for distinct groups", () => {
    const a = makeHH({ id: "a", description: "Beer deal" });
    const b = makeHH({ id: "b", description: "Wine deal" });
    const result = groupHappyHours([a, b]);
    expect(result[0].description).toBe("Beer deal");
    expect(result[1].description).toBe("Wine deal");
  });
});

// ─── ungroupHappyHour ────────────────────────────────────────────────────────

describe("ungroupHappyHour", () => {
  it("splits a multi-day group into per-day records", () => {
    const group = {
      ids: ["a", "b", "c"],
      venue_id: "venue-1",
      days_of_week: [1, 2, 3],
      start_time: "17:00:00",
      end_time: "19:00:00",
      description: "Happy hour",
      tags: ["beer"],
      is_active: true,
    };
    const result = ungroupHappyHour(group);
    expect(result).toHaveLength(3);
    expect(result[0].days_of_week).toEqual([1]);
    expect(result[1].days_of_week).toEqual([2]);
    expect(result[2].days_of_week).toEqual([3]);
    // All share same venue, time, description, tags
    result.forEach((r) => {
      expect(r.venue_id).toBe("venue-1");
      expect(r.start_time).toBe("17:00:00");
      expect(r.description).toBe("Happy hour");
    });
  });

  it("handles a single-day group", () => {
    const group = {
      ids: ["a"],
      venue_id: "v",
      days_of_week: [4],
      start_time: "12:00:00",
      end_time: "14:00:00",
      description: "Lunch special",
      tags: null,
      is_active: true,
    };
    const result = ungroupHappyHour(group);
    expect(result).toHaveLength(1);
    expect(result[0].days_of_week).toEqual([4]);
    expect(result[0].tags).toBeNull();
  });
});

// ─── groupByDaySet ───────────────────────────────────────────────────────────

describe("groupByDaySet", () => {
  const g = (days: number[], start: string, id: string) => ({
    ids: [id],
    venue_id: "v",
    days_of_week: days,
    start_time: start,
    end_time: "23:00:00",
    description: id,
    tags: null,
    is_active: true,
  });

  it("orders day groups Monday-first, with Sunday-only last", () => {
    const out = groupByDaySet([g([0], "17:00:00", "sun"), g([3], "17:00:00", "wed"), g([1], "17:00:00", "mon")]);
    expect(out.map((s) => s.deals[0].description)).toEqual(["mon", "wed", "sun"]);
  });

  it("puts a group containing Monday before a Tuesday-only group, even with Sunday in it", () => {
    const out = groupByDaySet([g([2], "17:00:00", "tue"), g([0, 1], "17:00:00", "sun-mon")]);
    expect(out.map((s) => s.deals[0].description)).toEqual(["sun-mon", "tue"]);
  });

  it("sorts deals in a group by start time", () => {
    const out = groupByDaySet([g([1], "18:00:00", "late"), g([1], "09:00:00", "early")]);
    expect(out[0].deals.map((d) => d.description)).toEqual(["early", "late"]);
  });
});
