// Installed-app and title plumbing: theme-color metas, page titles, the
// noindex meta, and the phone/desktop layout query.
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DARK_MEDIA, LIGHT_MEDIA, THEME_COLORS, applyThemeColor, themeColorMetas } from "@/lib/theme-color";
import { DEFAULT_TITLE, pageTitle, useDocumentTitle, useNoIndex } from "@/hooks/use-document-title";
import { PHONE_QUERY, SHORT_TOUCH_QUERY } from "@/hooks/use-mobile";
import tailwindConfig from "../../tailwind.config";

describe("theme-color", () => {
  function headWithMetas() {
    const doc = document.implementation.createHTMLDocument("t");
    doc.head.innerHTML = `
      <meta name="theme-color" media="(prefers-color-scheme: light)" content="#000">
      <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000">`;
    return doc;
  }
  const metas = (doc: Document) => [...doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  const described = (doc: Document) => metas(doc).map((m) => `${m.getAttribute("media") ?? "any"} ${m.content}`);

  it("follows the system with per-scheme values when the theme is system", () => {
    const doc = headWithMetas();
    applyThemeColor("system", doc);
    expect(described(doc)).toEqual([`${LIGHT_MEDIA} ${THEME_COLORS.light}`, `${DARK_MEDIA} ${THEME_COLORS.dark}`]);
    expect(themeColorMetas(undefined)).toEqual(themeColorMetas("system"));
  });

  it("a picked theme leaves one meta with no media query, so the system setting cannot win over it", () => {
    const doc = headWithMetas();
    applyThemeColor("dark", doc);
    expect(described(doc)).toEqual([`any ${THEME_COLORS.dark}`]);
    applyThemeColor("light", doc);
    expect(described(doc)).toEqual([`any ${THEME_COLORS.light}`]);
    applyThemeColor("system", doc);
    expect(described(doc)).toEqual([`${LIGHT_MEDIA} ${THEME_COLORS.light}`, `${DARK_MEDIA} ${THEME_COLORS.dark}`]);
  });

  it("replaces the metas rather than editing them, so Safari re-reads the colour on a live switch", () => {
    const doc = headWithMetas();
    const before = metas(doc);
    applyThemeColor("dark", doc);
    applyThemeColor("dark", doc);
    const after = metas(doc);
    expect(after).toHaveLength(1);
    expect(before.some((m) => m.isConnected)).toBe(false);
    applyThemeColor("dark", doc); // also on a system change while "system" is chosen
    expect(metas(doc)[0]).not.toBe(after[0]);
    expect(metas(doc)[0].parentNode).toBe(doc.head);
  });

  it("index.html's inline theme script does the same before first paint", () => {
    const html = readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
    for (const [stored, system, expected] of [
      ["dark", false, [`any ${THEME_COLORS.dark}`]],
      ["light", true, [`any ${THEME_COLORS.light}`]],
      ["system", true, [`${LIGHT_MEDIA} ${THEME_COLORS.light}`, `${DARK_MEDIA} ${THEME_COLORS.dark}`]],
      [null, false, [`${LIGHT_MEDIA} ${THEME_COLORS.light}`, `${DARK_MEDIA} ${THEME_COLORS.dark}`]],
    ] as const) {
      const doc = headWithMetas();
      doc.head.querySelectorAll("meta").forEach((m, i) => (m.content = i === 0 ? THEME_COLORS.light : THEME_COLORS.dark));
      const win = {
        localStorage: { getItem: () => stored },
        matchMedia: () => ({ matches: system }),
      };
      new Function("window", "document", "localStorage", script)(win, doc, win.localStorage);
      expect(described(doc), String(stored)).toEqual(expected);
    }
  });

  it("index.html ships the same colours before any JavaScript runs", () => {
    const html = readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");
    expect(html).toContain(`media="(prefers-color-scheme: light)" content="${THEME_COLORS.light}"`);
    expect(html).toContain(`media="(prefers-color-scheme: dark)" content="${THEME_COLORS.dark}"`);
    expect(html).not.toContain('name="apple-mobile-web-app-capable"');
  });
});

describe("page titles", () => {
  it("formats a page name, or the default", () => {
    expect(pageTitle("Submit a deal")).toBe("Submit a deal – HoppyHour");
    expect(pageTitle("  ")).toBe(DEFAULT_TITLE);
    expect(pageTitle(null)).toBe(DEFAULT_TITLE);
  });

  it("sets the title while mounted, follows changes, and restores the default", () => {
    const Page = ({ name }: { name?: string }) => {
      useDocumentTitle(name);
      return null;
    };
    const { rerender, unmount } = render(createElement(Page, { name: "South Bird" }));
    expect(document.title).toBe("South Bird – HoppyHour");
    rerender(createElement(Page, { name: undefined }));
    expect(document.title).toBe(DEFAULT_TITLE);
    rerender(createElement(Page, { name: "Admin" }));
    expect(document.title).toBe("Admin – HoppyHour");
    unmount();
    expect(document.title).toBe(DEFAULT_TITLE);
  });

  it("adds a noindex robots meta only while the not-found page is shown", () => {
    const NotFound = () => {
      useNoIndex();
      return null;
    };
    const { unmount } = render(createElement(NotFound));
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex");
    unmount();
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });
});

describe("layout breakpoint", () => {
  it("treats a short touch screen as a phone, at any width", () => {
    expect(PHONE_QUERY).toContain(SHORT_TOUCH_QUERY);
    expect(PHONE_QUERY).toMatch(/max-width: 767\.98px/);
  });

  it("keeps Tailwind's md screen the complement of the phone query", () => {
    const md = (tailwindConfig.theme.extend as { screens: { md: { raw: string } } }).screens.md.raw;
    // Desktop/tablet = wide AND (tall OR not a coarse pointer).
    expect(md).toBe(
      "(min-width: 768px) and (min-height: 501px), (min-width: 768px) and (pointer: fine), (min-width: 768px) and (pointer: none)",
    );
  });
});
