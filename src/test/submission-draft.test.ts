import { describe, it, expect, beforeEach } from "vitest";
import {
  DRAFT_KEY,
  DRAFT_MAX_AGE_MS,
  DRAFT_VERSION,
  clearDraft,
  dealHasContent,
  describeDraft,
  formatSavedAt,
  isWorthKeeping,
  loadDraft,
  parseDraft,
  saveDraft,
  type DealDraft,
  type SubmissionDraft,
} from "@/lib/submission-draft";
import type { CityResult } from "@/lib/city-search";

const NOW = 1_700_000_000_000;

const sydney: CityResult = {
  city: "Sydney",
  region: "New South Wales",
  countryCode: "AU",
  countryName: "Australia",
  lat: -33.87,
  lng: 151.21,
  label: "Sydney, New South Wales, Australia",
};

const emptyDeal: DealDraft = {
  days_of_week: [],
  start_time: "",
  end_time: "",
  description: "",
  tags: [],
  activePreset: null,
  startMin: null,
  endMin: null,
};

const filledDeal: DealDraft = {
  days_of_week: [1, 2],
  start_time: "16:00",
  end_time: "18:00",
  description: "$6 house pints",
  tags: ["beer"],
  activePreset: "4-6",
  startMin: 960,
  endMin: 1080,
};

function draft(over: Partial<SubmissionDraft> = {}): SubmissionDraft {
  return {
    version: DRAFT_VERSION,
    savedAt: NOW,
    venue_name: "The Golden Tap",
    venue_address: "",
    country: "AU",
    city: "Sydney",
    selectedCity: sydney,
    deals: [filledDeal],
    openIndex: 0,
    ...over,
  };
}

describe("dealHasContent", () => {
  it("is false for an untouched deal", () => {
    expect(dealHasContent(emptyDeal)).toBe(false);
  });

  it("is true once days, a description or tags are set", () => {
    expect(dealHasContent({ ...emptyDeal, days_of_week: [3] })).toBe(true);
    expect(dealHasContent({ ...emptyDeal, description: "2-for-1" })).toBe(true);
    expect(dealHasContent({ ...emptyDeal, tags: ["wine"] })).toBe(true);
  });

  it("ignores whitespace-only descriptions", () => {
    expect(dealHasContent({ ...emptyDeal, description: "   " })).toBe(false);
  });
});

describe("isWorthKeeping", () => {
  it("keeps a draft with a venue name", () => {
    expect(isWorthKeeping(draft({ deals: [emptyDeal] }))).toBe(true);
  });

  it("keeps a draft with a filled deal but no venue name", () => {
    expect(isWorthKeeping(draft({ venue_name: "" }))).toBe(true);
  });

  it("keeps a draft with only a street address", () => {
    expect(
      isWorthKeeping(draft({ venue_name: "", venue_address: "123 Main St", deals: [emptyDeal] }))
    ).toBe(true);
  });

  // Country and city arrive on their own from the GPS/IP prefill, so a visitor
  // who merely opened the page must not be offered a restore banner later.
  it("discards a draft holding only passively prefilled location", () => {
    expect(isWorthKeeping(draft({ venue_name: "", deals: [emptyDeal] }))).toBe(false);
  });
});

