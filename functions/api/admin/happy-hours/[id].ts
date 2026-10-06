// PUT /api/admin/happy-hours/:id -> update one happy hour (all deal fields).
import type { Env } from "../../../_shared/db";
import { nowIso, toHms } from "../../../_shared/db";
import { error, json, readJson } from "../../../_shared/http";
import { normalizeTags, validateDealFields } from "../../../_shared/validate";

interface HHBody {
  days_of_week: number[];
  start_time: string;
  end_time: string;
  description: string;
  tags: string[] | null;
  is_active: boolean;
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = params.id as string;
  const b = await readJson<HHBody>(request);
  if (!b) return error("invalid JSON", 400);
  const fieldErr = validateDealFields(b);
  if (fieldErr) return error(fieldErr, 400);

  const result = await env.DB.prepare(
    `UPDATE happy_hours SET days_of_week = ?2, start_time = ?3, end_time = ?4,
            description = ?5, tags = ?6, is_active = ?7, updated_at = ?8
     WHERE id = ?1`,
  ).bind(
    id, JSON.stringify(b.days_of_week), toHms(b.start_time), toHms(b.end_time),
    b.description, JSON.stringify(normalizeTags(b.tags)), b.is_active ? 1 : 0, nowIso(),
  ).run();

  if (result.meta.changes === 0) return error("happy hour not found", 404);
  return json({ ok: true });
};
