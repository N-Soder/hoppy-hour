// PUT    /api/admin/venues/:id  -> partial update (name/address/country/lat/lng/status)
// DELETE /api/admin/venues/:id  -> delete venue + its happy hours in one batch
import type { Env } from "../../../_shared/db";
import { nowIso } from "../../../_shared/db";
import { error, json, readJson } from "../../../_shared/http";

// Column whitelist — SET names come only from here, never from request keys.
const EDITABLE = ["name", "address", "country", "lat", "lng", "status"] as const;
type Editable = (typeof EDITABLE)[number];

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = params.id as string;
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return error("invalid JSON", 400);

  const keys = EDITABLE.filter((k) => k in body);
  if (keys.length === 0) return error("no fields to update", 400);

  const sets = keys.map((k, i) => `${k} = ?${i + 2}`).join(", ");
  const values = keys.map((k) => body[k as Editable] as string | number | null);
  const result = await env.DB.prepare(
    `UPDATE venues SET ${sets}, updated_at = ?${keys.length + 2} WHERE id = ?1`,
  ).bind(id, ...values, nowIso()).run();

  if (result.meta.changes === 0) return error("venue not found", 404);
  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ env, params }) => {
  const id = params.id as string;
  // Atomic: FK cascade would cover the happy_hours delete, but being explicit
  // keeps intent clear and works regardless of PRAGMA state (the old
  // client did these as two calls and ignored the first one's error).
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM happy_hours WHERE venue_id = ?1`).bind(id),
    env.DB.prepare(`DELETE FROM venues WHERE id = ?1`).bind(id),
  ]);
  return json({ ok: true });
};
