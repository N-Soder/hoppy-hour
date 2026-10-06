// POST /api/admin/submissions/:id/approve
//
// Two approval modes, selected by the body (exactly one of the two):
//  * `venue: {...}`  — create a NEW venue plus its happy hours (original flow).
//  * `venue_id`      — attach the deals to an EXISTING venue. Optionally:
//      - `venue_update: {...}` applies reviewer edits to the venue row, and
//      - per-deal `replaces_id` soft-deactivates (is_active=0) an existing
//        active happy hour that the incoming deal supersedes — corrections
//        ("now 4-7, not 3-6") replace instead of piling up duplicates.
//
// Atomicity: venue insert/update + happy-hour inserts + replacement
// deactivations + guarded status flip are ONE D1 batch —
// all-or-nothing, coordinates ride in the venue INSERT.
//
// Concurrency: a guarded UPDATE matching 0 rows does NOT abort a batch, so two
// racing approvals could both insert. We detect it via the UPDATE's changes
// count and compensate:
//  * new-venue mode: delete the venue we inserted (cascades to its happy_hours).
//  * existing-venue mode: delete ONLY the happy_hours rows we inserted (never
//    the pre-existing venue!), reactivate the deals we deactivated (preflight
//    requires them active, so restoring is_active=1 is faithful), and restore
//    the venue fields captured at preflight if we applied a venue_update.
import type { Env } from "../../../../_shared/db";
import { nowIso, toHms } from "../../../../_shared/db";
import { error, json, readJson } from "../../../../_shared/http";
import { normalizeTags, validateDealFields, isStringLen } from "../../../../_shared/validate";
import { MAX_DEALS_PER_SUBMISSION, type ApproveInput } from "../../../../../src/lib/api-types";

interface VenueRow {
  id: string;
  name: string;
  address: string;
  country: string | null;
  lat: number | null;
  lng: number | null;
}

