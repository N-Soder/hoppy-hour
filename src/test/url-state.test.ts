import { describe, it, expect } from "vitest";
import {
  DEFAULT_URL_STATE,
  clearedFilters,
  countActiveFilters,
  parseDateParam,
  parseHomeParams,
  parsePlaceParams,
  serializeHomeParams,
  toDateParam,
  toQueryString,
} from "@/lib/url-state";

const parse = (qs: string) => parseHomeParams(new URLSearchParams(qs));

describe("clearedFilters", () => {
  it("puts every filter back to its default, radius included, and cleans the URL", () => {
    const params = new URLSearchParams(
      "date=2026-11-28&time=17:30&radius=1000&place=Sofia&near=23.3219,42.6977&tags=beer,wine&q=bar&utm_source=x",
    );
    const cleared = clearedFilters(parseHomeParams(params));
    expect(cleared).toEqual(DEFAULT_URL_STATE);
    expect(countActiveFilters(cleared)).toBe(0);
    // Only the parameter the app does not own survives.
    expect(toQueryString(serializeHomeParams(cleared, params))).toBe("utm_source=x");
  });

  it("keeps the open venue and the map tab, which are not filters", () => {
    const cleared = clearedFilters(parse("venue=abc&radius=1000&view=map"));
    expect(toQueryString(serializeHomeParams(cleared))).toBe("venue=abc&view=map");
  });
});

describe("parseHomeParams", () => {
  it("gives the defaults for an empty query", () => {
    expect(parse("")).toEqual(DEFAULT_URL_STATE);
  });

  it("reads every field", () => {
    expect(parse("venue=abc-123&date=2026-11-28&time=17:30&radius=10000&tags=beer,wine&q=bar&view=map")).toEqual({
      venue: "abc-123",
      date: "2026-11-28",
      time: "17:30",
      radius: 10000,
      place: null,
      tags: ["beer", "wine"],
      q: "bar",
      view: "map",
    });
  });

  it("drops malformed values back to defaults", () => {
    expect(parse("venue=<script>&date=2026-02-30&time=25:00&radius=1234&tags=beer,nope,beer&view=globe")).toEqual({
      ...DEFAULT_URL_STATE,
      tags: ["beer"],
    });
  });
});

describe("chosen place", () => {
  const sofia = { name: "Sofia", lng: 23.3219, lat: 42.6977 };

  it("reads place and near together", () => {
    expect(parse("place=Sofia&near=23.3219,42.6977").place).toEqual(sofia);
    expect(parse("place=Sofia%2C+Bulgaria&near=-0.1276,51.5072").place).toEqual({ name: "Sofia, Bulgaria", lng: -0.1276, lat: 51.5072 });
  });

  it("drops one without the other, or a bad coordinate", () => {
    expect(parse("place=Sofia").place).toBeNull();
    expect(parse("near=23.3219,42.6977").place).toBeNull();
    expect(parse("place=Sofia&near=42.6977").place).toBeNull();
    expect(parse("place=Sofia&near=190,42").place).toBeNull();
    expect(parse("place=Sofia&near=23,95").place).toBeNull();
    expect(parse("place=Sofia&near=abc,def").place).toBeNull();
    expect(parse("place=%20%20&near=23,42").place).toBeNull();
  });

  it("cleans and caps the name", () => {
    expect(parsePlaceParams("  New\u0000  York \n", "1,2")).toEqual({ name: "New York", lng: 1, lat: 2 });
    expect(parsePlaceParams("x".repeat(300), "1,2")!.name).toHaveLength(100);
  });

  it("round-trips through the URL, readable, with five decimals", () => {
    const qs = toQueryString(serializeHomeParams({ ...DEFAULT_URL_STATE, place: { name: "Sofia, Bulgaria", lng: 23.321868123, lat: 42.697708 } }));
    expect(qs).toBe("place=Sofia,+Bulgaria&near=23.32187,42.69771");
    expect(parse(qs).place).toEqual({ name: "Sofia, Bulgaria", lng: 23.32187, lat: 42.69771 });
  });

  it("keeps existing links working: no place means the same state as before", () => {
    expect(parse("venue=abc&radius=1000&q=bar").place).toBeNull();
    expect(toQueryString(serializeHomeParams(parse("venue=abc&radius=1000&q=bar")))).toBe("venue=abc&radius=1000&q=bar");
  });

  it("counts as an active filter and is cleared with the others", () => {
    const state = { ...DEFAULT_URL_STATE, place: sofia };
    expect(countActiveFilters(state)).toBe(1);
    expect(clearedFilters(state).place).toBeNull();
  });
});

describe("serializeHomeParams", () => {
  it("leaves defaults out, so the plain address stays clean", () => {
    expect(serializeHomeParams(DEFAULT_URL_STATE).toString()).toBe("");
  });

  it("round-trips", () => {
    const qs = "venue=abc&date=2026-11-28&time=17%3A30&radius=1000&tags=food&q=pint+bar&view=map";
    expect(serializeHomeParams(parse(qs)).toString()).toBe(qs);
  });

  it("keeps parameters it does not own", () => {
    const out = serializeHomeParams({ ...DEFAULT_URL_STATE, radius: 3000 }, new URLSearchParams("utm_source=x&radius=1000"));
    expect(out.toString()).toBe("utm_source=x&radius=3000");
  });
});

describe("date params", () => {
  it("formats local dates", () => {
    expect(toDateParam(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
  it("rejects impossible dates", () => {
    expect(parseDateParam("2026-13-01")).toBeNull();
    expect(parseDateParam("2026-11-31")).toBeNull();
    expect(parseDateParam("2028-02-29")).toBe("2028-02-29");
  });
});

describe("countActiveFilters", () => {
  it("counts date/time once, radius, each tag and search", () => {
    expect(countActiveFilters(DEFAULT_URL_STATE)).toBe(0);
    expect(
      countActiveFilters({ ...DEFAULT_URL_STATE, date: "2026-11-28", time: "17:00", radius: 1000, tags: ["beer", "wine"], q: "x" }),
    ).toBe(5);
  });
});

describe("toQueryString", () => {
  it("keeps times and tag lists readable and still parseable", () => {
    const qs = toQueryString(serializeHomeParams({ ...DEFAULT_URL_STATE, time: "17:30", tags: ["beer", "wine"], q: "a&b" }));
    expect(qs).toBe("time=17:30&tags=beer,wine&q=a%26b");
    expect(parseHomeParams(new URLSearchParams(qs))).toMatchObject({ time: "17:30", tags: ["beer", "wine"], q: "a&b" });
  });
});
