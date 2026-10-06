// City search + reverse geocoding for the submit form, via the same-origin
// /api/geocode Mapbox proxy. Distinct from lib/geocode.ts (which geocodes a
// full street address at admin-approval time) — this searches for cities to
// pick from, returning coordinates + ISO country up front.

export interface CityResult {
  /** City/town name, e.g. "Sofia". */
  city: string;
  /** First-level region/state if present, e.g. "Sofia-Grad" / "Texas". */
  region: string | null;
  /** ISO 3166-1 alpha-2 code from Mapbox's context short_code, e.g. "BG". */
  countryCode: string | null;
  /** Country name, e.g. "Bulgaria". */
  countryName: string | null;
  lat: number;
  lng: number;
  /** Full "Sofia, Sofia-Grad, Bulgaria" label for the dropdown row. */
  label: string;
}

interface MapboxContext {
  id: string;
  text: string;
  short_code?: string;
}
interface MapboxFeature {
  text: string;
  place_name?: string;
  center?: [number, number];
  context?: MapboxContext[];
  place_type?: string[];
}

function toCityResult(f: MapboxFeature): CityResult | null {
  if (!f.center) return null;
  const [lng, lat] = f.center;
  const ctx = f.context ?? [];
  const region = ctx.find((c) => c.id.startsWith("region"))?.text ?? null;
  const countryCtx = ctx.find((c) => c.id.startsWith("country"));
  const countryCode = countryCtx?.short_code ? countryCtx.short_code.toUpperCase() : null;
  const countryName = countryCtx?.text ?? null;
  return {
    city: f.text,
    region,
    countryCode,
    countryName,
    lat,
    lng,
    label: f.place_name ?? [f.text, region, countryName].filter(Boolean).join(", "),
  };
}

/**
 * Search cities matching `query` (type-ahead). Restricts to place/locality
 * types, biases ranking toward `proximity` ([lng, lat]) when provided, and
 * restricts results to `countryCode` (ISO 3166-1 alpha-2, e.g. "CA") when the
 * submit form's country picker has a selection.
 * Returns [] on empty query or any error — the caller falls back to free typing.
 */
export async function searchCities(
  query: string,
  proximity?: { lng: number; lat: number },
  countryCode?: string,
): Promise<CityResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const parts = [
    `q=${encodeURIComponent(q)}`,
    "types=place,locality",
    "autocomplete=true",
    "limit=8",
  ];
  if (proximity) parts.push(`proximity=${proximity.lng},${proximity.lat}`);
  if (countryCode) parts.push(`country=${encodeURIComponent(countryCode)}`);
  try {
    const res = await fetch(`/api/geocode?${parts.join("&")}`);
    const data = await res.json();
    if (!data?.features) return [];
    return (data.features as MapboxFeature[]).map(toCityResult).filter((r): r is CityResult => r !== null);
  } catch {
    return [];
  }
}

/** Reverse-geocode a coordinate to its city (for location-based prefill). */
export async function reverseGeocodeCity(lng: number, lat: number): Promise<CityResult | null> {
  try {
    const res = await fetch(`/api/geocode?q=${lng},${lat}&types=place,locality&limit=1`);
    const data = await res.json();
    const feature = (data?.features as MapboxFeature[] | undefined)?.[0];
    return feature ? toCityResult(feature) : null;
  } catch {
    return null;
  }
}
