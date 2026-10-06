import { describe, it, expect } from "vitest";
import { normalizeExtractedDeals, type ExtractedMenu } from "../../functions/_shared/extract";
import { MAX_DEALS_PER_SUBMISSION } from "@/lib/api-types";

const menu = (over: Partial<ExtractedMenu>): ExtractedMenu => ({
  venue_name: null,
  venue_address: null,
  deals: [],
  notes: null,
  ...over,
});

describe("normalizeExtractedDeals", () => {
  it("normalizes a clean extraction and auto-tags from the description", () => {
    const deals = normalizeExtractedDeals(
      menu({
        deals: [
          { days_of_week: [1, 2, 3, 4, 5], start_time: "16:00", end_time: "19:00", description: "$5 pints and house wine" },
        ],
      }),
    );
    expect(deals).toHaveLength(1);
    expect(deals[0].start_time).toBe("16:00:00");
    expect(deals[0].end_time).toBe("19:00:00");
    expect(deals[0].days_of_week).toEqual([1, 2, 3, 4, 5]);
    expect(deals[0].tags).toContain("beer");
    expect(deals[0].tags).toContain("wine");
  });

  it("falls back to placeholder times for unparseable times", () => {
    const deals = normalizeExtractedDeals(
      menu({ deals: [{ days_of_week: [], start_time: "late", end_time: "", description: "cheap cocktails" }] }),
    );
    expect(deals[0].start_time).toBe("00:00:00");
    expect(deals[0].end_time).toBe("00:00:00");
    expect(deals[0].days_of_week).toEqual([]);
  });

  it("drops invalid day values and dedupes/sorts the rest", () => {
    const deals = normalizeExtractedDeals(
      menu({ deals: [{ days_of_week: [5, 1, 1, 9, -1, 2.5] as number[], start_time: "16:00", end_time: "18:00", description: "x" }] }),
    );
    expect(deals[0].days_of_week).toEqual([1, 5]);
  });

  it("caps at the per-submission deal limit", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      days_of_week: [1],
      start_time: "16:00",
      end_time: "18:00",
      description: `deal ${i}`,
    }));
    expect(normalizeExtractedDeals(menu({ deals: many }))).toHaveLength(MAX_DEALS_PER_SUBMISSION);
  });

  it("produces a single placeholder deal when nothing was extracted", () => {
    const deals = normalizeExtractedDeals(menu({}));
    expect(deals).toHaveLength(1);
    expect(deals[0].description).toBe("");
    expect(deals[0].days_of_week).toEqual([]);
  });

  it("truncates over-long descriptions to the column cap", () => {
    const deals = normalizeExtractedDeals(
      menu({ deals: [{ days_of_week: [1], start_time: "16:00", end_time: "18:00", description: "a".repeat(1500) }] }),
    );
    expect(deals[0].description).toHaveLength(1000);
  });
});
