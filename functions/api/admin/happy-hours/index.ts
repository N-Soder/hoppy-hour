// POST /api/admin/happy-hours -> create one happy hour.
import type { Env } from "../../../_shared/db";
import { nowIso, toHms } from "../../../_shared/db";
import { error, json, readJson } from "../../../_shared/http";
import { normalizeTags, validateDealFields } from "../../../_shared/validate";

interface HHBody {
  venue_id: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  description: string;
  tags: string[] | null;
  is_active: boolean;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const b = await readJson<HHBody>(request);
  if (!b) return error("invalid JSON", 400);
  if (typeof b.venue_id !== "string" || !b.venue_id) return error("venue_id is required", 400);
  const fieldErr = validateDealFields(b);
  if (fieldErr) return error(fieldErr, 400);

  const id = crypto.randomUUID();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO happy_hours (id, venue_id, days_of_week, start_time, end_time,
                              description, tags, is_active, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
  ).bind(
    id, b.venue_id, JSON.stringify(b.days_of_week), toHms(b.start_time), toHms(b.end_time),
    b.description, JSON.stringify(normalizeTags(b.tags)), b.is_active ? 1 : 0, now,
  ).run();

  return json({ id }, 201);
};
