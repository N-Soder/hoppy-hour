// PUT    /api/admin/venues/:id  -> partial update (name/address/country/lat/lng/status)
// DELETE /api/admin/venues/:id  -> delete venue + its happy hours in one batch
//
// Time zone: when lat or lng changes, the venue's time zone is derived again
// from the resulting coordinates. A body may also send `timezone` (an IANA
// name, or null) to correct a lookup that landed on the wrong side of a zone
// border; an explicit value wins over the derived one. Before migration 0005
// the column does not exist and the time zone is simply not stored.
import type { Env } from "../../../_shared/db";
import { nowIso } from "../../../_shared/db";
import { error, json, readJson } from "../../../_shared/http";
import { withOptionalColumns } from "../../../_shared/schema-compat";
import { isValidTimeZone, timezoneFor } from "../../../_shared/timezone";

// Column whitelist — SET names come only from here, never from request keys.
const EDITABLE = ["name", "address", "country", "lat", "lng", "status"] as const;
type Editable = (typeof EDITABLE)[number];

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = params.id as string;
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return error("invalid JSON", 400);

  const keys = EDITABLE.filter((k) => k in body);
  const explicitZone = "timezone" in body;
  if (keys.length === 0 && !explicitZone) return error("no fields to update", 400);
  if (explicitZone && body.timezone !== null && !isValidTimeZone(body.timezone)) {
    return error("timezone must be an IANA time zone name or null", 400);
  }

  // The zone to store, or undefined to leave it alone.
  let timezone: string | null | undefined;
  if (explicitZone) {
    timezone = body.timezone as string | null;
  } else if ("lat" in body || "lng" in body) {
    let lat = body.lat;
    let lng = body.lng;
    if (!("lat" in body) || !("lng" in body)) {
      const current = await env.DB.prepare(`SELECT lat, lng FROM venues WHERE id = ?1`).bind(id)
        .first<{ lat: number | null; lng: number | null }>();
      if (!current) return error("venue not found", 404);
      lat = "lat" in body ? body.lat : current.lat;
      lng = "lng" in body ? body.lng : current.lng;
    }
    timezone = timezoneFor(lat, lng);
  }

  const result = await withOptionalColumns(["timezone"], (present) => {
    const cols: string[] = [...keys];
    const values = keys.map((k) => body[k as Editable] as string | number | null);
    if (timezone !== undefined && present.has("timezone")) {
      cols.push("timezone");
      values.push(timezone);
    }
    const sets = cols.map((k, i) => `${k} = ?${i + 2}`).join(", ");
    return env.DB.prepare(
      `UPDATE venues SET ${sets ? `${sets}, ` : ""}updated_at = ?${cols.length + 2} WHERE id = ?1`,
    ).bind(id, ...values, nowIso()).run();
  });

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
