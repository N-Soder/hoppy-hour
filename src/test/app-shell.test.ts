// Installed-app and title plumbing: theme-color metas, page titles, the
// noindex meta, and the phone/desktop layout query.
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { THEME_COLORS, applyThemeColor, themeColorContents } from "@/lib/theme-color";
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
  const contents = (doc: Document) =>
    [...doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content);

  it("follows the system with per-scheme values when the theme is system", () => {
    const doc = headWithMetas();
    applyThemeColor("system", doc);
    expect(contents(doc)).toEqual([THEME_COLORS.light, THEME_COLORS.dark]);
    expect(themeColorContents(undefined)).toEqual(THEME_COLORS);
  });

  it("uses the chosen theme's colour for both schemes when the user picked one", () => {
    const doc = headWithMetas();
    applyThemeColor("dark", doc);
    expect(contents(doc)).toEqual([THEME_COLORS.dark, THEME_COLORS.dark]);
    applyThemeColor("light", doc);
    expect(contents(doc)).toEqual([THEME_COLORS.light, THEME_COLORS.light]);
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
