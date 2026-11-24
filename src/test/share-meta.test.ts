// Link previews for shared venue links: functions/index.ts injects the venue's
// name and a description into the app shell's <title> and share tags.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createSqliteD1, type SqliteD1 } from "./helpers/sqlite-d1";
import { escapeAttr, injectShareMeta, venueShareMeta } from "../../functions/_shared/share-meta";
import { onRequestGet as rootHandler } from "../../functions/index";

const SHELL = readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");

function metaContent(html: string, attr: "name" | "property", key: string): string | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.querySelector(`meta[${attr}="${key}"]`)?.getAttribute("content") ?? null;
}
function titleOf(html: string): string {
  return new DOMParser().parseFromString(html, "text/html").title;
}

describe("venueShareMeta", () => {
  it("names the venue, its address and how many deals it has", () => {
    const m = venueShareMeta({ name: "South Bird", address: "175 William St, Northbridge", deals: 3 }, "https://x/?venue=a");
    expect(m.title).toBe("South Bird – HoppyHour");
    expect(m.description).toBe(
      "3 happy hour deals at South Bird, 175 William St, Northbridge. See what's on now and when on HoppyHour.",
    );
    expect(m.url).toBe("https://x/?venue=a");
  });

  it("reads naturally for one deal, none, or no address", () => {
    expect(venueShareMeta({ name: "Bar", address: "", deals: 1 }, "u").description).toMatch(/^1 happy hour deal at Bar\./);
    expect(venueShareMeta({ name: "Bar", address: null, deals: 0 }, "u").description).toMatch(/^Happy hour deals at Bar\./);
  });

  it("keeps the description short", () => {
    const m = venueShareMeta({ name: "N".repeat(200), address: "A".repeat(200), deals: 2 }, "u");
    expect(m.description.length).toBeLessThanOrEqual(200);
    expect(m.description.endsWith("…")).toBe(true);
  });
});

describe("injectShareMeta", () => {
  const meta = { title: "South Bird – HoppyHour", description: "3 happy hour deals at South Bird.", url: "https://h.test/?venue=abc" };

  it("sets the title, description, Open Graph and Twitter tags of the real shell", () => {
    const out = injectShareMeta(SHELL, meta);
    expect(titleOf(out)).toBe(meta.title);
    expect(metaContent(out, "name", "description")).toBe(meta.description);
    expect(metaContent(out, "property", "og:title")).toBe(meta.title);
    expect(metaContent(out, "property", "og:description")).toBe(meta.description);
    expect(metaContent(out, "property", "og:url")).toBe(meta.url);
    expect(metaContent(out, "name", "twitter:title")).toBe(meta.title);
    expect(metaContent(out, "name", "twitter:description")).toBe(meta.description);
  });

  it("leaves everything else alone", () => {
    const out = injectShareMeta(SHELL, meta);
    expect(metaContent(out, "property", "og:image")).toBe(metaContent(SHELL, "property", "og:image"));
    expect(metaContent(out, "property", "og:type")).toBe("website");
    expect(out).toContain('<script type="module" src="/src/main.tsx"></script>');
    expect(out.split("\n").length).toBe(SHELL.split("\n").length);
  });

  it("escapes markup and quotes so a venue name can't break out of a tag", () => {
    const name = `Joe's "Bar" & Grill</title><script>alert(1)</script>`;
    const out = injectShareMeta(SHELL, { title: name, description: `${name} "desc"`, url: "https://h.test/?venue=x" });
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(titleOf(out)).toBe(name);
    expect(metaContent(out, "property", "og:title")).toBe(name);
    expect(metaContent(out, "name", "twitter:description")).toBe(`${name} "desc"`);
    // Exactly one <title>, still in the head.
    expect(out.match(/<title>/g)).toHaveLength(1);
  });

  it("takes replacement patterns in a name literally", () => {
    const out = injectShareMeta(SHELL, { title: "$& $1 $' Bar", description: "$`", url: "u" });
    expect(titleOf(out)).toBe("$& $1 $' Bar");
    expect(metaContent(out, "name", "description")).toBe("$`");
  });

  it("escapeAttr covers the five special characters", () => {
    expect(escapeAttr(`&"'<>`)).toBe("&amp;&quot;&#39;&lt;&gt;");
  });
});

