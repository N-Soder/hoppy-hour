// GET /api/admin/timezone?lat=<num>&lng=<num>
// The IANA time zone the server would derive for these coordinates (same
// lookup as venue create/update). Backs "Detect from location" in the admin
// venue editor, which has no copy of the lookup data in the browser.
import type { Env } from "../../_shared/db";
import { error, json } from "../../_shared/http";
import { timezoneFor } from "../../_shared/timezone";

export const onRequestGet: PagesFunction<Env> = async ({ request }) => {
  const url = new URL(request.url);
  const latRaw = url.searchParams.get("lat");
  const lngRaw = url.searchParams.get("lng");
  if (!latRaw?.trim() || !lngRaw?.trim()) return error("lat and lng are required", 400);
  const timezone = timezoneFor(Number(latRaw), Number(lngRaw));
  if (!timezone) return error("invalid lat/lng", 400);
  return json({ timezone });
};
