import { useCallback, useEffect, useRef, useState } from "react";
import { placeSearchUrl } from "@/lib/geocode";
import {
  MAX_PLACE_SUGGESTIONS,
  PLACE_DEBOUNCE_MS,
  normalise,
  parsePlaces,
  wantsPlaces,
  type PlaceSuggestion,
} from "@/lib/search-suggestions";

export type PlaceLookup =
  | { status: "idle" }
  | { status: "loading"; query: string }
  | { status: "done"; query: string; places: PlaceSuggestion[] }
  | { status: "error"; query: string; message: string };

type Near = { lng: number; lat: number } | null;

// Answers already fetched this session, so typing back over a query (or
// reopening the box) costs no request. Keyed by query and a coarse centre.
const cache = new Map<string, PlaceSuggestion[]>();
const CACHE_MAX = 60;
/** Forget answered lookups (tests). */
export function clearPlaceSuggestionCache() {
  cache.clear();
}
const cacheKey = (q: string, near: Near) =>
  `${normalise(q)}|${near ? `${near.lng.toFixed(1)},${near.lat.toFixed(1)}` : ""}`;

/**
 * Places matching `query` from /api/geocode (worldwide, nearer places first),
 * looked up PLACE_DEBOUNCE_MS after the last change and only from
 * MIN_PLACE_QUERY characters; a newer query cancels the request in flight.
 * `lookUpNow` skips the wait (Enter before the debounce ran out).
 */
export function usePlaceSuggestions(query: string, near: Near, enabled: boolean) {
  const [lookup, setLookup] = useState<PlaceLookup>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nearRef = useRef(near);
  nearRef.current = near;

  const run = useCallback(async (q: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const key = cacheKey(q, nearRef.current);
    const hit = cache.get(key);
    if (hit) {
      setLookup({ status: "done", query: q, places: hit });
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLookup({ status: "loading", query: q });
    try {
      const res = await fetch(placeSearchUrl(q, nearRef.current, { autocomplete: true, limit: MAX_PLACE_SUGGESTIONS }), {
        signal: ctrl.signal,
      });
      if (res.status === 429) {
        setLookup({ status: "error", query: q, message: "Place search is busy. Try again in a moment." });
        return;
      }
      const data: unknown = await res.json();
      if (!res.ok && !(data as { features?: unknown })?.features) throw new Error(String(res.status));
      const places = parsePlaces(data);
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
      cache.set(key, places);
      if (!ctrl.signal.aborted) setLookup({ status: "done", query: q, places });
    } catch {
      if (!ctrl.signal.aborted) setLookup({ status: "error", query: q, message: "Couldn't search places. Check your connection." });
    }
  }, []);

  const trimmed = query.trim();
  const active = enabled && wantsPlaces(trimmed);
  useEffect(() => {
    if (!active) {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
      setLookup({ status: "idle" });
      return;
    }
    const hit = cache.get(cacheKey(trimmed, nearRef.current));
    if (hit) {
      setLookup({ status: "done", query: trimmed, places: hit });
      return;
    }
    // Show the loading row at once; the request waits for typing to pause.
    setLookup({ status: "loading", query: trimmed });
    timerRef.current = setTimeout(() => void run(trimmed), PLACE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [active, trimmed, run]);

  // Nothing left in flight once the box goes away.
  useEffect(() => () => abortRef.current?.abort(), []);

  const lookUpNow = useCallback(() => {
    if (active && timerRef.current) void run(trimmed);
  }, [active, trimmed, run]);

  return { lookup, lookUpNow };
}
