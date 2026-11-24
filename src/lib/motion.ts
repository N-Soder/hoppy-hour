// JS-side companion to the prefers-reduced-motion CSS rule in index.css, for
// motion CSS can't reach: map camera moves and programmatic scrolling.

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** scrollIntoView behaviour that respects reduced motion. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}
