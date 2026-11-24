// Link previews for shared venue links (/?venue=<id>). Crawlers and chat apps
// read the HTML without running the app, so functions/index.ts puts the
// venue's name and a short description into <title>, the description meta and
// the Open Graph / Twitter tags of the app shell. Everything here is pure so
// it can be tested without a Worker runtime.

/** Same shape the SPA accepts for ?venue= (src/lib/url-state.ts). */
export const VENUE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface ShareMeta {
  title: string;
  description: string;
  /** Absolute URL of the shared page, for og:url. */
  url: string;
}

export interface VenueShareRow {
  name: string;
  address: string | null;
  deals: number;
}

const MAX_DESCRIPTION = 200;

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Title and description for a venue, e.g. "South Bird – HoppyHour". */
export function venueShareMeta(row: VenueShareRow, url: string): ShareMeta {
  const name = clip(row.name, 120);
  const address = row.address ? clip(row.address, 120) : "";
  const where = address ? `${name}, ${address}` : name;
  const lead =
    row.deals > 0
      ? `${row.deals} happy hour ${row.deals === 1 ? "deal" : "deals"} at ${where}.`
      : `Happy hour deals at ${where}.`;
  return {
    title: `${name} – HoppyHour`,
    description: clip(`${lead} See what's on now and when on HoppyHour.`, MAX_DESCRIPTION),
    url,
  };
}

/** Escape for a double-quoted HTML attribute value. */
export function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape for text content (<title>). */
export function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Set the content of the first <meta> whose `attr` (name / property) equals
 * `key`, whatever the attribute order. Replacement uses a function, so "$&"
 * and friends in a venue name are taken literally.
 */
function setMetaContent(html: string, attr: "name" | "property", key: string, value: string): string {
  const tag = new RegExp(`<meta\\b[^>]*\\b${attr}=["']${key.replace(/[.:]/g, "\\$&")}["'][^>]*>`, "i");
  return html.replace(tag, (t) => t.replace(/\bcontent=(["'])[\s\S]*?\1/i, () => `content="${escapeAttr(value)}"`));
}

/** The app shell with the share tags set to `meta`. Tags it can't find are left alone. */
export function injectShareMeta(html: string, meta: ShareMeta): string {
  let out = html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeText(meta.title)}</title>`);
  out = setMetaContent(out, "name", "description", meta.description);
  out = setMetaContent(out, "property", "og:title", meta.title);
  out = setMetaContent(out, "property", "og:description", meta.description);
  out = setMetaContent(out, "property", "og:url", meta.url);
  out = setMetaContent(out, "name", "twitter:title", meta.title);
  out = setMetaContent(out, "name", "twitter:description", meta.description);
  return out;
}
