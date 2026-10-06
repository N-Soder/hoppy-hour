// GET /api/geocode?q=<query> — server-side Mapbox geocoding proxy.
// Keeps the token hidden, and supports an optional country restriction
// (client-supplied ?country=, falling back to GEOCODE_COUNTRY), Mapbox-error
// passthrough (the client relies on the { error, mapbox } shape), and a
// global retry when the country-restricted search is empty. Rate limited per
// IP. Same-origin: no CORS.
import type { Env } from "../_shared/db";
import { error, json } from "../_shared/http";
import { clientIp, rateLimit } from "../_shared/rate-limit";

const GEOCODE_LIMIT_PER_MIN = 30;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const ip = clientIp(request);
  if (!(await rateLimit(env.RATE_LIMIT, "geocode", ip, GEOCODE_LIMIT_PER_MIN))) {
    return error("Too many requests", 429);
  }

  const token = env.MAPBOX_ACCESS_TOKEN;
  if (!token) return error("Token not configured", 500);

  const params = new URL(request.url).searchParams;
  // Truncate by code point so an emoji is never split into a lone surrogate
  // (encodeURIComponent throws on those).
  const q = Array.from((params.get("q") ?? "").trim()).slice(0, 256).join("");
  if (!q) return error("Empty query", 400);

  // Optional passthroughs for the submit form's city picker:
  //  - types=place,locality  → restrict results to cities/towns
  //  - proximity=lng,lat      → bias ranking toward the user's location
  //  - autocomplete=true      → partial-match ranking while typing
  //  - limit=1..10            → number of matches (city search wants several)
  // A "lng,lat" q value makes Mapbox reverse-geocode (used for prefill).
  const extra: string[] = [];
  const types = params.get("types");
  if (types && /^[a-z,]+$/.test(types)) extra.push(`&types=${types}`);
  const proximity = params.get("proximity");
  if (proximity && /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(proximity)) {
    extra.push(`&proximity=${proximity}`);
  }
  if (params.get("autocomplete") === "true") extra.push(`&autocomplete=true`);
  const limitRaw = Number(params.get("limit"));
  const limit = Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= 10 ? limitRaw : 5;

  // The submit form's country picker sends the country the user actually
  // selected; it takes priority over the deployment-wide GEOCODE_COUNTRY
  // default (which only applies when the client hasn't picked one yet, e.g.
  // before any prefill/selection has happened).
  const countryQuery = params.get("country");
  const country =
    countryQuery && /^[a-zA-Z]{2}(,[a-zA-Z]{2})*$/.test(countryQuery) ? countryQuery : env.GEOCODE_COUNTRY;
  const countryParam = country ? `&country=${encodeURIComponent(country)}` : "";
  const base = "https://api.mapbox.com/geocoding/v5/mapbox.places";
  const extraParams = extra.join("");

  // The Mapbox token is URL-restricted (its abuse control, since it's also
  // handed to the browser for GL JS). URL restrictions match the Referer
  // header — a browser sends one, but this server-side fetch would send none
  // and get a 403 "Forbidden". Send the app's own origin as the Referer so the
  // restricted token accepts the request (the origin is already an allowed URL,
  // or the map wouldn't load). GEOCODE_REFERER can override it if the token's
  // allowed URLs use a different host (e.g. a custom domain).
  const referer = env.GEOCODE_REFERER || new URL(request.url).origin;
  const mapboxInit = { headers: { Referer: referer } };

  let res: Response;
  let data: { message?: string; features?: unknown[] };
  try {
    res = await fetch(
      `${base}/${encodeURIComponent(q)}.json?access_token=${token}&limit=${limit}${countryParam}${extraParams}`,
      mapboxInit,
    );
    data = await res.json<{ message?: string; features?: unknown[] }>();
  } catch {
    return error("Geocoding service unavailable", 502);
  }

  // Surface Mapbox errors rather than an empty result the client can't tell
  // apart from "no matches".
  if (!res.ok || data.message) {
    return json(
      { error: data.message ?? "Mapbox API error", mapbox: data },
      res.ok ? 200 : res.status,
    );
  }

  // Country restriction returned nothing → retry globally so a misconfigured
  // GEOCODE_COUNTRY doesn't silently block all geocoding.
  if (countryParam && data.features?.length === 0) {
    try {
      const fallback = await fetch(
        `${base}/${encodeURIComponent(q)}.json?access_token=${token}&limit=${limit}${extraParams}`,
        mapboxInit,
      );
      return json(await fallback.json());
    } catch {
      return error("Geocoding service unavailable", 502);
    }
  }

  return json(data);
};
