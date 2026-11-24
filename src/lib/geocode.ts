export type Coords = { lat: number; lng: number };
export type GeocodeResult = { coords: Coords | null; country: string | null };

import { COUNTRIES } from "./countries";

/** Legacy name map; kept for callers. countryCodeFromContext covers every country. */
export const MAPBOX_COUNTRY_TO_CODE: Record<string, string> = {
  "Australia": "AU",
  "New Zealand": "NZ",
  "United States": "US",
  "United Kingdom": "GB",
  "Canada": "CA",
};

/**
 * Normalises "Corner X and, Y" / "Corner of X and Y" style addresses into
 * an intersection format that Mapbox can parse (e.g. "X & Y, suburb state").
 */
export function normalizeAddress(address: string): string {
  return address
    .replace(/^corner\s+of\s+/i, "")   // "Corner of Barrack St and …"
    .replace(/^corner\s+/i, "")         // "Corner Barrack St and …"
    .replace(/\s+and,\s*/gi, " & ")     // "Barrack St and, St Georges Tce" → "& "
    .replace(/\s+and\s+/gi, " & ")      // "Barrack St and St Georges Tce"
    .trim();
}

type MapboxContext = { id: string; text: string; short_code?: string };

/**
 * ISO 3166-1 alpha-2 code for a Mapbox feature's country. Prefers the
 * context's short_code ("de" → "DE"), which Mapbox sets for every country,
 * then falls back to matching the English name against the full country list.
 * Returns null rather than guessing.
 */
export function countryCodeFromContext(context: MapboxContext[] | undefined): string | null {
  const entry = (context ?? []).find((c) => c.id.startsWith("country"));
  if (!entry) return null;
  if (entry.short_code && /^[a-z]{2}$/i.test(entry.short_code)) return entry.short_code.toUpperCase();
  const byName =
    MAPBOX_COUNTRY_TO_CODE[entry.text] ??
    COUNTRIES.find((c) => c.name.toLowerCase() === entry.text.toLowerCase())?.code;
  return byName ?? null;
}

/**
 * Geocodes an address, trying up to three strategies in order:
 * 1. Normalised address (strips "Corner", converts "and" → "&")
 * 2. Raw address as submitted
 * 3. Name + normalised address (last resort) — skipped when the name is
 *    empty, since a ", address" query breaks Mapbox.
 */
export async function geocodeAddress(
  name: string,
  address: string,
  /**
   * ISO code of the country the place is in, when known. Sent to the proxy so
   * the search is restricted to it instead of the deployment's default
   * GEOCODE_COUNTRY (which would bias every lookup toward one country).
   */
  country?: string | null,
): Promise<GeocodeResult> {
  const countryParam = country && /^[a-z]{2}$/i.test(country) ? `&country=${country.toUpperCase()}` : "";
  const normalized = normalizeAddress(address.trim());
  const trimmedName = name.trim();
  // Deduplicate so we don't hit the API twice with the same string
  const queries = [...new Set([
    normalized,
    address.trim(),
    ...(trimmedName ? [`${trimmedName}, ${normalized}`] : []),
  ])].filter(Boolean);

  for (const query of queries) {
    if (!query) continue;
    try {
      const res = await fetch(
        `/api/geocode?q=${encodeURIComponent(query)}${countryParam}`
      );
      const data = await res.json();

      // If the /api/geocode proxy surfaced a Mapbox API error (bad token, URL restriction, etc.)
      // throw immediately — retrying other queries won't help.
      if (data?.error && !data?.features) {
        console.error("[geocode] Mapbox API error:", data.error, data.mapbox);
        throw new Error(`Mapbox error: ${data.error}`);
      }

      const feature = data?.features?.[0];
      if (feature?.center) {
        const [lng, lat] = feature.center;
        return { coords: { lat, lng }, country: countryCodeFromContext(feature.context) };
      }
    } catch (err) {
      // Re-throw Mapbox API errors (token issues) — don't swallow them
      if (err instanceof Error && err.message.startsWith("Mapbox error:")) throw err;
      // Otherwise it's a network error — try the next query
    }
  }

  return { coords: null, country: null };
}
