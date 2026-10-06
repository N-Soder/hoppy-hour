// GET /api/admin/venues/:id/happy-hours -> all happy hours for a venue.
import type { Env } from "../../../../_shared/db";
import { rowToHappyHour } from "../../../../_shared/db";
import { json } from "../../../../_shared/http";

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const venueId = params.id as string;
  const { results } = await env.DB.prepare(
    `SELECT * FROM happy_hours WHERE venue_id = ?1 ORDER BY created_at, start_time`,
  ).bind(venueId).all<Record<string, unknown>>();
  return json({ happy_hours: (results ?? []).map(rowToHappyHour) });
};
