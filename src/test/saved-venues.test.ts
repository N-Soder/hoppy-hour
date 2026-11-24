// The offline fallback: which venues the list shows when this session has no
// data, and the saved entry that stands in for it.
import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api";
import type { VenueWithHappyHours } from "@/lib/api-types";
import {
  SAVED_VENUES_MAX_AGE_MS,
  formatSavedTime,
  isNetworkError,
  loadSavedVenues,
  parseSavedVenues,
  saveVenues,
  selectVenueSource,
  type SavedVenues,
} from "@/lib/saved-venues";

const venue = (id: string): VenueWithHappyHours => ({
  id,
  name: `Venue ${id}`,
  address: "1 Main St",
  country: "AU",
  lat: -31.95,
  lng: 115.86,
  timezone: "Australia/Perth",
  distance_meters: 100,
  happy_hours: [],
});

const NOW = new Date(2026, 10, 24, 18, 30).getTime();
const saved: SavedVenues = { lng: 115.86, lat: -31.95, radius: 5000, savedAt: NOW - 3_600_000, venues: [venue("s")] };
const live = [venue("l")];

describe("selectVenueSource", () => {
  it("always prefers this session's data, even offline or after a failed refresh", () => {
    expect(selectVenueSource({ live, online: false, error: null, saved })).toEqual({ kind: "live", venues: live });
    expect(selectVenueSource({ live, online: true, error: new ApiError(0, "x"), saved }).kind).toBe("live");
    expect(selectVenueSource({ live: [], online: false, error: null, saved })).toEqual({ kind: "live", venues: [] });
  });

  it("shows the saved list when offline with nothing loaded", () => {
    expect(selectVenueSource({ live: undefined, online: false, error: null, saved })).toEqual({
      kind: "saved",
      venues: saved.venues,
      savedAt: saved.savedAt,
    });
  });

  it("shows the saved list when the request never reached the server", () => {
    expect(selectVenueSource({ live: undefined, online: true, error: new ApiError(0, "Network error"), saved }).kind).toBe("saved");
    expect(selectVenueSource({ live: undefined, online: true, error: new TypeError("Failed to fetch"), saved }).kind).toBe("saved");
  });

  it("keeps the error state for a server error, so a retry isn't hidden behind old results", () => {
    expect(selectVenueSource({ live: undefined, online: true, error: new ApiError(500, "boom"), saved })).toEqual({ kind: "none" });
  });

  it("falls through to the normal states while online and loading, or with nothing saved", () => {
    expect(selectVenueSource({ live: undefined, online: true, error: null, saved }).kind).toBe("none");
    expect(selectVenueSource({ live: undefined, online: false, error: null, saved: null }).kind).toBe("none");
    expect(selectVenueSource({ live: undefined, online: true, error: new ApiError(0, "x"), saved: null }).kind).toBe("none");
  });
});

describe("isNetworkError", () => {
  it("is true only for requests that never got a response", () => {
    expect(isNetworkError(new ApiError(0, "x"))).toBe(true);
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new ApiError(503, "x"))).toBe(false);
    expect(isNetworkError(new Error("x"))).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });
});

describe("saved entry", () => {
  it("round-trips through storage, keeping only the most recent query", () => {
    const store = window.localStorage;
    store.clear();
    saveVenues({ ...saved, venues: [venue("old")] }, store);
    saveVenues(saved, store);
    expect(loadSavedVenues(store, NOW)).toEqual(saved);
  });

  it("is ignored when malformed, too old, or from the future", () => {
    expect(parseSavedVenues(null, NOW)).toBeNull();
    expect(parseSavedVenues({ ...saved, venues: "x" }, NOW)).toBeNull();
    expect(parseSavedVenues({ ...saved, lat: "1" }, NOW)).toBeNull();
    expect(parseSavedVenues({ ...saved, savedAt: NOW - SAVED_VENUES_MAX_AGE_MS - 1 }, NOW)).toBeNull();
    expect(parseSavedVenues({ ...saved, savedAt: NOW + 3_600_000 }, NOW)).toBeNull();
  });

  it("drops venues that aren't venue-shaped", () => {
    const parsed = parseSavedVenues({ ...saved, venues: [venue("a"), { id: 1 }, null] }, NOW);
    expect(parsed?.venues.map((v) => v.id)).toEqual(["a"]);
  });

  it("survives storage that throws", () => {
    const broken = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("quota"); },
    } as unknown as Storage;
    expect(() => saveVenues(saved, broken)).not.toThrow();
    expect(loadSavedVenues(broken, NOW)).toBeNull();
    expect(loadSavedVenues(null, NOW)).toBeNull();
  });
});

describe("formatSavedTime", () => {
  it("gives the time today, 'yesterday' or a short date before that", () => {
    expect(formatSavedTime(new Date(2026, 10, 24, 17, 42).getTime(), NOW)).toBe("5:42 pm");
    expect(formatSavedTime(new Date(2026, 10, 24, 9, 0).getTime(), NOW)).toBe("9 am");
    expect(formatSavedTime(new Date(2026, 10, 23, 21, 5).getTime(), NOW)).toBe("yesterday, 9:05 pm");
    expect(formatSavedTime(new Date(2026, 10, 20, 18, 0).getTime(), NOW)).toBe("Fri 20 Nov, 6 pm");
  });
});
