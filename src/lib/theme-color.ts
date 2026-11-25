// The browser chrome colour (Android status bar, installed app title bar,
// Safari's status bar strip) follows the app header, which is --card in
// index.css.
//
// index.html ships two <meta name="theme-color"> tags with media queries, so
// the colour is right for the system theme before any JavaScript runs. When
// the user picks a theme in the app, its inline theme script and
// ThemeColorSync (App.tsx) swap them for one meta without a media query.
//
// The metas are replaced, never edited in place. Editing the `content` of the
// media-scoped metas was not picked up by Safari after a live theme switch
// (the strip behind the status bar kept the old colour until a reload, while a
// fresh load was right). A newly inserted theme-color meta is always
// re-evaluated, and with a single unscoped meta there is no media match left
// for the browser to resolve against the system setting.

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

// Safari on iOS 26 ignores theme-color and tints the status bar from a fixed
// element at the top edge, sampling its colour when such an element appears
// and keeping it. So a 1 px strip in the header colour (touch screens only) is
// re-created on every theme change.
//
// It must appear only once the new theme's class is on <html>. Rendered by
// React keyed on the resolved theme, the new strip was committed in the same
// render as the theme state, while next-themes changes the class later, in an
// effect; when a frame was painted in between, Safari sampled the strip in the
// old colour and kept it (the strip stayed white after a live switch to dark,
// now and then). Now the strip is replaced in an animation frame, and only once
// the class matches; it waits more frames if it does not yet.

export const STATUS_BAR_TINT_ATTR = "data-status-bar-tint";
// transition-none: with "reduce motion" on, index.css gives every element a
// near-zero transition (property `all`), so the strip's colour would ease
// rather than switch, and could be sampled part-way.
const TINT_CLASS = "pointer-events-none fixed inset-x-0 top-0 z-[60] hidden bg-card transition-none coarse:block";
/** Frames to wait for the theme class before replacing the strip anyway. */
const MAX_TINT_WAIT_FRAMES = 10;

/** A fresh status-bar strip, replacing any old one. */
export function replaceStatusBarTint(doc: Document = document): HTMLElement {
  doc.querySelectorAll(`[${STATUS_BAR_TINT_ATTR}]`).forEach((el) => el.remove());
  const strip = doc.createElement("div");
  strip.setAttribute(STATUS_BAR_TINT_ATTR, "");
  strip.setAttribute("aria-hidden", "true");
  strip.className = TINT_CLASS;
  strip.style.height = "max(1px, env(safe-area-inset-top))";
  doc.body.appendChild(strip);
  return strip;
}

/**
 * Replace the strip in a later animation frame, once <html> carries the
 * `resolved` theme class. Returns a cancel function.
 */
export function scheduleStatusBarTint(
  resolved: string | undefined,
  doc: Document = document,
  raf: (cb: () => void) => number = (cb) => requestAnimationFrame(cb),
  cancelRaf: (id: number) => void = (id) => cancelAnimationFrame(id),
): () => void {
  let id = 0;
  let frames = 0;
  const tick = () => {
    frames++;
    const ready = !resolved || doc.documentElement.classList.contains(resolved);
    if (ready || frames >= MAX_TINT_WAIT_FRAMES) replaceStatusBarTint(doc);
    else id = raf(tick);
  };
  id = raf(tick);
  return () => cancelRaf(id);
}
