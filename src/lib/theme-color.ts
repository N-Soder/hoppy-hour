// The browser chrome colour (Android status bar, installed app title bar)
// follows the app header, which is --card in index.css.
//
// index.html ships two <meta name="theme-color"> tags with media queries, so
// the colour is right for the system theme before any JavaScript runs. When
// the user picks a theme in the app, its inline theme script and
// ThemeColorSync (App.tsx) swap them for one meta without a media query, so
// there is no media match left for the browser to resolve against the system
// setting. The metas are replaced rather than edited in place; a newly
// inserted meta is always re-evaluated.
//
// Safari on iOS 26+ ignores theme-color: it tints the area behind the status
// bar from the page (the fixed element at the top edge, else the body
// background). On the home page that is the fixed header box in
// pages/Index.tsx, which carries bg-card itself so the tint follows a live
// theme switch.

export const THEME_COLORS = { light: "#ffffff", dark: "#221b16" } as const;

export type ThemeChoice = "light" | "dark" | "system" | undefined;

export interface ThemeColorMeta {
  content: string;
  /** Omitted for a colour that applies whatever the system theme. */
  media?: string;
}

export const LIGHT_MEDIA = "(prefers-color-scheme: light)";
export const DARK_MEDIA = "(prefers-color-scheme: dark)";

/** The theme-color metas the page should carry for a theme choice. */
export function themeColorMetas(choice: ThemeChoice): ThemeColorMeta[] {
  if (choice === "light" || choice === "dark") return [{ content: THEME_COLORS[choice] }];
  return [
    { media: LIGHT_MEDIA, content: THEME_COLORS.light },
    { media: DARK_MEDIA, content: THEME_COLORS.dark },
  ];
}

/** Replace the page's theme-color metas with fresh ones for `choice`. */
export function applyThemeColor(choice: ThemeChoice, doc: Document = document): void {
  const old = [...doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  const parent = old[0]?.parentNode ?? doc.head;
  const before = old[0] ?? null;
  for (const { content, media } of themeColorMetas(choice)) {
    const meta = doc.createElement("meta");
    meta.setAttribute("name", "theme-color");
    if (media) meta.setAttribute("media", media);
    meta.setAttribute("content", content);
    parent.insertBefore(meta, before);
  }
  old.forEach((m) => m.remove());
}
