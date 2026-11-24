// GET /api/admin/submissions?status=pending|approved|rejected
//
// Order: pending newest submitted first. Approved and rejected newest DECIDED
// first (reviewed_at, migration 0006); rows with no decision date (decided
// before the migration) come after them, newest submitted first. Before the
// migration is applied, decided lists fall back to submission order.
import type { Env } from "../../../_shared/db";
import { rowToSubmission } from "../../../_shared/db";
import { error, json } from "../../../_shared/http";
import { withOptionalColumns } from "../../../_shared/schema-compat";

const STATUSES = new Set(["pending", "approved", "rejected"]);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const status = new URL(request.url).searchParams.get("status") ?? "pending";
  if (!STATUSES.has(status)) return error("invalid status", 400);

  const { results } = await withOptionalColumns(["reviewed_at"], (present) => {
    const order =
      status !== "pending" && present.has("reviewed_at")
        ? "reviewed_at IS NULL, reviewed_at DESC, created_at DESC"
        : "created_at DESC";
    return env.DB.prepare(`SELECT * FROM submissions WHERE status = ?1 ORDER BY ${order}`)
      .bind(status).all<Record<string, unknown>>();
  });
  return json({ submissions: (results ?? []).map(rowToSubmission) });
};
