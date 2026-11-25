// Menu-photo extraction shared by the admin Snap-a-Deal endpoint
// (POST /api/admin/submissions/from-image) and the public photo read
// (POST /api/menu-photo): image validation, the vision-model call and the R2
// write. Each endpoint keeps its own gating (Access vs Turnstile + limits) and
// decides what to do with the result.
import Anthropic, { APIError, RateLimitError } from "@anthropic-ai/sdk";
import { EXTRACTION_SCHEMA, type ExtractedMenu } from "./extract";
import { DEAL_TEXT_FORMAT } from "./deal-text";
import { isValidTime } from "./validate";
import {
  MAX_DEALS_PER_SUBMISSION,
  type MenuPhotoResult,
  type PhotoPrefillDeal,
} from "../../src/lib/api-types";

// Client compresses to ~1500px WebP/JPEG (typically <400KB); anything bigger
// than this decoded cap means the client-side compression was bypassed.
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp";

// ~1500px image ≈ 1.6K input tokens on Haiku 4.5 ($1/MTok in, $5/MTok out):
// a few tenths of a cent per photo.
export const VISION_MODEL = "claude-haiku-4-5";

export const SYSTEM_PROMPT = `You extract happy hour deals from photos of menus, chalkboards, posters, and screenshots.

Rules:
- days_of_week uses 0=Sunday through 6=Saturday. "Weekdays" means [1,2,3,4,5]; "weekends" means [0,6]; "daily"/"every day" means [0,1,2,3,4,5,6]. If days are not stated, use an empty array — never guess.
- Times are 24-hour HH:MM. "4-7pm" is start 16:00, end 19:00. If a time is not stated, use an empty string — never guess.
- Create one deal per distinct time window or day set. Deals sharing the same days and times belong in ONE deal with a combined description.
- Write each description in the deal description format below, keeping every price, size and condition shown.
- venue_name / venue_address: only what is actually visible in the image, else null. Do not infer a venue from logos alone unless the name is legible.
- Put anything ambiguous or unreadable in notes so a human reviewer can double-check.

${DEAL_TEXT_FORMAT}`;

/** A failure to hand straight back to the client as `error(message, status)`. */
export interface ExtractFailure {
  ok: false;
  status: number;
  message: string;
}

/**
 * Identify an image from its leading bytes. The declared media type is a
 * client claim; this is what the bytes actually are.
 */
export function sniffImageType(bytes: Uint8Array): ImageMediaType | null {
  const at = (i: number) => bytes[i];
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b)
  ) {
    return "image/png";
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/**
 * Validate and decode an uploaded image: allowed declared type, size cap
 * (checked before and after decoding), valid base64, and magic bytes that
 * match the declared type.
 */
export function decodeImage(
  base64: unknown,
  mediaType: unknown,
): { ok: true; bytes: Uint8Array; mediaType: ImageMediaType; base64: string } | ExtractFailure {
  if (typeof base64 !== "string" || !base64) {
    return { ok: false, status: 400, message: "image_base64 is required" };
  }
  if (typeof mediaType !== "string" || !ALLOWED_MEDIA_TYPES.has(mediaType)) {
    return { ok: false, status: 400, message: "media_type must be image/jpeg, image/png or image/webp" };
  }
  // 4 base64 chars = 3 bytes; reject before decoding.
  if (base64.length > Math.ceil((MAX_IMAGE_BYTES / 3) * 4)) {
    return { ok: false, status: 413, message: "image too large (max 3MB) — compression should happen client-side" };
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch {
    return { ok: false, status: 400, message: "image_base64 is not valid base64" };
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return { ok: false, status: 413, message: "image too large (max 3MB)" };
  }
  if (sniffImageType(bytes) !== mediaType) {
    return { ok: false, status: 415, message: "image content does not match media_type (jpeg, png or webp only)" };
  }
  return { ok: true, bytes, mediaType: mediaType as ImageMediaType, base64 };
}

/** Run the vision model over a validated image and return its structured read. */
export async function extractMenu(
  apiKey: string,
  image: { base64: string; mediaType: ImageMediaType },
  maxTokens = 2048,
): Promise<{ ok: true; extracted: ExtractedMenu } | ExtractFailure> {
  const anthropic = new Anthropic({ apiKey });
  try {
    const response = await anthropic.messages.create({
      model: VISION_MODEL,
      max_tokens: maxTokens,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema: EXTRACTION_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
            { type: "text", text: "Extract the happy hour deal(s) from this image." },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal") {
      return { ok: false, status: 422, message: "the model declined to process this image" };
    }
    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { ok: false, status: 502, message: "extraction returned no result — try a clearer photo" };
    }
    return { ok: true, extracted: JSON.parse(textBlock.text) as ExtractedMenu };
  } catch (e) {
    if (e instanceof RateLimitError) {
      return { ok: false, status: 503, message: "extraction service is rate-limited — try again shortly" };
    }
    if (e instanceof APIError) {
      return { ok: false, status: 502, message: `extraction failed (${e.status ?? "network"})` };
    }
    return { ok: false, status: 502, message: "extraction returned malformed data — try again" };
  }
}

export function imageExtension(mediaType: ImageMediaType): string {
  return mediaType === "image/png" ? "png" : mediaType === "image/webp" ? "webp" : "jpg";
}

/** Store image bytes in the (private) submission-images bucket. */
export async function storeImage(
  bucket: R2Bucket,
  key: string,
  bytes: Uint8Array,
  mediaType: ImageMediaType,
): Promise<void> {
  await bucket.put(key, bytes, { httpMetadata: { contentType: mediaType } });
}

/**
 * Shape a model read into form pre-fill for the public submitter. Only
 * well-formed values pass; anything missing is left empty for the person to
 * fill in, and the final submit is validated like any typed submission.
 * "Found" means at least one deal with a description: a photo of a cat or a
 * blank wall comes back with none.
 */
export function toPhotoPrefill(
  extracted: ExtractedMenu,
): Pick<MenuPhotoResult, "found" | "venue_name" | "venue_address" | "deals"> {
  const deals: PhotoPrefillDeal[] = [];
  for (const d of Array.isArray(extracted.deals) ? extracted.deals : []) {
    if (deals.length >= MAX_DEALS_PER_SUBMISSION) break;
    const description = (typeof d?.description === "string" ? d.description : "").trim().slice(0, 1000);
    if (!description) continue;
    const days = Array.isArray(d.days_of_week)
      ? [...new Set(d.days_of_week.filter((v) => Number.isInteger(v) && v >= 0 && v <= 6))].sort()
      : [];
    const time = (t: unknown) => (isValidTime(t) ? t.slice(0, 5) : "");
    deals.push({ days_of_week: days, start_time: time(d.start_time), end_time: time(d.end_time), description });
  }
  const text = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
  return {
    found: deals.length > 0,
    venue_name: text(extracted.venue_name, 200),
    venue_address: text(extracted.venue_address, 500),
    deals,
  };
}
