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
import Anthropic, { APIError, RateLimitError } from "@anthropic-ai/sdk";
import type { Env } from "../../../_shared/db";
import { nowIso, rowToSubmission } from "../../../_shared/db";
import { error, json, readJson } from "../../../_shared/http";
import { clientIp, rateLimit } from "../../../_shared/rate-limit";
import { isCountryCode, isLatLng, isOptionalStringLen } from "../../../_shared/validate";
import { EXTRACTION_SCHEMA, normalizeExtractedDeals, type ExtractedMenu } from "../../../_shared/extract";
import type { FromImageInput } from "../../../../src/lib/api-types";

// Client compresses to ~1500px WebP/JPEG (typically <400KB); anything bigger
// than this decoded cap means the client-side compression was bypassed.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// ~1500px image ≈ 1.6K input tokens on Haiku 4.5 ($1/MTok in, $5/MTok out):
// a few tenths of a cent per photo.
const VISION_MODEL = "claude-haiku-4-5";

const SYSTEM_PROMPT = `You extract happy hour deals from photos of menus, chalkboards, posters, and screenshots.

Rules:
- days_of_week uses 0=Sunday through 6=Saturday. "Weekdays" means [1,2,3,4,5]; "weekends" means [0,6]; "daily"/"every day" means [0,1,2,3,4,5,6]. If days are not stated, use an empty array — never guess.
- Times are 24-hour HH:MM. "4-7pm" is start 16:00, end 19:00. If a time is not stated, use an empty string — never guess.
- Create one deal per distinct time window or day set. Deals sharing the same days and times belong in ONE deal with a combined description.
- Descriptions should be concise and keep the prices, e.g. "$5 pints and half-price cocktails".
- venue_name / venue_address: only what is actually visible in the image, else null. Do not infer a venue from logos alone unless the name is legible.
- Put anything ambiguous or unreadable in notes so a human reviewer can double-check.`;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Cost guard on top of Access: the model call is the expensive part.
  if (!(await rateLimit(env.RATE_LIMIT, "from_image", clientIp(request), 10))) {
    return error("rate limit exceeded, try again in a minute", 429);
  }

  // Base64 inflates the 3MB image cap by 4/3; leave headroom for the other fields.
  const b = await readJson<FromImageInput>(request, 5 * 1024 * 1024);
  if (!b || typeof b.image_base64 !== "string" || !b.image_base64) {
    return error("image_base64 is required", 400);
  }
  if (!ALLOWED_MEDIA_TYPES.has(b.media_type)) {
    return error("media_type must be image/jpeg, image/png or image/webp", 400);
  }
  // 4 base64 chars = 3 bytes; reject before decoding.
  if (b.image_base64.length > Math.ceil((MAX_IMAGE_BYTES / 3) * 4)) {
    return error("image too large (max 3MB) — compression should happen client-side", 413);
  }
  const hasCoords = b.lat != null || b.lng != null;
  if (hasCoords && !isLatLng(b.lat, b.lng)) {
    return error("lat/lng must both be valid coordinates when provided", 400);
  }
  if (!isOptionalStringLen(b.venue_name, 200)) return error("venue_name too long (max 200)", 400);
  if (!isOptionalStringLen(b.city, 200)) return error("city too long (max 200)", 400);
  if (b.country != null && b.country !== "" && !isCountryCode(b.country)) {
    return error("country must be an ISO 3166-1 alpha-2 code", 400);
  }

  let imageBytes: Uint8Array;
  try {
    imageBytes = Uint8Array.from(atob(b.image_base64), (c) => c.charCodeAt(0));
  } catch {
    return error("image_base64 is not valid base64", 400);
  }
  if (imageBytes.byteLength > MAX_IMAGE_BYTES) {
    return error("image too large (max 3MB)", 413);
  }

  // Extract first, store second: if the model call fails we return the error
  // without leaving an orphaned image in R2.
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  let extracted: ExtractedMenu;
  try {
    const response = await anthropic.messages.create({
      model: VISION_MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema: EXTRACTION_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: b.media_type, data: b.image_base64 } },
            { type: "text", text: "Extract the happy hour deal(s) from this image." },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal") {
      return error("the model declined to process this image", 422);
    }
    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return error("extraction returned no result — try a clearer photo", 502);
    }
    extracted = JSON.parse(textBlock.text) as ExtractedMenu;
  } catch (e) {
    if (e instanceof RateLimitError) {
      return error("extraction service is rate-limited — try again shortly", 503);
    }
    if (e instanceof APIError) {
      return error(`extraction failed (${e.status ?? "network"})`, 502);
    }
    return error("extraction returned malformed data — try again", 502);
  }

  const deals = normalizeExtractedDeals(extracted);
  const [first, ...extras] = deals;

  const submissionId = crypto.randomUUID();
  const ext = b.media_type === "image/png" ? "png" : b.media_type === "image/webp" ? "webp" : "jpg";
  const imageKey = `submissions/${submissionId}.${ext}`;
  await env.SUBMISSION_IMAGES.put(imageKey, imageBytes, {
    httpMetadata: { contentType: b.media_type },
  });

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
