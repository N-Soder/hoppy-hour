// GET  /api/admin/venues        -> list all venues (incl. lat/lng for editing)
// POST /api/admin/venues        -> create a venue (coords in the same INSERT;
//                                  no separate location-update call)
import type { Env } from "../../../_shared/db";
import { nowIso, rowToVenue } from "../../../_shared/db";
import { error, json, readJson } from "../../../_shared/http";
import { isStringLen } from "../../../_shared/validate";
import type { Venue } from "../../../../src/lib/api-types";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    `SELECT id, name, address, country, status, lat, lng FROM venues ORDER BY name`,
  ).all<Record<string, unknown>>();
  return json({ venues: (results ?? []).map(rowToVenue) });
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