describe("GET / with ?venue=", () => {
  let d1: SqliteD1;
  beforeEach(() => {
    d1 = createSqliteD1();
    d1.exec(`INSERT INTO venues (id, name, address, country, lat, lng, status)
             VALUES ('v1', 'Bar "One" <b>', '1 Main St', 'AU', -31.95, 115.86, 'active'),
                    ('v2', 'Closed Bar', '2 Main St', 'AU', -31.95, 115.86, 'inactive')`);
    d1.exec(`INSERT INTO happy_hours (id, venue_id, days_of_week, start_time, end_time, description, tags, is_active)
             VALUES ('h1', 'v1', '[5]', '17:00:00', '19:00:00', 'Pints', '[]', 1),
                    ('h2', 'v1', '[6]', '17:00:00', '19:00:00', 'Wine', '[]', 1),
                    ('h2b', 'v1', '[0]', '17:00:00', '19:00:00', 'Wine', '[]', 1),
                    ('h3', 'v1', '[0]', '17:00:00', '19:00:00', 'Old', '[]', 0)`);
  });

  const shellResponse = () =>
    new Response(SHELL, {
      headers: { "Content-Type": "text/html; charset=utf-8", ETag: '"abc"', "X-Frame-Options": "DENY" },
    });

  function call(url: string, env: Record<string, unknown> = { DB: d1.DB }, next = vi.fn(async () => shellResponse())) {
    const res = rootHandler({ request: new Request(url), env, next, params: {}, data: {} } as never) as Promise<Response>;
    return { res, next };
  }

  it("injects the venue into the shell, counting active deals once across days", async () => {
    const { res } = call("https://h.test/?venue=v1&view=map");
    const r = await res;
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(titleOf(html)).toBe('Bar "One" <b> – HoppyHour');
    expect(metaContent(html, "property", "og:description")).toMatch(/^2 happy hour deals at Bar "One" <b>, 1 Main St\./);
    expect(metaContent(html, "property", "og:url")).toBe("https://h.test/?venue=v1");
    expect(html).not.toContain("<b> –");
    // Headers from the static response survive; the stale validator doesn't.
    expect(r.headers.get("X-Frame-Options")).toBe("DENY");
    expect(r.headers.get("ETag")).toBeNull();
  });

  it("passes the shell through untouched for an unknown or inactive venue", async () => {
    for (const id of ["nope", "v2"]) {
      const html = await (await call(`https://h.test/?venue=${id}`).res).text();
      expect(html).toBe(SHELL);
    }
  });

  it("doesn't touch the database without a valid venue parameter", async () => {
    const prepare = vi.fn();
    for (const url of ["https://h.test/", "https://h.test/?venue=", "https://h.test/?venue=a%22b", `https://h.test/?venue=${"x".repeat(65)}`]) {
      const { res, next } = call(url, { DB: { prepare } });
      expect(await (await res).text()).toBe(SHELL);
      expect(next).toHaveBeenCalledTimes(1);
    }
    expect(prepare).not.toHaveBeenCalled();
  });

  it("falls back to the default shell when the database fails", async () => {
    const env = { DB: { prepare: () => { throw new Error("D1 down"); } } };
    const html = await (await call("https://h.test/?venue=v1", env).res).text();
    expect(html).toBe(SHELL);
  });

  it("leaves non-HTML and non-200 responses alone", async () => {
    const notHtml = vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } }));
    expect(await (await call("https://h.test/?venue=v1", { DB: d1.DB }, notHtml).res).text()).toBe("{}");
    const notFound = vi.fn(async () => new Response("gone", { status: 404, headers: { "Content-Type": "text/html" } }));
    const r = await call("https://h.test/?venue=v1", { DB: d1.DB }, notFound).res;
    expect(r.status).toBe(404);
  });
});
