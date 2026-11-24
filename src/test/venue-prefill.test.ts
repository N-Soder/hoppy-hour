import { describe, it, expect } from "vitest";
import { cityFromAddress, parseVenuePrefill, prefillCity, suggestEditUrl } from "@/lib/venue-prefill";

describe("cityFromAddress", () => {
  it("takes the suburb from an Australian address", () => {
    expect(cityFromAddress("189 William St, Northbridge WA 6003")).toBe("Northbridge");
    expect(cityFromAddress("334 Murray St, Perth WA 6000")).toBe("Perth");
    expect(cityFromAddress("Rear, 794 Hay Street, Wolf Ln, Perth WA 6000")).toBe("Perth");
  });
  it("handles NZ, US and UK shapes", () => {
    expect(cityFromAddress("1 Queen St, Auckland 1010")).toBe("Auckland");
    expect(cityFromAddress("10 Main St, Austin, TX 78701")).toBe("Austin");
    expect(cityFromAddress("1 High St, London SW1A 1AA, UK")).toBe("London");
  });
  it("is empty when there is no comma part to use", () => {
    expect(cityFromAddress("Shop 5")).toBe("");
    expect(cityFromAddress("")).toBe("");
  });
});

describe("suggestEditUrl → parseVenuePrefill", () => {
  const venue = { name: "Ezra Pound & Co", address: "189 William St, Northbridge WA 6003", country: "AU", lat: -31.947812, lng: 115.859401 };

  it("round-trips a venue through the URL", () => {
    const url = new URL(suggestEditUrl(venue), "https://example.test");
    expect(url.pathname).toBe("/submit");
    expect(parseVenuePrefill(url.searchParams)).toEqual({
      venue_name: "Ezra Pound & Co",
      venue_address: "189 William St, Northbridge WA 6003",
      country: "AU",
      city: "Northbridge",
      lat: -31.94781,
      lng: 115.8594,
    });
  });

  it("is null without a venue name", () => {
    expect(parseVenuePrefill(new URLSearchParams("country=AU"))).toBeNull();
  });

  it("drops an unknown country and bad coordinates", () => {
    const p = parseVenuePrefill(new URLSearchParams("venue_name=X&country=ZZ&lat=abc&lng=1"));
    expect(p).toMatchObject({ country: "", lat: null, lng: null });
  });

  it("builds a picked city carrying the venue's coordinates", () => {
    const p = parseVenuePrefill(new URL(suggestEditUrl(venue), "https://e.test").searchParams)!;
    expect(prefillCity(p)).toEqual({
      city: "Northbridge",
      region: null,
      countryCode: "AU",
      countryName: "Australia",
      lat: -31.94781,
      lng: 115.8594,
      label: "Northbridge, Australia",
    });
    expect(prefillCity({ ...p, lat: null })).toBeNull();
  });
});
