// POST /api/admin/happy-hours/split
// Take some days out of a grouped deal and save them as a separate deal.
//
// Body: { ids, record }
//  * ids:    the records behind ONE grouped deal (as the editor shows it).
//  * record: the new deal: days, times, description, tags, active. Its days
//            that belong to the original are taken out of it; the original
//            must keep at least one day.
//
// The new deal must differ from the original in times, description, tags or
// active state. An identical one would be grouped straight back into the
// original by the editor (and the venues list's deal count), so splitting it
// would appear to do nothing: that is refused with 409 and the reason.
//
// One D1 batch: the original records lose those days (a record left with no
// days is deleted) and the new record is inserted, all-or-nothing.
import type { Env } from "../../../_shared/db";
import { nowIso, toHms } from "../../../_shared/db";
import { error, json, readJson } from "../../../_shared/http";
import { normalizeTags, validateDealFields } from "../../../_shared/validate";
import { dealGroupKey, loadGroup, type DealFields } from "../../../_shared/deal-group";

interface Body {
  ids: string[];
  record: DealFields & { days_of_week: number[] };
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const b = await readJson<Body>(request);
  if (!b || !b.record || typeof b.record !== "object") return error("ids and record required", 400);
  const r = b.record;
  const fieldErr = validateDealFields(r);
  if (fieldErr) return error(`record: ${fieldErr}`, 400);
  if (typeof r.is_active !== "boolean") return error("record.is_active must be a boolean", 400);

  const group = await loadGroup(env, b.ids);
  if (!group.ok) return error(group.message, group.status);
  if (group.days.length < 2) return error("only a deal on two or more days can be split", 400);

  const newDays = [...new Set(r.days_of_week)].sort((a, c) => a - c);
  const taken = newDays.filter((d) => group.days.includes(d));
  if (taken.length === 0) return error("the new deal must take at least one of the original deal's days", 400);
  if (taken.length === group.days.length) {
    return error("the original deal must keep at least one day; to change every day, edit the deal instead", 400);
  }

  const tags = normalizeTags(r.tags);
  const fields: DealFields = { ...r, description: r.description.trim(), tags };
  if (dealGroupKey(fields) === dealGroupKey(group.rows[0])) {
    return error(
      "the new deal is identical to the original, so it would be shown together with it; change its times, description or tags",
      409,
    );
  }

  const now = nowIso();
  const id = crypto.randomUUID();
  const stmts: D1PreparedStatement[] = [];
  for (const row of group.rows) {
    const keep = row.days_of_week.filter((d) => !taken.includes(d));
    if (keep.length === row.days_of_week.length) continue;
    stmts.push(
      keep.length === 0
        ? env.DB.prepare(`DELETE FROM happy_hours WHERE id = ?1`).bind(row.id)
        : env.DB.prepare(`UPDATE happy_hours SET days_of_week = ?2, updated_at = ?3 WHERE id = ?1`)
            .bind(row.id, JSON.stringify(keep), now),
    );
  }
  stmts.push(
    env.DB.prepare(
      `INSERT INTO happy_hours (id, venue_id, days_of_week, start_time, end_time,
                                description, tags, is_active, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
    ).bind(
      id, group.venueId, JSON.stringify(newDays), toHms(r.start_time), toHms(r.end_time),
      fields.description, JSON.stringify(tags), r.is_active ? 1 : 0, now,
    ),
  );
  await env.DB.batch(stmts);
  return json({ id, taken_days: taken });
};
