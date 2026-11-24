// POST /api/admin/submissions/:id/restore
// Undo a rejection: move a REJECTED submission back to pending so it can be
// reviewed again. Backs the "Undo" on the admin's "Rejected" toast and the
// "Move back to pending" action in the rejected list. Clears the recorded
// reviewer and decision time (migration 0006) when those columns exist: a
// pending submission has not been decided.
//
// Only rejected -> pending. An approved submission has created venue and deal
// rows, so un-approving is not a status flip and is deliberately not offered.
import type { Env } from "../../../../_shared/db";
import { error, json } from "../../../../_shared/http";
import { withOptionalColumns } from "../../../../_shared/schema-compat";
import { REVIEW_COLUMNS, reviewAssignments } from "../../../../_shared/review";

export const onRequestPost: PagesFunction<Env> = async ({ env, params }) => {
  const id = params.id as string;
  const result = await withOptionalColumns(REVIEW_COLUMNS, (present) => {
    const set = reviewAssignments(present, 2, null);
    return env.DB.prepare(
      `UPDATE submissions SET status = 'pending'${set.sql} WHERE id = ?1 AND status = 'rejected'`,
    ).bind(id, ...set.binds).run();
  });

  if (result.meta.changes > 0) return json({ ok: true });

  const row = await env.DB.prepare(`SELECT status FROM submissions WHERE id = ?1`).bind(id)
    .first<{ status: string }>();
  if (!row) return error("submission not found", 404);
  return error(`submission is ${row.status}, not rejected`, 409);
};
