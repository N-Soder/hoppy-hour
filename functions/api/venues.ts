// GET /api/venues?lng=<num>&lat=<num>&radius=<meters>
// Venues and their active happy hours in one round trip. Bounding-box
// prefilter on the indexed lat/lng columns, exact haversine + sort in JS. Response: VenueWithHappyHours[].
import type { Env } from "../_shared/db";
import { rowToHappyHour } from "../_shared/db";
import { error, json } from "../_shared/http";
import type { HappyHour, VenueWithHappyHours } from "../../src/lib/api-types";

const EARTH_RADIUS_M = 6_371_000;
const KM_PER_DEG_LAT = 110.574; // ~constant
const KM_PER_DEG_LNG_EQ = 111.320; // at the equator; scale by cos(lat)
const MAX_RADIUS_M = 25_000; // UI max is 10 km (FiltersPanel) — cap generously

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  // Number(null) === 0 — reject absent params BEFORE coercion, or a bare
  // /api/venues would silently query (0,0) and return 200.
  const latRaw = url.searchParams.get("lat");
  const lngRaw = url.searchParams.get("lng");
  if (!latRaw?.trim() || !lngRaw?.trim()) {
    return error("lat and lng are required", 400);
  }
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  const radius = Number(url.searchParams.get("radius") || 5000);

  if (
    !Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radius) ||
    Math.abs(lat) > 85 || Math.abs(lng) > 180 || radius <= 0
  ) {
    return error("invalid lat/lng/radius", 400);
  }
  const radiusM = Math.min(radius, MAX_RADIUS_M);

  // Bounding box in degrees. |lat| <= 85 keeps cos(lat) well away from 0.
  const radiusKm = radiusM / 1000;
  const latDelta = radiusKm / KM_PER_DEG_LAT;
  const lngDelta = radiusKm / (KM_PER_DEG_LNG_EQ * Math.cos((lat * Math.PI) / 180));
  const minLat = lat - latDelta;
  const maxLat = lat + latDelta;
  const minLng = lng - lngDelta;
  const maxLng = lng + lngDelta;

  // Indexed prefilter + active happy hours in one round trip via LEFT JOIN.
  // (Antimeridian wrap ignored: data is AU/NZ/US/GB/CA.)
  const { results } = await env.DB.prepare(
    `SELECT v.id, v.name, v.address, v.country, v.lat, v.lng,
            h.id AS hh_id, h.venue_id AS hh_venue_id, h.days_of_week, h.start_time,
            h.end_time, h.description, h.tags, h.is_active
       FROM venues v
       LEFT JOIN happy_hours h ON h.venue_id = v.id AND h.is_active = 1
      WHERE v.status = 'active'
        AND v.lat BETWEEN ?1 AND ?2
        AND v.lng BETWEEN ?3 AND ?4`,
  ).bind(minLat, maxLat, minLng, maxLng).all<Record<string, unknown>>();

  const venues = new Map<string, VenueWithHappyHours>();
  for (const r of results ?? []) {
    const id = r.id as string;
    let v = venues.get(id);
    if (!v) {
      v = {
        id,
        name: r.name as string,
        address: r.address as string,
        country: (r.country as string | null) ?? null,
        lat: r.lat as number,
        lng: r.lng as number,
        distance_meters: haversineMeters(lat, lng, r.lat as number, r.lng as number),
        happy_hours: [],
      };
      venues.set(id, v);
    }
    if (r.hh_id) {
      const hh: HappyHour = rowToHappyHour({
        id: r.hh_id,
        venue_id: r.hh_venue_id,
        days_of_week: r.days_of_week,
        start_time: r.start_time,
        end_time: r.end_time,
        description: r.description,
        tags: r.tags,
        is_active: r.is_active,
      });
      v.happy_hours.push(hh);
    }
  }

  // Exact circle + sort (matches the old ORDER BY distance_meters).
  const out = [...venues.values()]
    .filter((v) => v.distance_meters <= radiusM)
    .sort((a, b) => a.distance_meters - b.distance_meters);

  return json(out, 200, { "Cache-Control": "public, max-age=60" });
};
