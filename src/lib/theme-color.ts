// The browser chrome colour (Android status bar, installed app title bar,
// Safari's tab bar) follows the app header, which is --card in index.css.
//
// index.html ships two <meta name="theme-color"> tags with media queries, so
// the colour is right for the system theme before any JavaScript runs; its
// inline theme script and ThemeColorSync (App.tsx) override both when the user
// has picked a theme in the app that differs from the system's.

export const THEME_COLORS = { light: "#ffffff", dark: "#221b16" } as const;

export type ThemeChoice = "light" | "dark" | "system" | undefined;

/** The colour each theme-color meta should carry for a theme choice. */
export function themeColorContents(choice: ThemeChoice): { light: string; dark: string } {
  if (choice === "light" || choice === "dark") {
    const c = THEME_COLORS[choice];
    return { light: c, dark: c };
  }
  return { light: THEME_COLORS.light, dark: THEME_COLORS.dark };
}

export function applyThemeColor(choice: ThemeChoice, doc: Document = document): void {
  const contents = themeColorContents(choice);
  doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    const scheme = (meta.getAttribute("media") ?? "").includes("dark") ? "dark" : "light";
    meta.setAttribute("content", contents[scheme]);
  });
}
