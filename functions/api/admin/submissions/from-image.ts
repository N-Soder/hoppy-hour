// POST /api/admin/submissions/from-image — the Snap-a-Deal flow.
//
// Admin-gated (Cloudflare Access + the /api/admin middleware). Takes a
// client-side-compressed photo of a happy-hour menu, stores it in R2, runs a
// cheap vision model (Claude Haiku 4.5) with structured output to pre-fill the
// deal fields, and inserts a normal `status='pending'` submission with
// source='photo'. Nothing goes live here — the existing review/approve flow is
// unchanged and the reviewer verifies against the stored photo.
//
// Everything besides the image is optional: lat/lng arrive from the device
// (admin tapped "use my location") or from the picked city (same coarse pin
// the public form produces); venue_name/city/country are typed context, with
// a typed venue name overriding the model's read. Whatever is missing gets
// filled in during review like any form submission. The client re-encodes
// through a canvas before upload, which also strips EXIF (including any
// embedded GPS), so no location data rides along uninvited.
import type { Env } from "../../../_shared/db";
import { nowIso, rowToSubmission } from "../../../_shared/db";
import { error, json, readJson } from "../../../_shared/http";
import { clientIp, rateLimit } from "../../../_shared/rate-limit";
import { isCountryCode, isLatLng, isOptionalStringLen } from "../../../_shared/validate";
import { normalizeExtractedDeals } from "../../../_shared/extract";
import { decodeImage, extractMenu, imageExtension, storeImage } from "../../../_shared/menu-extract";
import type { FromImageInput } from "../../../../src/lib/api-types";

// Image validation, the model call (and its system prompt) and the R2 write
// live in _shared/menu-extract.ts, shared with the public POST /api/menu-photo.

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Cost guard on top of Access: the model call is the expensive part.
  if (!(await rateLimit(env.RATE_LIMIT, "from_image", clientIp(request), 10))) {
    return error("rate limit exceeded, try again in a minute", 429);
  }

  // Base64 inflates the 3MB image cap by 4/3; leave headroom for the other fields.
  const b = await readJson<FromImageInput>(request, 5 * 1024 * 1024);
  if (!b) return error("image_base64 is required", 400);
  const image = decodeImage(b.image_base64, b.media_type);
  if (!image.ok) return error(image.message, image.status);
  const hasCoords = b.lat != null || b.lng != null;
  if (hasCoords && !isLatLng(b.lat, b.lng)) {
    return error("lat/lng must both be valid coordinates when provided", 400);
  }
  if (!isOptionalStringLen(b.venue_name, 200)) return error("venue_name too long (max 200)", 400);
  if (!isOptionalStringLen(b.city, 200)) return error("city too long (max 200)", 400);
  if (b.country != null && b.country !== "" && !isCountryCode(b.country)) {
    return error("country must be an ISO 3166-1 alpha-2 code", 400);
  }

  // Extract first, store second: if the model call fails we return the error
  // without leaving an orphaned image in R2.
  const result = await extractMenu(env.ANTHROPIC_API_KEY, image);
  if (!result.ok) return error(result.message, result.status);
  const extracted = result.extracted;

  const deals = normalizeExtractedDeals(extracted);
  const [first, ...extras] = deals;

  const submissionId = crypto.randomUUID();
  const imageKey = `submissions/${submissionId}.${imageExtension(image.mediaType)}`;
  await storeImage(env.SUBMISSION_IMAGES, imageKey, image.bytes, image.mediaType);

  // A typed venue name is ground truth; the model's read is the fallback.
  const typedName = (b.venue_name ?? "").trim();
  const venueName =
    typedName.slice(0, 200) ||
    (extracted.venue_name ?? "").trim().slice(0, 200) ||
    "Unknown venue (from photo)";
  const venueAddress = (extracted.venue_address ?? "").trim().slice(0, 500);
  const city = (b.city ?? "").trim().slice(0, 200) || null;
  const countryCode = b.country ? b.country.toUpperCase() : null;
  // Reviewer-facing context rides in the description of deal #1 only when the
  // model produced no usable description at all; otherwise notes stay implicit
  // in the photo the reviewer sees side-by-side.
  const firstDescription =
    first.description || (extracted.notes ? `(photo notes: ${extracted.notes.slice(0, 500)})` : "");

  await env.DB.prepare(
    `INSERT INTO submissions (id, venue_name, venue_address, city, country, lat, lng,
                              days_of_week, start_time, end_time, description, tags,
                              extra_deals, status, source, image_key, honeypot, created_at)
     VALUES (?1, ?2, ?3, ?14, ?15, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'pending', 'photo', ?12, NULL, ?13)`,
  ).bind(
    submissionId,
    venueName,
    venueAddress,
    hasCoords ? b.lat : null,
    hasCoords ? b.lng : null,
    JSON.stringify(first.days_of_week),
    first.start_time,
    first.end_time,
    firstDescription,
    JSON.stringify(first.tags ?? []),
    JSON.stringify(extras),
    imageKey,
    nowIso(),
    city,
    countryCode,
  ).run();

  const row = await env.DB.prepare(`SELECT * FROM submissions WHERE id = ?1`).bind(submissionId)
    .first<Record<string, unknown>>();
  return json({ submission: rowToSubmission(row!), notes: extracted.notes ?? null }, 201);
};
