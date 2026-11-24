// GET /api/venues/:id?lat=<num>&lng=<num>
// One active venue with its active happy hours, for a shared link to a venue
// that may lie outside the viewer's search radius. lat/lng (optional) are the
// viewer's search centre; distance_meters is measured from there, or 0 when
// they are absent. 404 when the venue does not exist or is not active.
import type { Env } from "../../_shared/db";
import { rowToHappyHour } from "../../_shared/db";
import { error, json } from "../../_shared/http";
import { haversineMeters } from "../../_shared/distance";
import type { VenueWithHappyHours } from "../../../src/lib/api-types";

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id ?? "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return error("invalid id", 400);

  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const hasOrigin =
    url.searchParams.get("lat") !== null && url.searchParams.get("lng") !== null &&
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  const venue = await env.DB.prepare(
    `SELECT id, name, address, country, lat, lng FROM venues
      WHERE id = ?1 AND status = 'active' AND lat IS NOT NULL AND lng IS NOT NULL`,
  ).bind(id).first<Record<string, unknown>>();
  if (!venue) return error("venue not found", 404);

  const { results } = await env.DB.prepare(
    `SELECT id, venue_id, days_of_week, start_time, end_time, description, tags, is_active
       FROM happy_hours WHERE venue_id = ?1 AND is_active = 1`,
  ).bind(id).all<Record<string, unknown>>();

  const vLat = venue.lat as number;
  const vLng = venue.lng as number;
  const out: VenueWithHappyHours = {
    id,
    name: venue.name as string,
    address: venue.address as string,
    country: (venue.country as string | null) ?? null,
    lat: vLat,
    lng: vLng,
    distance_meters: hasOrigin ? haversineMeters(lat, lng, vLat, vLng) : 0,
    happy_hours: (results ?? []).map(rowToHappyHour),
  };
  return json(out, 200, { "Cache-Control": "public, max-age=60" });
};
