// POST /api/admin/happy-hours/group-delete -> delete the records of one
// grouped deal in one batch. POST (not bodied DELETE) because DELETE request
// bodies are poorly specified.
//
// The ids must be one grouped deal (see _shared/deal-group): a stale editor
// can't delete records that have since become a different deal.
import type { Env } from "../../../_shared/db";
import { error, json, readJson } from "../../../_shared/http";
import { loadGroup } from "../../../_shared/deal-group";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const b = await readJson<{ ids: string[] }>(request);
  if (!b || !Array.isArray(b.ids) || b.ids.length === 0) return error("ids required", 400);
  const group = await loadGroup(env, b.ids);
  if (!group.ok) return error(group.message, group.status);
  await env.DB.batch(
    group.rows.map((r) => env.DB.prepare(`DELETE FROM happy_hours WHERE id = ?1`).bind(r.id)),
  );
  return json({ ok: true });
};
