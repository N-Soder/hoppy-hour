import { describe, it, expect } from "vitest";
import { haversineMeters, suggestVenueMatches, venueNameScore } from "@/lib/venue-match";
import type { Venue } from "@/lib/api-types";

const venue = (over: Partial<Venue>): Venue => ({
  id: "v1",
  name: "Test Venue",
  address: "1 Test St",
  country: "AU",
  lat: null,
  lng: null,
  status: "active",
  ...over,
});

describe("venueNameScore", () => {
  it("scores identical names as 1", () => {
    expect(venueNameScore("The Crown Hotel", "The Crown Hotel")).toBe(1);
  });

  it("tolerates 'The' and punctuation drift", () => {
    expect(venueNameScore("The Crown Hotel", "Crown Hotel")).toBeGreaterThan(0.7);
    expect(venueNameScore("Murphy's", "Murphys Bar")).toBeGreaterThan(0.45);
  });

  it("scores unrelated names low", () => {
    expect(venueNameScore("The Crown Hotel", "Neon Palms")).toBeLessThan(0.2);
  });

  it("handles diacritics", () => {
    expect(venueNameScore("Café Sol", "Cafe Sol")).toBe(1);
  });

  it("returns 0 for empty names", () => {
    expect(venueNameScore("", "Crown Hotel")).toBe(0);
  });
});

describe("haversineMeters", () => {
  it("is ~0 for the same point", () => {
    expect(haversineMeters(-31.95, 115.86, -31.95, 115.86)).toBeCloseTo(0);
  });

  it("computes a known distance within tolerance", () => {
    // ~111m per 0.001 degrees of latitude
    const d = haversineMeters(-31.95, 115.86, -31.951, 115.86);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(125);
  });
});

describe("suggestVenueMatches", () => {
  const crown = venue({ id: "crown", name: "The Crown Hotel", lat: -31.95, lng: 115.86 });
  const far = venue({ id: "far", name: "Far Away Bar", lat: -33.86, lng: 151.2 });
  const noCoords = venue({ id: "nc", name: "Crown Hotel", lat: null, lng: null });

  it("matches by proximity even when the name differs", () => {
    const matches = suggestVenueMatches("Illegible Chalkboard", { lat: -31.9501, lng: 115.8601 }, [crown, far]);
    expect(matches.map((m) => m.venue.id)).toEqual(["crown"]);
    expect(matches[0].distance_m).not.toBeNull();
    expect(matches[0].distance_m!).toBeLessThan(250);
  });

  it("matches by name when there are no coordinates at all", () => {
    const matches = suggestVenueMatches("Crown Hotel", null, [crown, far, noCoords]);
    expect(matches.map((m) => m.venue.id)).toContain("crown");
    expect(matches.map((m) => m.venue.id)).toContain("nc");
    expect(matches.map((m) => m.venue.id)).not.toContain("far");
  });

  it("ranks near+named above name-only", () => {
    const matches = suggestVenueMatches("Crown Hotel", { lat: -31.95, lng: 115.86 }, [noCoords, crown]);
    expect(matches[0].venue.id).toBe("crown");
  });

  it("returns nothing when neither signal fires", () => {
    expect(suggestVenueMatches("Neon Palms", { lat: 10, lng: 10 }, [crown, far])).toEqual([]);
  });

  it("caps results at the limit", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      venue({ id: `v${i}`, name: "Crown Hotel", lat: -31.95, lng: 115.86 }),
    );
    expect(suggestVenueMatches("Crown Hotel", { lat: -31.95, lng: 115.86 }, many).length).toBe(5);
  });
});
