// GET / — the app shell, with link-preview tags for a shared venue link.
//
// A request carrying ?venue=<id> gets that venue's name and a short
// description in <title> and the description / Open Graph / Twitter tags, so
// a link pasted into a chat app or found by a crawler (neither runs the app's
// JavaScript) names the venue. Everything else is passed straight through.
//
// - One indexed read (venues primary key; the deal count uses the
//   happy_hours.venue_id index). Any failure, an unknown or inactive venue,
//   or a non-HTML response falls back to the untouched shell.
// - Only "/" is routed here: other paths, static assets and /api are not.
// - The installed app's service worker answers navigations from its cached
//   shell and never reaches this; the app sets its own title once it runs.
import type { Env } from "./_shared/db";
import { VENUE_ID_RE, injectShareMeta, venueShareMeta, type VenueShareRow } from "./_shared/share-meta";

export const onRequestGet: PagesFunction<Env> = async ({ request, env, next }) => {
  const url = new URL(request.url);
  const id = url.searchParams.get("venue");
  if (!id || !VENUE_ID_RE.test(id)) return next();

  const shell = await next();
  const type = shell.headers.get("content-type") ?? "";
  if (shell.status !== 200 || !type.includes("text/html")) return shell;

  let row: VenueShareRow | null = null;
  try {
    row = await env.DB.prepare(
      // A deal on several days is one row per day; count it once, as the
      // venue detail groups them (src/lib/happy-hour-utils.ts).
      `SELECT v.name AS name, v.address AS address,
              (SELECT COUNT(DISTINCT h.start_time || '|' || h.end_time || '|' || trim(h.description))
                 FROM happy_hours h WHERE h.venue_id = v.id AND h.is_active = 1) AS deals
         FROM venues v
        WHERE v.id = ?1 AND v.status = 'active'`,
    )
      .bind(id)
      .first<VenueShareRow>();
  } catch {
    return shell;
  }
  if (!row || typeof row.name !== "string") return shell;

  let html: string;
  try {
    html = await shell.text();
  } catch {
    return next();
  }

  const shareUrl = `${url.origin}/?venue=${encodeURIComponent(id)}`;
  let body = html;
  try {
    body = injectShareMeta(html, venueShareMeta({ ...row, deals: Number(row.deals) || 0 }, shareUrl));
  } catch {
    // Serve the shell as it was.
  }

  const headers = new Headers(shell.headers);
  // The body differs from the static file now.
  headers.delete("content-length");
  headers.delete("etag");
  return new Response(body, { status: shell.status, statusText: shell.statusText, headers });
};
