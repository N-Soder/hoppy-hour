// "Suggest an edit": open /submit pre-filled with a venue's details through
// URL parameters, and read them back on the form.
//
//   /submit?venue_name=Ezra+Pound&country=AU&city=Northbridge&address=189+William+St%2C+Northbridge+WA+6003&lat=-31.94&lng=115.85
import type { CityResult } from "./city-search";
import { countryByCode } from "./countries";

export interface VenuePrefill {
  venue_name: string;
  venue_address: string;
  country: string;
  city: string;
  /** Coordinates of the venue itself, used as the map pin. */
  lat: number | null;
  lng: number | null;
}

export interface PrefillSource {
  name: string;
  address: string;
  country: string | null;
  lat: number;
  lng: number;
}

/**
 * The suburb or town from an Australian/NZ/US-style address:
 * "189 William St, Northbridge WA 6003" → "Northbridge",
 * "1 Queen St, Auckland 1010" → "Auckland", "10 Main St, Austin, TX 78701" →
 * "Austin". Takes the last comma part that has letters once state codes and
 * postcodes are stripped. Empty when nothing sensible is left.
 */
export function cityFromAddress(address: string): string {
  const parts = address
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return "";
  for (let i = parts.length - 1; i >= 1; i--) {
    const cleaned = parts[i]
      // Postcodes (digits, or UK/CA alphanumerics like "SW1A 1AA" / "M5V 2T6").
      .replace(/\b\d{3,5}(-\d{4})?\b/g, "")
      .replace(/\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b/g, "")
      .replace(/\b[A-Z]\d[A-Z] ?\d[A-Z]\d\b/g, "")
      // State/region codes: 2–3 capital letters (WA, NSW, TX).
      .replace(/\b[A-Z]{2,3}\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (/[A-Za-z]/.test(cleaned) && !/^(Australia|New Zealand|USA|United States|United Kingdom|UK|Canada)$/i.test(cleaned)) {
      return cleaned;
    }
  }
  return "";
}

/** /submit link pre-filled with this venue's name, country, city and address. */
export function suggestEditUrl(v: PrefillSource): string {
  const p = new URLSearchParams();
  p.set("venue_name", v.name);
  if (v.country) p.set("country", v.country);
  const city = cityFromAddress(v.address);
  if (city) p.set("city", city);
  if (v.address) p.set("address", v.address);
  p.set("lat", v.lat.toFixed(5));
  p.set("lng", v.lng.toFixed(5));
  return `/submit?${p.toString()}`;
}

function clean(v: string | null, max: number): string {
  return (v ?? "").trim().slice(0, max);
}

/** Read a prefill from /submit's query string, or null when there is none. */
export function parseVenuePrefill(params: URLSearchParams): VenuePrefill | null {
  const venue_name = clean(params.get("venue_name"), 200);
  if (!venue_name) return null;
  const countryRaw = clean(params.get("country"), 2).toUpperCase();
  const country = countryByCode(countryRaw) ? countryRaw : "";
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const hasCoords =
    params.get("lat") !== null && params.get("lng") !== null &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  return {
    venue_name,
    venue_address: clean(params.get("address"), 500),
    country,
    city: clean(params.get("city"), 100),
    lat: hasCoords ? lat : null,
    lng: hasCoords ? lng : null,
  };
}

/**
 * The picked-city shape the form keeps for a prefill, so the submission
 * carries the venue's own coordinates as its map pin. Null without a city or
 * coordinates (the form then takes the city as typed text).
 */
export function prefillCity(p: VenuePrefill): CityResult | null {
  if (!p.city || p.lat === null || p.lng === null) return null;
  const countryName = countryByCode(p.country)?.name ?? null;
  return {
    city: p.city,
    region: null,
    countryCode: p.country || null,
    countryName,
    lat: p.lat,
    lng: p.lng,
    label: [p.city, countryName].filter(Boolean).join(", "),
  };
}
