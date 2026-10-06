// GET /api/admin/submissions?status=pending|approved|rejected
import type { Env } from "../../../_shared/db";
import { rowToSubmission } from "../../../_shared/db";
import { error, json } from "../../../_shared/http";

const STATUSES = new Set(["pending", "approved", "rejected"]);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const status = new URL(request.url).searchParams.get("status") ?? "pending";
  if (!STATUSES.has(status)) return error("invalid status", 400);

  const { results } = await env.DB.prepare(
    `SELECT * FROM submissions WHERE status = ?1 ORDER BY created_at DESC`,
  ).bind(status).all<Record<string, unknown>>();
  return json({ submissions: (results ?? []).map(rowToSubmission) });
};
