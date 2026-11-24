import * as React from "react";

/**
 * The one breakpoint between the phone layout and the desktop/tablet layout.
 * Matches Tailwind's `md` (768px): anything that differs between the two
 * layouts uses `md:` in CSS and this hook in JS, never `sm:`, so there is no
 * band of widths that gets half of each.
 */
export const MOBILE_BREAKPOINT = 768;
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

/**
 * True below 768px. Read synchronously from matchMedia on the first render
 * (this is a client-only SPA), so the first paint already has the right
 * layout instead of rendering desktop and flipping.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false);
}
