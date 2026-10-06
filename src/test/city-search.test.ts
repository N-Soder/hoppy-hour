import { describe, it, expect, vi, afterEach } from "vitest";
import { searchCities, reverseGeocodeCity } from "@/lib/city-search";

function mockFetch(payload: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => payload }) as Response));
}

afterEach(() => vi.unstubAllGlobals());

const sofiaFeature = {
  text: "Sofia",
  place_name: "Sofia, Sofia-Grad, Bulgaria",
  center: [23.3219, 42.6977],
  context: [
    { id: "region.1", text: "Sofia-Grad" },
    { id: "country.1", text: "Bulgaria", short_code: "bg" },
  ],
};

describe("searchCities", () => {
  it("maps Mapbox features to city results with ISO country + coords", async () => {
    mockFetch({ features: [sofiaFeature] });
    const results = await searchCities("Sofia");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      city: "Sofia",
      region: "Sofia-Grad",
      countryCode: "BG",
      countryName: "Bulgaria",
      lat: 42.6977,
      lng: 23.3219,
      label: "Sofia, Sofia-Grad, Bulgaria",
    });
  });

  it("returns [] for short queries without calling the API", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await searchCities("a")).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("drops features without coordinates", async () => {
    mockFetch({ features: [{ text: "Nowhere", context: [] }] });
    expect(await searchCities("Nowhere")).toEqual([]);
  });

  it("returns [] on error payloads", async () => {
    mockFetch({ error: "Mapbox error" });
    expect(await searchCities("Sofia")).toEqual([]);
  });

  it("sends the selected country code to the geocode proxy", async () => {
    const spy = vi.fn(async () => ({ json: async () => ({ features: [] }) }) as Response);
    vi.stubGlobal("fetch", spy);
    await searchCities("Ed", undefined, "CA");
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("country=CA");
  });

  it("omits the country param when no country is selected", async () => {
    const spy = vi.fn(async () => ({ json: async () => ({ features: [] }) }) as Response);
    vi.stubGlobal("fetch", spy);
    await searchCities("Ed");
    const url = spy.mock.calls[0][0] as string;
    expect(url).not.toContain("country=");
  });
});

describe("reverseGeocodeCity", () => {
  it("resolves a coordinate to its city", async () => {
    mockFetch({ features: [sofiaFeature] });
    const r = await reverseGeocodeCity(23.3219, 42.6977);
    expect(r?.city).toBe("Sofia");
    expect(r?.countryCode).toBe("BG");
  });
});
