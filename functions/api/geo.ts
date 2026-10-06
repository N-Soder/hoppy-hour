// GET /api/geo — best-effort visitor location from Cloudflare's edge, used to
// passively prefill the submit form's country picker. No permission prompt, no
// location services required: this is derived from the request IP by Cloudflare.
//
// `cf-ipcountry` (ISO 3166-1 alpha-2) is available on all Cloudflare plans.
// City/lat/lng edge headers are plan-gated (Business+), so we only promise
// country here; precise city prefill uses the browser's already-granted
// geolocation on the client instead. Absent in local `wrangler dev` → null.
import type { Env } from "../_shared/db";
import { json } from "../_shared/http";

export const onRequestGet: PagesFunction<Env> = async ({ request }) => {
  const cf = (request as unknown as { cf?: { country?: string } }).cf;
  const header = request.headers.get("cf-ipcountry");
  const raw = cf?.country ?? header ?? null;
  // "XX"/"T1" are Cloudflare placeholders for unknown/Tor — treat as no result.
  const country = raw && /^[A-Z]{2}$/.test(raw) && raw !== "XX" && raw !== "T1" ? raw : null;

  return json({ country }, 200, { "Cache-Control": "private, max-age=3600" });
};