describe("parseDraft", () => {
  it("accepts a well-formed draft", () => {
    expect(parseDraft(draft(), NOW)).toEqual(draft());
  });

  it("rejects non-objects", () => {
    expect(parseDraft(null, NOW)).toBeNull();
    expect(parseDraft("nope", NOW)).toBeNull();
    expect(parseDraft(42, NOW)).toBeNull();
  });

  it("rejects a draft from a different version", () => {
    expect(parseDraft({ ...draft(), version: 99 }, NOW)).toBeNull();
  });

  it("rejects a draft older than the max age", () => {
    const stale = draft({ savedAt: NOW - DRAFT_MAX_AGE_MS - 1 });
    expect(parseDraft(stale, NOW)).toBeNull();
  });

  it("keeps a draft right on the age boundary", () => {
    const edge = draft({ savedAt: NOW - DRAFT_MAX_AGE_MS });
    expect(parseDraft(edge, NOW)).not.toBeNull();
  });

  it("rejects a missing or non-numeric savedAt", () => {
    expect(parseDraft({ ...draft(), savedAt: "yesterday" }, NOW)).toBeNull();
    expect(parseDraft({ ...draft(), savedAt: Number.NaN }, NOW)).toBeNull();
  });

  it("rejects wrong types on the top-level string fields", () => {
    expect(parseDraft({ ...draft(), venue_name: 5 }, NOW)).toBeNull();
    expect(parseDraft({ ...draft(), country: null }, NOW)).toBeNull();
  });

  it("rejects an empty or oversized deal list", () => {
    expect(parseDraft({ ...draft(), deals: [] }, NOW)).toBeNull();
    const tooMany = Array.from({ length: 8 }, () => filledDeal);
    expect(parseDraft({ ...draft(), deals: tooMany, openIndex: 0 }, NOW)).toBeNull();
  });

  it("rejects a malformed deal", () => {
    const bad = { ...filledDeal, days_of_week: ["Mon"] };
    expect(parseDraft({ ...draft(), deals: [bad] }, NOW)).toBeNull();
  });

  it("rejects an openIndex outside the deal list", () => {
    expect(parseDraft({ ...draft(), openIndex: 3 }, NOW)).toBeNull();
    expect(parseDraft({ ...draft(), openIndex: -1 }, NOW)).toBeNull();
    expect(parseDraft({ ...draft(), openIndex: 0.5 }, NOW)).toBeNull();
  });

  it("drops a malformed city rather than the whole draft", () => {
    const parsed = parseDraft({ ...draft(), selectedCity: { city: "Sydney" } }, NOW);
    expect(parsed?.selectedCity).toBeNull();
    expect(parsed?.venue_name).toBe("The Golden Tap");
  });

  it("rejects a draft with nothing worth restoring", () => {
    expect(parseDraft(draft({ venue_name: "", deals: [emptyDeal] }), NOW)).toBeNull();
  });
});

describe("storage round-trip", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("saves and loads a draft", () => {
    saveDraft(draft());
    expect(loadDraft(NOW)).toEqual(draft());
  });

  it("clears any stored draft when there is nothing worth keeping", () => {
    saveDraft(draft());
    saveDraft(draft({ venue_name: "", deals: [emptyDeal] }));
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("returns null when nothing is stored", () => {
    expect(loadDraft(NOW)).toBeNull();
  });

  it("returns null for corrupt JSON instead of throwing", () => {
    window.localStorage.setItem(DRAFT_KEY, "{not json");
    expect(loadDraft(NOW)).toBeNull();
  });

  it("clearDraft removes the entry", () => {
    saveDraft(draft());
    clearDraft();
    expect(loadDraft(NOW)).toBeNull();
  });
});

describe("describeDraft", () => {
  it("names the venue and counts the filled deals", () => {
    const d = draft({ deals: [filledDeal, filledDeal, emptyDeal], openIndex: 0 });
    expect(describeDraft(d)).toBe("The Golden Tap · 2 deals");
  });

  it("uses the singular for one deal", () => {
    expect(describeDraft(draft())).toBe("The Golden Tap · 1 deal");
  });

  it("omits the venue when it hasn't been named", () => {
    expect(describeDraft(draft({ venue_name: "" }))).toBe("1 deal");
  });

  it("falls back when there is nothing to name", () => {
    expect(describeDraft(draft({ venue_name: "", deals: [emptyDeal] }))).toBe(
      "Unfinished submission"
    );
  });
});

describe("formatSavedAt", () => {
  it("reads as just now under a minute", () => {
    expect(formatSavedAt(NOW - 30_000, NOW)).toBe("just now");
  });

  it("uses singular and plural minutes", () => {
    expect(formatSavedAt(NOW - 60_000, NOW)).toBe("1 minute ago");
    expect(formatSavedAt(NOW - 4 * 60_000, NOW)).toBe("4 minutes ago");
  });

  it("switches to hours, then days", () => {
    expect(formatSavedAt(NOW - 60 * 60_000, NOW)).toBe("1 hour ago");
    expect(formatSavedAt(NOW - 5 * 60 * 60_000, NOW)).toBe("5 hours ago");
    expect(formatSavedAt(NOW - 26 * 60 * 60_000, NOW)).toBe("yesterday");
    expect(formatSavedAt(NOW - 3 * 24 * 60 * 60_000, NOW)).toBe("3 days ago");
  });

  it("treats a future timestamp as just now", () => {
    expect(formatSavedAt(NOW + 10_000, NOW)).toBe("just now");
  });
});
