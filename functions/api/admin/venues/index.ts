// GET  /api/admin/venues        -> list all venues (incl. lat/lng for editing)
// POST /api/admin/venues        -> create a venue (coords in the same INSERT;
//                                  no separate location-update call)
import type { Env } from "../../../_shared/db";
import { nowIso, rowToVenue } from "../../../_shared/db";
import { error, json, readJson } from "../../../_shared/http";
import { isStringLen } from "../../../_shared/validate";
import type { Venue } from "../../../../src/lib/api-types";

// deal_count counts deals the way the admin editor shows them: records that
// share times, description, tags and active state are one deal (a daily deal
// stored as seven per-day rows counts once).
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    `SELECT v.id, v.name, v.address, v.country, v.status, v.lat, v.lng,
            (SELECT COUNT(DISTINCT h.start_time || '|' || h.end_time || '|' || trim(h.description)
                                   || '|' || h.tags || '|' || h.is_active)
               FROM happy_hours h WHERE h.venue_id = v.id) AS deal_count
       FROM venues v ORDER BY v.name`,
  ).all<Record<string, unknown>>();
  return json({
    venues: (results ?? []).map((r) => ({ ...rowToVenue(r), deal_count: Number(r.deal_count ?? 0) })),
  });
};

interface VenueBody {
  name: string;
  address: string;
  country: string | null;
  lat: number | null;
  lng: number | null;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const b = await readJson<VenueBody>(request);
  if (!b) return error("invalid JSON", 400);
  if (!isStringLen(b.name, 200)) return error("name is required (max 200)", 400);
  if (!isStringLen(b.address, 500)) return error("address is required (max 500)", 400);

  const id = crypto.randomUUID();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO venues (id, name, address, country, lat, lng, status, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?7)`,
  ).bind(id, b.name, b.address, b.country ?? null, b.lat ?? null, b.lng ?? null, now).run();

  return json({ id } satisfies Pick<Venue, "id">, 201);
};
