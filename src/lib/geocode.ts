export type Coords = { lat: number; lng: number };
export type GeocodeResult = { coords: Coords | null; country: string | null };

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

/**
 * Geocodes an address, trying up to three strategies in order:
 * 1. Normalised address (strips "Corner", converts "and" → "&")
 * 2. Raw address as submitted
 * 3. Name + normalised address (last resort) — skipped when the name is
 *    empty, since a ", address" query breaks Mapbox.
 */
export async function geocodeAddress(
  name: string,
  address: string
): Promise<GeocodeResult> {
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
        `/api/geocode?q=${encodeURIComponent(query)}`
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
        const context: Array<{ id: string; text: string }> = feature.context ?? [];
        const countryName = context.find((c) => c.id.startsWith("country"))?.text ?? null;
        const country = countryName ? (MAPBOX_COUNTRY_TO_CODE[countryName] ?? null) : null;
        return { coords: { lat, lng }, country };
      }
    } catch (err) {
      // Re-throw Mapbox API errors (token issues) — don't swallow them
      if (err instanceof Error && err.message.startsWith("Mapbox error:")) throw err;
      // Otherwise it's a network error — try the next query
    }
  }

  return { coords: null, country: null };
}
