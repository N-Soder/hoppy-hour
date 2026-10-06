// POST /api/submissions — public deal submission.
// Order: honeypot (cheapest, silent success) -> rate limit -> Turnstile -> field
// validation -> insert. Replaces the direct RLS insert and consolidates spam
// defence server-side.
import type { Env } from "../_shared/db";
import { toHms } from "../_shared/db";
import { error, json, readJson } from "../_shared/http";
import { clientIp, rateLimit } from "../_shared/rate-limit";
import {
  normalizeTags,
  validateDealFields,
  validateExtraDeals,
  isStringLen,
  isOptionalStringLen,
  isCountryCode,
  isLatLng,
} from "../_shared/validate";
import { MAX_DEALS_PER_SUBMISSION, type SubmissionInput } from "../../src/lib/api-types";

const SUBMIT_LIMIT_PER_MIN = 3;

async function verifyTurnstile(secret: string, token: string, ip: string): Promise<boolean> {
  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  form.set("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    const data = await res.json<{ success?: boolean }>();
    return data.success === true;
  } catch {
    return false;
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await readJson<SubmissionInput>(request);
  if (!body) return error("invalid JSON", 400);

  const ip = clientIp(request);

  // 1. Honeypot — silent success (201, byte-identical to a real one). No row.
  if (typeof body.honeypot === "string" && body.honeypot.length > 0) {
    return json({ ok: true }, 201);
  }

  // 2. Rate limit.
  if (!(await rateLimit(env.RATE_LIMIT, "submit", ip, SUBMIT_LIMIT_PER_MIN))) {
    return error("rate_limited", 429);
  }

  // 3. Turnstile.
  if (!(await verifyTurnstile(env.TURNSTILE_SECRET_KEY, body.turnstile_token ?? "", ip))) {
    return error("turnstile_failed", 403);
  }

  // 4. Field validation.
  if (!isStringLen(body.venue_name, 200)) return error("venue_name is required (max 200)", 400);
  if (!isStringLen(body.city, 200)) return error("city is required (max 200)", 400);
  if (!isCountryCode(body.country)) return error("country must be a 2-letter ISO code", 400);
  if (!isOptionalStringLen(body.venue_address, 500)) return error("venue_address must be at most 500 chars", 400);
  if (!isLatLng(body.lat, body.lng)) return error("lat and lng are required", 400);
  const fieldErr = validateDealFields(body);
  if (fieldErr) return error(fieldErr, 400);
  const extrasErr = validateExtraDeals(body.extra_deals, MAX_DEALS_PER_SUBMISSION);
  if (extrasErr) return error(extrasErr, 400);

  // Normalize extra deals the same way deal #1 is normalized below.
  const extraDeals = (body.extra_deals ?? []).map((d) => ({
    days_of_week: d.days_of_week,
    start_time: toHms(d.start_time),
    end_time: toHms(d.end_time),
    description: d.description,
    tags: normalizeTags(d.tags),
  }));

  await env.DB.prepare(
    `INSERT INTO submissions (id, venue_name, venue_address, city, country, lat, lng,
                              days_of_week, start_time, end_time, description, tags,
                              extra_deals, status)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'pending')`,
  ).bind(
    crypto.randomUUID(),
    body.venue_name,
    body.venue_address && body.venue_address.trim() ? body.venue_address.trim() : "",
    body.city,
    body.country.toUpperCase(),
    body.lat,
    body.lng,
    JSON.stringify(body.days_of_week),
    toHms(body.start_time),
    toHms(body.end_time),
    body.description,
    JSON.stringify(normalizeTags(body.tags)),
    JSON.stringify(extraDeals),
  ).run();

  return json({ ok: true }, 201);
};
