import { describe, it, expect } from "vitest";
import { computeLocationPrefill } from "@/lib/location-prefill";
import type { CityResult } from "@/lib/city-search";

const auCity: CityResult = {
  city: "Eden",
  region: "New South Wales",
  countryCode: "AU",
  countryName: "Australia",
  lat: -37.06,
  lng: 149.9,
  label: "Eden, New South Wales, Australia",
};

const base = {
  prefill: { countryCode: null as string | null, city: null as CityResult | null },
  touched: false,
  currentCountry: "",
  hasSelectedCity: false,
  countryDirty: false,
  cityDirty: false,
};

describe("computeLocationPrefill", () => {
  it("fills country from the IP suggestion when nothing is set", () => {
    const patch = computeLocationPrefill({ ...base, prefill: { countryCode: "AU", city: null } });
    expect(patch).toEqual({ country: "AU" });
  });

  it("fills city and its country when both are blank", () => {
    const patch = computeLocationPrefill({ ...base, prefill: { countryCode: "AU", city: auCity } });
    expect(patch.city).toBe(auCity);
    expect(patch.country).toBe("AU");
  });

  it("applies nothing once the user has touched a location field", () => {
    const patch = computeLocationPrefill({
      ...base,
      touched: true,
      prefill: { countryCode: "AU", city: auCity },
    });
    expect(patch).toEqual({});
  });

  // The mobile race: user picked Canada, then a late GPS fix resolves to an
  // Australian city. The prefill must not drag the country back to AU.
  it("never overrides a country the user already selected", () => {
    const patch = computeLocationPrefill({
      ...base,
      currentCountry: "CA",
      prefill: { countryCode: "AU", city: auCity },
    });
    expect(patch.country).toBeUndefined();
  });

  it("does not re-fill a city once one is selected", () => {
    const patch = computeLocationPrefill({
      ...base,
      hasSelectedCity: true,
      prefill: { countryCode: "AU", city: auCity },
    });
    expect(patch.city).toBeUndefined();
  });

  it("skips fields the user has already made dirty", () => {
    const patch = computeLocationPrefill({
      ...base,
      countryDirty: true,
      cityDirty: true,
      prefill: { countryCode: "AU", city: auCity },
    });
    expect(patch).toEqual({});
  });
});