function validateVenueFields(v: NonNullable<ApproveInput["venue"]>, label: string): Response | null {
  if (!isStringLen(v.name, 200)) return error(`${label}.name is required (max 200)`, 400);
  if (!isStringLen(v.address, 500)) return error(`${label}.address is required (max 500)`, 400);
  if (typeof v.lat !== "number" || typeof v.lng !== "number") {
    return error(`${label}.lat and ${label}.lng are required`, 400);
  }
  return null;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = params.id as string;
  const b = await readJson<ApproveInput>(request);
  if (!b || !Array.isArray(b.happy_hours) || b.happy_hours.length === 0) {
    return error("at least one happy_hour is required", 400);
  }
  if (b.happy_hours.length > MAX_DEALS_PER_SUBMISSION) {
    return error(`too many deals (max ${MAX_DEALS_PER_SUBMISSION})`, 400);
  }
  const hasVenue = !!b.venue;
  const hasVenueId = typeof b.venue_id === "string" && b.venue_id.length > 0;
  if (hasVenue === hasVenueId) {
    return error("exactly one of venue or venue_id is required", 400);
  }
  if (!hasVenueId && b.venue_update) {
    return error("venue_update requires venue_id", 400);
  }

  const replacesIds: string[] = [];
  for (let i = 0; i < b.happy_hours.length; i++) {
    const deal = b.happy_hours[i];
    const fieldErr = validateDealFields(deal);
    if (fieldErr) return error(`happy_hours[${i}]: ${fieldErr}`, 400);
    if (deal.replaces_id != null) {
      if (!hasVenueId) return error(`happy_hours[${i}].replaces_id requires venue_id`, 400);
      if (typeof deal.replaces_id !== "string") return error(`happy_hours[${i}].replaces_id must be a string`, 400);
      if (replacesIds.includes(deal.replaces_id)) {
        return error(`happy_hours[${i}].replaces_id duplicates another deal's target`, 400);
      }
      replacesIds.push(deal.replaces_id);
    }
  }

  if (hasVenue) {
    const venueErr = validateVenueFields(b.venue!, "venue");
    if (venueErr) return venueErr;
  }
  if (b.venue_update) {
    const updateErr = validateVenueFields(b.venue_update, "venue_update");
    if (updateErr) return updateErr;
  }

  // Preflight so re-approving an already-processed submission fails cleanly
  // before we insert anything.
  const row = await env.DB.prepare(`SELECT status FROM submissions WHERE id = ?1`).bind(id)
    .first<{ status: string }>();
  if (!row) return error("submission not found", 404);
  if (row.status !== "pending") return error(`already ${row.status}`, 409);

  // Existing-venue mode: the venue must exist, and every replacement target
  // must be one of ITS currently-active happy hours. Capturing the venue row
  // here also gives us the pre-update field values for race compensation.
  let existingVenue: VenueRow | null = null;
  if (hasVenueId) {
    existingVenue = await env.DB.prepare(
      `SELECT id, name, address, country, lat, lng FROM venues WHERE id = ?1`,
    ).bind(b.venue_id).first<VenueRow>();
    if (!existingVenue) return error("venue not found", 404);

    if (replacesIds.length > 0) {
      const placeholders = replacesIds.map((_, i) => `?${i + 2}`).join(",");
      const { results } = await env.DB.prepare(
        `SELECT id FROM happy_hours WHERE venue_id = ?1 AND is_active = 1 AND id IN (${placeholders})`,
      ).bind(b.venue_id, ...replacesIds).all<{ id: string }>();
      if ((results ?? []).length !== replacesIds.length) {
        return error("every replaces_id must be an active happy hour of the attached venue", 400);
      }
    }
  }

  const now = nowIso();
  const newVenueId = hasVenue ? crypto.randomUUID() : null;
  const targetVenueId = hasVenue ? newVenueId! : b.venue_id!;

  const deals = b.happy_hours.map((h) => ({
    id: crypto.randomUUID(),
    days_of_week: JSON.stringify(h.days_of_week),
    start_time: toHms(h.start_time),
    end_time: toHms(h.end_time),
    description: h.description,
    tags: JSON.stringify(normalizeTags(h.tags)),
  }));
  // The submission keeps deal #1 in its own columns; the rest go to extra_deals.
  const first = deals[0];
  const extraDeals = JSON.stringify(
    b.happy_hours.slice(1).map((h) => ({
      days_of_week: h.days_of_week,
      start_time: toHms(h.start_time),
      end_time: toHms(h.end_time),
      description: h.description,
      tags: normalizeTags(h.tags),
    })),
  );

  // Name/address recorded back onto the submission for the audit trail.
  const recordedVenue = hasVenue ? b.venue! : (b.venue_update ?? existingVenue!);

  const statements: D1PreparedStatement[] = [];
  if (hasVenue) {
    const v = b.venue!;
    statements.push(
      env.DB.prepare(
        `INSERT INTO venues (id, name, address, country, lat, lng, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?7)`,
      ).bind(newVenueId, v.name, v.address, v.country ?? null, v.lat, v.lng, now),
    );
  } else if (b.venue_update) {
    const v = b.venue_update;
    statements.push(
      env.DB.prepare(
        `UPDATE venues SET name = ?2, address = ?3, country = ?4, lat = ?5, lng = ?6, updated_at = ?7
          WHERE id = ?1`,
      ).bind(targetVenueId, v.name, v.address, v.country ?? null, v.lat, v.lng, now),
    );
  }
  statements.push(
    ...deals.map((d) =>
      env.DB.prepare(
        `INSERT INTO happy_hours (id, venue_id, days_of_week, start_time, end_time,
                                  description, tags, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?8)`,
      ).bind(d.id, targetVenueId, d.days_of_week, d.start_time, d.end_time, d.description, d.tags, now),
    ),
  );
  if (replacesIds.length > 0) {
    const placeholders = replacesIds.map((_, i) => `?${i + 3}`).join(",");
    statements.push(
      env.DB.prepare(
        `UPDATE happy_hours SET is_active = 0, updated_at = ?2
          WHERE venue_id = ?1 AND id IN (${placeholders})`,
      ).bind(targetVenueId, now, ...replacesIds),
    );
  }
  statements.push(
    env.DB.prepare(
      `UPDATE submissions
          SET status = 'approved', venue_id = ?10, venue_name = ?2, venue_address = ?3,
              days_of_week = ?4, start_time = ?5, end_time = ?6, description = ?7, tags = ?8,
              extra_deals = ?9
        WHERE id = ?1 AND status = 'pending'`,
    ).bind(id, recordedVenue.name, recordedVenue.address, first.days_of_week, first.start_time,
           first.end_time, first.description, first.tags, extraDeals, targetVenueId),
  );

  const batchResult = await env.DB.batch(statements);

  // The status UPDATE is the last statement. If it changed 0 rows, another
  // approval won the race between our preflight and the batch — undo our writes.
  const updateChanges = batchResult[batchResult.length - 1]?.meta.changes ?? 0;
  if (updateChanges === 0) {
    if (hasVenue) {
      // Our own venue; happy_hours go with it via ON DELETE CASCADE.
      await env.DB.prepare(`DELETE FROM venues WHERE id = ?1`).bind(newVenueId).run();
    } else {
      const compensations: D1PreparedStatement[] = [
        env.DB.prepare(
          `DELETE FROM happy_hours WHERE id IN (${deals.map((_, i) => `?${i + 1}`).join(",")})`,
        ).bind(...deals.map((d) => d.id)),
      ];
      if (replacesIds.length > 0) {
        compensations.push(
          env.DB.prepare(
            `UPDATE happy_hours SET is_active = 1, updated_at = ?2
              WHERE venue_id = ?1 AND id IN (${replacesIds.map((_, i) => `?${i + 3}`).join(",")})`,
          ).bind(targetVenueId, nowIso(), ...replacesIds),
        );
      }
      if (b.venue_update && existingVenue) {
        compensations.push(
          env.DB.prepare(
            `UPDATE venues SET name = ?2, address = ?3, country = ?4, lat = ?5, lng = ?6, updated_at = ?7
              WHERE id = ?1`,
          ).bind(existingVenue.id, existingVenue.name, existingVenue.address,
                 existingVenue.country, existingVenue.lat, existingVenue.lng, nowIso()),
        );
      }
      await env.DB.batch(compensations);
    }
    return error("submission was already processed", 409);
  }

  return json({ venue_id: targetVenueId });
};
