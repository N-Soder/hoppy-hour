import { describe, it, expect, vi, afterEach } from "vitest";
import { geocodeAddress, normalizeAddress } from "@/lib/geocode";

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
