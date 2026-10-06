// POST /api/admin/happy-hours/group-delete -> delete a set of records in one
// batch. POST (not bodied DELETE) because DELETE request bodies are poorly
// specified.
import type { Env } from "../../../_shared/db";
import { error, json, readJson } from "../../../_shared/http";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const b = await readJson<{ ids: string[] }>(request);
  if (!b || !Array.isArray(b.ids) || b.ids.length === 0) return error("ids required", 400);
  await env.DB.batch(
    b.ids.map((id) => env.DB.prepare(`DELETE FROM happy_hours WHERE id = ?1`).bind(id)),
  );
  return json({ ok: true });
};
