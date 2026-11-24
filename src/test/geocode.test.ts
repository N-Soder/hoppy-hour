import { describe, it, expect, vi, afterEach } from "vitest";
import { countryCodeFromContext, geocodeAddress, normalizeAddress } from "@/lib/geocode";

// Builds a fetch stub that returns the given JSON payloads in order,
// repeating the last one if more calls come in.
function stubFetchResponses(...payloads: unknown[]) {
  let call = 0;
  const mock = vi.fn(async () => {
    const payload = payloads[Math.min(call, payloads.length - 1)];
    call += 1;
    return { json: async () => payload };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

// Extracts the decoded geocode query string from a fetch call's URL
// (same-origin /api/geocode?q=<query>)
function queryOf(mock: ReturnType<typeof vi.fn>, callIndex: number): string {
  const url = mock.mock.calls[callIndex][0] as string;
  return decodeURIComponent(url.split("?q=")[1]);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("normalizeAddress", () => {
  it("converts 'Corner of X and Y' into an intersection", () => {
    expect(normalizeAddress("Corner of Barrack St and St Georges Tce")).toBe(
      "Barrack St & St Georges Tce"
    );
  });

  it("converts 'Corner X and, Y' into an intersection", () => {
    expect(normalizeAddress("Corner Barrack St and, St Georges Tce")).toBe(
      "Barrack St & St Georges Tce"
    );
  });

  it("passes plain addresses through trimmed", () => {
    expect(normalizeAddress("  123 Hay St, Perth WA  ")).toBe("123 Hay St, Perth WA");
  });
});

describe("geocodeAddress", () => {
  it("returns coords and mapped country code when the first query succeeds", async () => {
    const mock = stubFetchResponses({
      features: [
        {
          center: [115.8605, -31.9505],
          context: [
            { id: "locality.123", text: "Perth" },
            { id: "country.456", text: "Australia" },
          ],
        },
      ],
    });

    const result = await geocodeAddress("The Moon", "123 Hay St, Perth WA");

    expect(result).toEqual({ coords: { lat: -31.9505, lng: 115.8605 }, country: "AU" });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(queryOf(mock, 0)).toBe("123 Hay St, Perth WA");
  });

  it("passes on the match's type and full name so a town-only match can be told apart", async () => {
    stubFetchResponses({
      features: [{ center: [151.2, -33.8], place_type: ["place"], place_name: "Sydney, New South Wales, Australia" }],
    });
    expect(await geocodeAddress("", "12 Nowhere St, Madeupville")).toEqual({
      coords: { lat: -33.8, lng: 151.2 },
      country: null,
      placeType: "place",
      placeName: "Sydney, New South Wales, Australia",
    });
  });

  it("throws immediately when the geocode proxy surfaces a Mapbox API error", async () => {
    // Silence the diagnostic console.error the function emits on API errors
    vi.spyOn(console, "error").mockImplementation(() => {});
    const mock = stubFetchResponses({ error: "Not Authorized - Invalid Token" });

    await expect(geocodeAddress("The Moon", "123 Hay St, Perth WA")).rejects.toThrow(
      /^Mapbox error:/
    );
    // Retrying other queries won't fix a bad token — one call only
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("returns null coords and country when every query comes back empty", async () => {
    const mock = stubFetchResponses({ features: [] });

    const result = await geocodeAddress("The Moon", "Corner of Barrack St and St Georges Tce");

    expect(result).toEqual({ coords: null, country: null });
    // Normalised, raw, and name-prefixed queries — all three attempted
    expect(mock).toHaveBeenCalledTimes(3);
    expect(queryOf(mock, 0)).toBe("Barrack St & St Georges Tce");
    expect(queryOf(mock, 1)).toBe("Corner of Barrack St and St Georges Tce");
    expect(queryOf(mock, 2)).toBe("The Moon, Barrack St & St Georges Tce");
  });

  it("skips the name-prefixed query when the name is empty", async () => {
    const mock = stubFetchResponses({ features: [] });

    await geocodeAddress("", "Corner of Barrack St and St Georges Tce");

    // Only normalised + raw — a ", address" query would break Mapbox
    expect(mock).toHaveBeenCalledTimes(2);
    expect(queryOf(mock, 0)).toBe("Barrack St & St Georges Tce");
    expect(queryOf(mock, 1)).toBe("Corner of Barrack St and St Georges Tce");
  });
});

describe("geocodeAddress country handling", () => {
  it("maps any country via the context short_code, not only the five launch countries", async () => {
    stubFetchResponses({
      features: [
        {
          center: [13.405, 52.52],
          context: [
            { id: "place.1", text: "Berlin" },
            { id: "country.2", text: "Germany", short_code: "de" },
          ],
        },
      ],
    });
    expect(await geocodeAddress("", "Alexanderplatz 1, Berlin")).toEqual({
      coords: { lat: 52.52, lng: 13.405 },
      country: "DE",
    });
  });

  it("falls back to the full country list by name when short_code is missing", () => {
    expect(countryCodeFromContext([{ id: "country.9", text: "Japan" }])).toBe("JP");
    expect(countryCodeFromContext([{ id: "country.9", text: "Atlantis" }])).toBeNull();
    expect(countryCodeFromContext([{ id: "place.1", text: "Perth" }])).toBeNull();
  });

  it("restricts the search to a known country instead of the deployment default", async () => {
    const mock = stubFetchResponses({ features: [] });
    await geocodeAddress("", "Main St 1", "nz");
    expect(mock.mock.calls[0][0]).toContain("&country=NZ");
    await geocodeAddress("", "Main St 1");
    expect(mock.mock.calls.at(-1)?.[0]).not.toContain("country=");
  });
});
