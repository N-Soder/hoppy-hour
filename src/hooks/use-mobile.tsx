import * as React from "react";

/**
 * The one breakpoint between the phone layout and the desktop/tablet layout.
 * Anything that differs between the two layouts uses `md:` in CSS and this
 * hook in JS, never `sm:`, so there is no band of sizes that gets half of each.
 *
 * It is decided by more than width: below 768px wide is a phone, and so is a
 * short (≤500px tall) touch screen at any width — a phone in landscape. A
 * short desktop window (fine pointer) keeps the desktop layout. Tailwind's
 * `md` screen (tailwind.config.ts) is the exact complement of PHONE_QUERY.
 */
export const MOBILE_BREAKPOINT = 768;
export const SHORT_TOUCH_QUERY = "(max-height: 500.98px) and (pointer: coarse)";
export const PHONE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 0.02}px), ${SHORT_TOUCH_QUERY}`;

function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = React.useCallback(() => window.matchMedia(query).matches, [query]);
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * True for the phone layout. Read synchronously from matchMedia on the first
 * render (this is a client-only SPA), so the first paint already has the
 * right layout instead of rendering desktop and flipping.
 */
export function useIsMobile() {
  return useMediaQuery(PHONE_QUERY);
}

/** A short touch screen (a phone in landscape): little height to spare. */
export function useIsShortTouch() {
  return useMediaQuery(SHORT_TOUCH_QUERY);
}
