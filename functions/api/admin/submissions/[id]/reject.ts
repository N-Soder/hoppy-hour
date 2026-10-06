// POST /api/admin/submissions/:id/reject
import type { Env } from "../../../../_shared/db";
import { error, json } from "../../../../_shared/http";

export const onRequestPost: PagesFunction<Env> = async ({ env, params }) => {
  const id = params.id as string;
  const result = await env.DB.prepare(
    `UPDATE submissions SET status = 'rejected' WHERE id = ?1 AND status = 'pending'`,
  ).bind(id).run();

  if (result.meta.changes === 0) return error("not pending or not found", 409);
  return json({ ok: true });
};
