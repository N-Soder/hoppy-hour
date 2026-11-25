import { describe, it, expect } from "vitest";
import { describeEmptyState, selectListState } from "@/lib/list-state";

const base = { locating: false, pending: false, isError: false, hasData: false, visibleCount: 0 };

describe("selectListState", () => {
  it("is loading while the location is unknown and the query is disabled", () => {
    expect(selectListState({ ...base, locating: true })).toBe("loading");
  });

  it("is loading while the first fetch runs", () => {
    expect(selectListState({ ...base, pending: true })).toBe("loading");
  });

  it("is an error when the fetch failed with nothing to show", () => {
    expect(selectListState({ ...base, isError: true })).toBe("error");
  });

  it("keeps showing stale data when a refresh fails", () => {
    expect(selectListState({ ...base, isError: true, hasData: true, visibleCount: 4 })).toBe("ready");
  });

  it("is empty when data arrived but nothing is visible", () => {
    expect(selectListState({ ...base, hasData: true, visibleCount: 0 })).toBe("empty");
  });

  it("is ready with venues to show", () => {
    expect(selectListState({ ...base, hasData: true, visibleCount: 2 })).toBe("ready");
  });
});

describe("describeEmptyState", () => {
  const empty = { searchQuery: "", tags: [], whenPhrase: null, radiusMeters: 5000, venuesInRadius: 0 };

  it("blames the radius when there are no venues in range", () => {
    const c = describeEmptyState(empty);
    expect(c.title).toBe("No venues within 5 km");
    expect(c.canClear).toBe(false);
  });

  it("does not talk about radius when a search hid every venue", () => {
    const c = describeEmptyState({ ...empty, searchQuery: "zzz", venuesInRadius: 12 });
    expect(c.title).toBe("No venues match “zzz”");
    expect(`${c.title} ${c.detail}`).not.toMatch(/radius|distance|km/i);
    expect(c.canClear).toBe(true);
  });

  it("names a picked place, and offers to clear it", () => {
    const c = describeEmptyState({ ...empty, placeName: "Sofia" });
    expect(c.title).toBe("No venues within 5 km of Sofia");
    expect(c.activeFilters).toEqual(["Near Sofia"]);
    expect(c.canClear).toBe(true);
  });

  it("offers to clear a non-default radius on its own", () => {
    const c = describeEmptyState({ ...empty, radiusMeters: 1000 });
    expect(c.title).toBe("No venues within 1 km");
    expect(c.activeFilters).toEqual(["Within 1 km"]);
    expect(c.canClear).toBe(true);
  });

  it("does not list the default radius as a filter", () => {
    const c = describeEmptyState({ ...empty, tags: ["beer"], venuesInRadius: 4 });
    expect(c.activeFilters).toEqual(["Beer"]);
  });

  it("names every active filter", () => {
    const c = describeEmptyState({
      ...empty,
      searchQuery: "  bar ",
      tags: ["beer", "food"],
      whenPhrase: "Sat 5:15 pm",
      radiusMeters: 3000,
      venuesInRadius: 3,
    });
    expect(c.activeFilters).toEqual(["“bar”", "Beer, Food", "Sat 5:15 pm", "Within 3 km"]);
  });
});
