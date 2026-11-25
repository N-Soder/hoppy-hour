import { describe, it, expect } from "vitest";
import {
  MIN_PLACE_QUERY,
  enterTarget,
  moveActive,
  normalise,
  parsePlaces,
  rankVenues,
  suggestionDomId,
  suggestionOrder,
  suggestionSummary,
  wantsPlaces,
  type PlaceSuggestion,
  type VenueSuggestion,
} from "@/lib/search-suggestions";

const venues = [
  { id: "1", name: "The Bar Next Door", address: "1 Hay St, Perth", distance_meters: 900 },
  { id: "2", name: "Barrack Street Beer", address: "2 Barrack St, Perth", distance_meters: 300 },
  { id: "3", name: "Bar", address: "3 Murray St, Perth", distance_meters: 1200 },
  { id: "4", name: "Café Sofia", address: "4 Barlee St, Mount Lawley", distance_meters: 100 },
  { id: "5", name: "Sneaky Barista", address: "5 King St, Perth", distance_meters: 50 },
  { id: "6", name: "Ezra Pound", address: "189 William St, Northbridge", distance_meters: 400 },
];

describe("rankVenues", () => {
  it("ranks the whole name, then its start, a word's start, anywhere in the name, then the address", () => {
    expect(rankVenues(venues, "bar", 10).map((v) => v.name)).toEqual([
      "Bar", // whole name
      "Barrack Street Beer", // name starts with it
      "Sneaky Barista", // a word starts with it (50 m)
      "The Bar Next Door", // a word starts with it (900 m)
      "Café Sofia", // address only ("Barlee St")
    ]);
  });

  it("breaks ties by distance", () => {
    // "The Bar Next Door" (900 m) and "Sneaky Barista" (50 m) both match at a word start.
    const names = rankVenues(venues, "bar", 10).map((v) => v.name);
    expect(names.indexOf("Sneaky Barista")).toBeLessThan(names.indexOf("The Bar Next Door"));
  });

  it("ignores case and accents, and caps the count", () => {
    expect(rankVenues(venues, "CAFE")[0].name).toBe("Café Sofia");
    expect(rankVenues(venues, "st", 2)).toHaveLength(2);
    expect(rankVenues(venues, "   ")).toEqual([]);
    expect(rankVenues(venues, "zzz")).toEqual([]);
  });

  it("returns venue suggestions", () => {
    expect(rankVenues(venues, "ezra")).toEqual([{ kind: "venue", id: "6", name: "Ezra Pound", address: "189 William St, Northbridge" }]);
  });
});

describe("place lookups", () => {
  it("start at a minimum length, so short queries never reach the rate-limited endpoint", () => {
    expect(MIN_PLACE_QUERY).toBeGreaterThanOrEqual(3);
    expect(wantsPlaces("so")).toBe(false);
    expect(wantsPlaces("  so  ")).toBe(false);
    expect(wantsPlaces("sof")).toBe(true);
  });

  it("normalise collapses spaces and strips accents", () => {
    expect(normalise("  Ŝófia   City ")).toBe("sofia city");
  });
});

describe("parsePlaces", () => {
  const data = {
    features: [
      { id: "place.1", text: "Sofia", place_name: "Sofia, Sofia City, Bulgaria", place_type: ["place"], center: [23.3219, 42.6977] },
      { id: "place.2", text: "Sofia", place_name: "Sofia, Bulgaria", place_type: ["region"], center: [23.5, 42.6] },
      { id: "address.3", text: "Sofia Street", address: "12", place_name: "12 Sofia Street, Perth Western Australia 6000, Australia", place_type: ["address"], center: [115.8, -31.9] },
      { id: "place.1", text: "Sofia", place_name: "Sofia, Sofia City, Bulgaria", center: [23.3219, 42.6977] },
      { id: "bad", text: "No centre" },
      { id: "bad2", center: [1, 2] },
    ],
  };

  it("gives a name and its region/country so same-named places can be told apart", () => {
    const places = parsePlaces(data);
    expect(places.map((p) => [p.name, p.context])).toEqual([
      ["Sofia", "Sofia City, Bulgaria"],
      ["Sofia", "Bulgaria"],
      ["12 Sofia Street", "Perth Western Australia 6000, Australia"],
    ]);
    expect(places[0]).toMatchObject({ kind: "place", id: "place.1", lng: 23.3219, lat: 42.6977 });
  });

  it("skips duplicates and malformed features, and copes with errors", () => {
    expect(parsePlaces(data)).toHaveLength(3);
    expect(parsePlaces({ error: "Too many requests" })).toEqual([]);
    expect(parsePlaces(null)).toEqual([]);
    expect(parsePlaces(data, 1)).toHaveLength(1);
  });
});

describe("rows, keyboard and Enter", () => {
  const v: VenueSuggestion[] = [
    { kind: "venue", id: "a", name: "A", address: "" },
    { kind: "venue", id: "b", name: "B", address: "" },
  ];
  const p: PlaceSuggestion[] = [
    { kind: "place", id: "place.1", name: "Sofia", context: "Bulgaria", lng: 1, lat: 2 },
    { kind: "place", id: "place.2", name: "Sofia", context: "Sofia City", lng: 3, lat: 4 },
  ];
  const options = suggestionOrder(v, p);

  it("lists venues first, then places", () => {
    expect(options.map((o) => o.kind)).toEqual(["venue", "venue", "place", "place"]);
  });

  it("Enter picks the highlighted row, else the first place, else nothing", () => {
    expect(enterTarget(options, 1)).toBe(v[1]);
    expect(enterTarget(options, 3)).toBe(p[1]);
    expect(enterTarget(options, -1)).toBe(p[0]);
    expect(enterTarget(v, -1)).toBeNull();
    expect(enterTarget([], -1)).toBeNull();
  });

  it("arrow keys move through the rows and back to the input", () => {
    expect(moveActive(-1, 4, 1)).toBe(0);
    expect(moveActive(0, 4, 1)).toBe(1);
    expect(moveActive(3, 4, 1)).toBe(-1);
    expect(moveActive(-1, 4, -1)).toBe(3);
    expect(moveActive(0, 4, -1)).toBe(-1);
    expect(moveActive(-1, 0, 1)).toBe(-1);
  });

  it("gives every row a distinct, valid DOM id", () => {
    const ids = options.map((o) => suggestionDomId("list", o));
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(id).toMatch(/^[A-Za-z0-9_-]+$/));
  });

  it("summarises the results for screen readers", () => {
    expect(suggestionSummary(2, 5)).toBe("2 venues and 5 places.");
    expect(suggestionSummary(1, 1)).toBe("1 venue and 1 place.");
    expect(suggestionSummary(0, 0)).toBe("No matches.");
    expect(suggestionSummary(3, null)).toBe("3 venues. Looking up places.");
  });
});
