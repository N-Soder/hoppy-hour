// Runs before every /api/admin/* Function. Defence-in-depth behind Cloudflare
// Access: validates the signed Cf-Access-Jwt-Assertion header (issuer + audience)
// so the admin API stays safe even if the dashboard Access config drifts.
// Access is still the primary gate at the edge.
//
// Local dev has no Access edge, so a .dev.vars-only DEV_BYPASS_ACCESS flag skips
// verification — but only for requests to a loopback host, so the flag fails
// closed if it is ever set on a deployed environment by mistake.
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../../_shared/db";

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF guard for state-changing admin requests. Access authenticates via a
 * cookie, so a cross-site form/fetch could otherwise ride an admin's session.
 * Browsers always send Sec-Fetch-Site and/or Origin on such requests; non-browser
 * clients (e.g. Access service tokens via curl) send neither and are allowed.
 */
export function isCrossSiteWrite(request: Request): boolean {
  if (SAFE_METHODS.has(request.method)) return false;
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin" && site !== "none") return true;
  const origin = request.headers.get("Origin");
  return origin !== null && origin !== new URL(request.url).origin;
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  if (ctx.env.DEV_BYPASS_ACCESS === "1" && LOOPBACK_HOSTS.has(new URL(ctx.request.url).hostname)) {
    ctx.data.adminEmail = "dev@localhost";
    return ctx.next();
  }

  if (isCrossSiteWrite(ctx.request)) {
    return new Response("Forbidden", { status: 403 });
  }

  const token = ctx.request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || !ctx.env.ACCESS_TEAM_DOMAIN || !ctx.env.ACCESS_AUD) {
    return new Response("Forbidden", { status: 403 });
  }

  const issuer = `https://${ctx.env.ACCESS_TEAM_DOMAIN}`;
  jwks ??= createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: ctx.env.ACCESS_AUD,
    });
    ctx.data.adminEmail = (payload.email as string | undefined) ?? "admin";
    return ctx.next();
  } catch {
    return new Response("Forbidden", { status: 403 });
  }
};
