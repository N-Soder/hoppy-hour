// POST /api/admin/happy-hours/group-delete -> delete a set of records in one
// batch. POST (not bodied DELETE) because DELETE request bodies are poorly
// specified.
import type { Env } from "../../../_shared/db";
import { error, json, readJson } from "../../../_shared/http";
import { validateIdList } from "../../../_shared/validate";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const b = await readJson<{ ids: string[] }>(request);
  if (!b) return error("invalid JSON", 400);
  const idsErr = validateIdList(b.ids);
  if (idsErr) return error(idsErr, 400);
  await env.DB.batch(
    b.ids.map((id) => env.DB.prepare(`DELETE FROM happy_hours WHERE id = ?1`).bind(id)),
  );
  return json({ ok: true });
};
