import { describe, it, expect } from "vitest";
import {
  groupHappyHours,
  formatDayRange,
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

  it("formats all 7 days as Sun–Sat", () => {
    expect(formatDayRange([0, 1, 2, 3, 4, 5, 6])).toBe("Sun–Sat");
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

  it("does NOT wrap Sun+Sat as a range (only 2 days)", () => {
    // [0, 6] — two days, not a run of 3+
    expect(formatDayRange([0, 6])).toBe("Sun, Sat");
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
