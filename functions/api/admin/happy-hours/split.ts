// POST /api/admin/happy-hours/split
// Replace a grouped record with per-day records. The old client deleted first
// and inserted after across two calls (HappyHourManager) — if the insert
// failed, the deal was gone entirely. One batch: delete + re-insert commit or
// roll back together. This is the highest-stakes atomicity fix in the admin API.
import type { Env } from "../../../_shared/db";
import { nowIso, toHms } from "../../../_shared/db";
import { error, json, readJson } from "../../../_shared/http";
import { normalizeTags, validateDealFields } from "../../../_shared/validate";

interface Record_ {
  venue_id: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  description: string;
  tags: string[] | null;
  is_active: boolean;
}

interface Body {
  ids: string[];
  records: Record_[];
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const b = await readJson<Body>(request);
  if (!b || !Array.isArray(b.ids) || !Array.isArray(b.records) || b.records.length === 0) {
    return error("ids and records required", 400);
  }
  for (const r of b.records) {
    if (typeof r.venue_id !== "string" || !r.venue_id) return error("record.venue_id required", 400);
    const fieldErr = validateDealFields(r);
    if (fieldErr) return error(fieldErr, 400);
  }

  const now = nowIso();
  const stmts = [
    ...b.ids.map((id) => env.DB.prepare(`DELETE FROM happy_hours WHERE id = ?1`).bind(id)),
    ...b.records.map((r) =>
      env.DB.prepare(
        `INSERT INTO happy_hours (id, venue_id, days_of_week, start_time, end_time,
                                  description, tags, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
      ).bind(
        crypto.randomUUID(), r.venue_id, JSON.stringify(r.days_of_week), toHms(r.start_time),
        toHms(r.end_time), r.description, JSON.stringify(normalizeTags(r.tags)),
        r.is_active ? 1 : 0, now,
      ),
    ),
  ];
  await env.DB.batch(stmts);
  return json({ ok: true });
};
