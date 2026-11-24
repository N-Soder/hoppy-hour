// POST /api/admin/submissions/:id/reject
// Records who rejected it and when (reviewed_by/reviewed_at, migration 0006)
// when those columns exist; without them the rejection still goes through.
import type { Env } from "../../../../_shared/db";
import { nowIso } from "../../../../_shared/db";
import { error, json } from "../../../../_shared/http";
import { withOptionalColumns } from "../../../../_shared/schema-compat";
import { REVIEW_COLUMNS, reviewAssignments, reviewerOf } from "../../../../_shared/review";

export const onRequestPost: PagesFunction<Env> = async ({ env, params, data }) => {
  const id = params.id as string;
  const review = { by: reviewerOf(data), at: nowIso() };
  const result = await withOptionalColumns(REVIEW_COLUMNS, (present) => {
    const set = reviewAssignments(present, 2, review);
    return env.DB.prepare(
      `UPDATE submissions SET status = 'rejected'${set.sql} WHERE id = ?1 AND status = 'pending'`,
    ).bind(id, ...set.binds).run();
  });

  if (result.meta.changes === 0) return error("not pending or not found", 409);
  return json({ ok: true });
};
