// Who decided a submission, and when (columns from migration 0006).
//
// The reviewer is the identity the admin middleware verified and put on
// ctx.data.adminEmail: the Cloudflare Access email in production, or
// "dev@localhost" with the local-dev bypass. Approve and reject record it;
// restore (back to pending) clears it. The columns may not exist yet on a
// database the migration hasn't reached, so callers pass the set of present
// columns from withOptionalColumns and only those are written.

export const REVIEW_COLUMNS = ["reviewed_by", "reviewed_at"] as const;
export type ReviewColumn = (typeof REVIEW_COLUMNS)[number];

/** The verified admin identity from the middleware, or "admin" if it is somehow absent. */
export function reviewerOf(data: Record<string, unknown> | undefined): string {
  const email = data?.adminEmail;
  return typeof email === "string" && email.trim() ? email.trim().slice(0, 320) : "admin";
}

/**
 * SET fragments for the review columns that exist, numbered from `firstParam`.
 * `review` null clears them (back to pending). Returns "" and no binds when
 * neither column exists.
 */
export function reviewAssignments(
  present: ReadonlySet<string>,
  firstParam: number,
  review: { by: string; at: string } | null,
): { sql: string; binds: (string | null)[] } {
  const parts: string[] = [];
  const binds: (string | null)[] = [];
  if (present.has("reviewed_by")) {
    parts.push(`reviewed_by = ?${firstParam + binds.length}`);
    binds.push(review?.by ?? null);
  }
  if (present.has("reviewed_at")) {
    parts.push(`reviewed_at = ?${firstParam + binds.length}`);
    binds.push(review?.at ?? null);
  }
  return { sql: parts.map((p) => `, ${p}`).join(""), binds };
}
