// POST /api/admin/happy-hours/group-update
// Update the canonical record and delete the now-redundant duplicates in ONE
// batch. The old client did this as update-then-delete across two calls
// (HappyHourManager), so a failure between them left stale copies live.
// One D1 batch = all-or-nothing.
//
// The ids must be the records of ONE grouped deal (same venue, times,
// description, tags and active state; see _shared/deal-group). A stale editor
// whose group no longer matches gets a 400/404 instead of merging or deleting
// records that are now a different deal.
import type { Env } from "../../../_shared/db";
import { nowIso, toHms } from "../../../_shared/db";
import { error, json, readJson } from "../../../_shared/http";
import { normalizeTags, validateDealFields } from "../../../_shared/validate";
import { loadGroup } from "../../../_shared/deal-group";

interface Body {
  ids: string[];
  fields: {
    days_of_week: number[];
    start_time: string;
    end_time: string;
    description: string;
    tags: string[] | null;
    is_active: boolean;
  };
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const b = await readJson<Body>(request);
  if (!b || !Array.isArray(b.ids) || b.ids.length === 0) return error("ids required", 400);
  const f = b.fields;
  const fieldErr = validateDealFields(f ?? {});
  if (fieldErr) return error(fieldErr, 400);

  const group = await loadGroup(env, b.ids);
  if (!group.ok) return error(group.message, group.status);
  const [keep, ...dups] = group.rows;

  const stmts = [
    env.DB.prepare(
      `UPDATE happy_hours SET days_of_week = ?2, start_time = ?3, end_time = ?4,
              description = ?5, tags = ?6, is_active = ?7, updated_at = ?8 WHERE id = ?1`,
    ).bind(
      keep.id, JSON.stringify(f.days_of_week), toHms(f.start_time), toHms(f.end_time),
      f.description, JSON.stringify(normalizeTags(f.tags)), f.is_active ? 1 : 0, nowIso(),
    ),
    ...dups.map((dup) => env.DB.prepare(`DELETE FROM happy_hours WHERE id = ?1`).bind(dup.id)),
  ];
  await env.DB.batch(stmts);
  return json({ ok: true });
};
