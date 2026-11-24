import { useEffect } from "react";

/** The home page's title, as in index.html (and the server-rendered default). */
export const DEFAULT_TITLE = "HoppyHour – Find happy hour deals near you";

/** "Submit a deal – HoppyHour"; the default title when there is no page name. */
export function pageTitle(name?: string | null): string {
  const n = name?.trim();
  return n ? `${n} – HoppyHour` : DEFAULT_TITLE;
}

/**
 * Sets document.title for the current page. Every route calls it, so moving
 * between routes always lands on the right title; on unmount it puts back the
 * default, so a route that renders nothing of its own never inherits a stale
 * one (e.g. a venue name after leaving the map).
 */
export function useDocumentTitle(name?: string | null): void {
  const title = pageTitle(name);
  useEffect(() => {
    document.title = title;
  }, [title]);
  useEffect(
    () => () => {
      document.title = DEFAULT_TITLE;
    },
    [],
  );
}

/**
 * Adds <meta name="robots" content="noindex"> while mounted (the not-found
 * page: the SPA answers every path with 200, so this is how crawlers learn
 * that a path is not a page).
 */
export function useNoIndex(): void {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
}
