// Pure decision logic for the submit form's passive location prefill.
// Kept out of the component so the (race-prone) rules are unit-testable.
//
// The prefill is *passive*: it only ever fills blanks and must never override a
// choice the user made. This matters on mobile, where geolocation is often
// already granted and its GPS fix resolves a beat AFTER load — late enough to
// arrive after the user has picked a country and, without these guards, force
// the city + country back to their physical location.
import type { CityResult } from "@/lib/city-search";

export interface LocationPrefillInput {
  /** Best-effort suggestion (country from IP, city from GPS if granted). */
  prefill: { countryCode: string | null; city: CityResult | null };
  /** True once the user has explicitly picked a country or city. */
  touched: boolean;
  /** The form's current country value ("" when unset). */
  currentCountry: string;
  /** Whether a city has already been chosen/prefilled. */
  hasSelectedCity: boolean;
  /** react-hook-form dirty flags for the two fields. */
  countryDirty: boolean;
  cityDirty: boolean;
}

export interface LocationPrefillPatch {
  /** Country code to apply, if any. */
  country?: string;
  /** City to apply, if any. */
  city?: CityResult;
}

/**
 * Decide what (if anything) the passive prefill should apply to the form.
 * Returns an empty patch once the user has touched the location fields, or when
 * doing so would overwrite an existing value.
 */
export function computeLocationPrefill(input: LocationPrefillInput): LocationPrefillPatch {
  const { prefill, touched, currentCountry, hasSelectedCity, countryDirty, cityDirty } = input;

  // The user is in control — never override an explicit pick.
  if (touched) return {};

  const patch: LocationPrefillPatch = {};

  if (prefill.countryCode && !currentCountry && !countryDirty) {
    patch.country = prefill.countryCode;
  }

  if (prefill.city && !hasSelectedCity && !cityDirty) {
    patch.city = prefill.city;
    // Only fill the country from the city when the user hasn't already set one
    // (and we're not already filling it above from the IP suggestion).
    if (prefill.city.countryCode && !currentCountry && patch.country === undefined) {
      patch.country = prefill.city.countryCode;
    }
  }

  return patch;
}
