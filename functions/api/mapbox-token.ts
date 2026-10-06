// GET /api/mapbox-token — returns the Mapbox token for client-side GL JS.
// Same-origin, so no CORS machinery. The token's real abuse
// control is URL restrictions set in the Mapbox dashboard.
import type { Env } from "../_shared/db";
import { error, json } from "../_shared/http";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const token = env.MAPBOX_ACCESS_TOKEN;
  if (!token) return error("Token not configured", 500);
  return json({ token }, 200, { "Cache-Control": "private, max-age=3600" });
};
