// POST /api/menu-photo — public "Snap a menu": read a menu photo so the
// submit form can be pre-filled. Nothing is submitted here; the person checks
// the read, edits it, and sends the normal form (POST /api/submissions), which
// validates every field as usual and attaches the photo via `upload_id`.
//
// Order (cheapest first, model spend last):
//   honeypot (silent "nothing found") -> site-wide daily cap (read only) ->
//   per-IP limits (5/hour, 20/day) -> Turnstile -> image validation (type,
//   size, magic bytes) -> count against the site-wide cap -> model -> store
//   the photo under pending/ and mint an upload_id.
//
// The site-wide counter is only spent by verified, well-formed requests, so
// token-less junk can't pause the feature for everyone.
//
// Every limit here fails CLOSED: if KV can't be read or written, the read is
// refused (503 photo_unavailable) and the person uses the normal form. Model
// spend is never unguarded. (Other rateLimit callers still fail open.)
import type { Env } from "../_shared/db";
import { error, json, readJson } from "../_shared/http";
import { clientIp, peekDailyCap, rateLimitStatus, takeDailyCap, type LimitStatus } from "../_shared/rate-limit";
import { verifyTurnstile } from "../_shared/turnstile";
import { decodeImage, extractMenu, toPhotoPrefill } from "../_shared/menu-extract";
import { createPhotoUpload } from "../_shared/photo-upload";
import { PHOTO_ERRORS, type MenuPhotoInput, type MenuPhotoResult } from "../../src/lib/api-types";

export const PHOTO_READS_PER_HOUR = 5;
export const PHOTO_READS_PER_DAY = 20;
export const PHOTO_READS_SITE_PER_DAY = 200;
// A happy-hour read is a few hundred tokens of JSON; this bounds a runaway.
const MAX_TOKENS = 1024;

const NOTHING_FOUND: MenuPhotoResult = {
  found: false,
  upload_id: null,
  expires_in: null,
  venue_name: null,
  venue_address: null,
  deals: [],
};

/** Map a limit check to a refusal, or null to carry on. */
function refusal(status: LimitStatus, limited: string): Response | null {
  if (status === "ok") return null;
  if (status === "limited") return error(limited, 429);
  console.error("photo read refused: rate-limit store unavailable");
  return error(PHOTO_ERRORS.unavailable, 503);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Base64 inflates the 3MB image cap by 4/3; leave headroom for the token.
  const body = await readJson<MenuPhotoInput>(request, 5 * 1024 * 1024);
  if (!body) return error("invalid JSON", 400);
  const ip = clientIp(request);

  // 1. Honeypot — look like an unreadable photo, spend nothing.
  if (typeof body.honeypot === "string" && body.honeypot.length > 0) {
    return json(NOTHING_FOUND);
  }

  // 2. Feature paused for today? Answer before using anyone's quota.
  const paused = refusal(await peekDailyCap(env.RATE_LIMIT, "photo_read", PHOTO_READS_SITE_PER_DAY), PHOTO_ERRORS.paused);
  if (paused) return paused;

  // 3. Per-IP limits. Hour first: once the day is used up the hourly count no
  // longer matters.
  const hourly = refusal(
    await rateLimitStatus(env.RATE_LIMIT, "photo_read", ip, PHOTO_READS_PER_HOUR, "hour"),
    PHOTO_ERRORS.rateLimited,
  );
  if (hourly) return hourly;
  const daily = refusal(
    await rateLimitStatus(env.RATE_LIMIT, "photo_read", ip, PHOTO_READS_PER_DAY, "day"),
    PHOTO_ERRORS.rateLimited,
  );
  if (daily) return daily;

  // 4. Turnstile (single-use token; the final submit needs its own).
  if (!(await verifyTurnstile(
    env.TURNSTILE_SECRET_KEY, body.turnstile_token ?? "", ip, new URL(request.url).hostname,
  ))) {
    return error("turnstile_failed", 403);
  }

  // 5. The image itself: declared type, size, and real content (magic bytes).
  const image = decodeImage(body.image_base64, body.media_type);
  if (!image.ok) return error(image.message, image.status);

  // 6. Site-wide spend, counted only now that the request is real.
  const capped = refusal(await takeDailyCap(env.RATE_LIMIT, "photo_read", PHOTO_READS_SITE_PER_DAY), PHOTO_ERRORS.paused);
  if (capped) return capped;

  // 7. Read it.
  const result = await extractMenu(env.ANTHROPIC_API_KEY, image, MAX_TOKENS);
  if (!result.ok) {
    // A refusal means "not something we can read" — same answer as no deal.
    if (result.status === 422) return json(NOTHING_FOUND);
    return error(result.message, result.status);
  }
  const prefill = toPhotoPrefill(result.extracted);
  // Nothing to attach a photo to: don't keep it.
  if (!prefill.found) return json(NOTHING_FOUND);

  // 8. Store once, hand back an opaque handle (never the key or a URL).
  const upload = await createPhotoUpload(env, image.bytes, image.mediaType, ip);
  return json({
    ...prefill,
    upload_id: upload.uploadId,
    expires_in: upload.expiresIn,
  } satisfies MenuPhotoResult);
};
