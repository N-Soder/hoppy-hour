// How the admin editor groups happy-hour records into one deal, on the
// server. Mirrors groupHappyHours (src/lib/happy-hour-utils.ts): records that
// share times, description, tags and active state are one deal, and their
// days are unioned. The group endpoints (group-update, group-delete, split)
// use it to check that the ids they are given really are one deal.
import type { Env } from "./db";
import { rowToHappyHour, toHms } from "./db";
import type { HappyHour } from "../../src/lib/api-types";

export interface DealFields {
  start_time: string;
  end_time: string;
  description: string;
  tags: string[] | null;
  is_active: boolean;
}

/** The grouping key: equal keys are shown as one deal in the editor. */
export function dealGroupKey(h: DealFields): string {
  const tags = (h.tags ?? []).map((t) => t.trim().toLowerCase()).sort().join(",");
  return `${toHms(h.start_time)}|${toHms(h.end_time)}|${h.description.trim()}|${tags}|${h.is_active}`;
}

export type GroupLoad =
  | { ok: true; rows: HappyHour[]; venueId: string; days: number[] }
  | { ok: false; status: number; message: string };

/**
 * Load the records behind one grouped deal and check they are one: every id
 * exists, all belong to the same venue and share the grouping key.
 */
export async function loadGroup(env: Env, ids: unknown): Promise<GroupLoad> {
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string" && id)) {
    return { ok: false, status: 400, message: "ids required" };
  }
  const unique = [...new Set(ids as string[])];
  const placeholders = unique.map((_, i) => `?${i + 1}`).join(",");
  const { results } = await env.DB.prepare(`SELECT * FROM happy_hours WHERE id IN (${placeholders})`)
    .bind(...unique)
    .all<Record<string, unknown>>();
  const rows = (results ?? []).map(rowToHappyHour);
  if (rows.length !== unique.length) {
    return { ok: false, status: 404, message: "happy hour not found; reload the venue's deals" };
  }
  const venueId = rows[0].venue_id;
  if (rows.some((r) => r.venue_id !== venueId)) {
    return { ok: false, status: 400, message: "ids must all belong to one venue" };
  }
  const key = dealGroupKey(rows[0]);
  if (rows.some((r) => dealGroupKey(r) !== key)) {
    return { ok: false, status: 400, message: "ids are not one deal; reload the venue's deals" };
  }
  // Keep the caller's order (ids[0] is the record group-update keeps).
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = unique.map((id) => byId.get(id)!);
  const days = [...new Set(ordered.flatMap((r) => r.days_of_week))].sort((a, b) => a - b);
  return { ok: true, rows: ordered, venueId, days };
}
