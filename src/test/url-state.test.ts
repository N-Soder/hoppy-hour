import { describe, it, expect } from "vitest";
import {
  DEFAULT_URL_STATE,
  countActiveFilters,
  parseDateParam,
  parseHomeParams,
  serializeHomeParams,
  toDateParam,
  toQueryString,
} from "@/lib/url-state";

const parse = (qs: string) => parseHomeParams(new URLSearchParams(qs));

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
