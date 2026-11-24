import { describe, it, expect } from "vitest";
import { geoBanner, geoChip, geoStatusForError, hasRealLocation, isLocating } from "@/lib/geo-status";

describe("geoStatusForError", () => {
  it("maps the GeolocationPositionError codes", () => {
    expect(geoStatusForError(1)).toBe("denied");
    expect(geoStatusForError(2)).toBe("unavailable");
    expect(geoStatusForError(3)).toBe("timeout");
    expect(geoStatusForError(undefined)).toBe("unavailable");
  });
});

describe("hasRealLocation", () => {
  it("is true only for a granted position", () => {
    expect(hasRealLocation("granted")).toBe(true);
    for (const s of ["denied", "timeout", "unavailable", "unsupported", "waiting", "requesting"] as const) {
      expect(hasRealLocation(s)).toBe(false);
    }
  });
});

describe("isLocating", () => {
  it("is pending only before any coordinates exist", () => {
    expect(isLocating("requesting", false)).toBe(true);
    expect(isLocating("idle", false)).toBe(true);
    expect(isLocating("requesting", true)).toBe(false);
    expect(isLocating("denied", true)).toBe(false);
  });
});

describe("geoBanner", () => {
  it("does not call a timeout a denial", () => {
    expect(geoBanner("timeout", "Perth", false)?.message).not.toMatch(/denied|off|blocked/i);
  });

  it("distinguishes denied, timed out and unsupported", () => {
    const msgs = (["denied", "timeout", "unsupported"] as const).map((s) => geoBanner(s, "Perth", false)?.message);
    expect(new Set(msgs).size).toBe(3);
  });

  it("explains a hard block after the user asked again", () => {
    expect(geoBanner("denied", "Perth", true)?.message).toMatch(/blocked.*site settings/i);
  });

  it("offers no retry when the browser has no geolocation", () => {
    expect(geoBanner("unsupported", "Perth", false)?.action).toBeNull();
  });

  it("shows nothing once the location is known", () => {
    expect(geoBanner("granted", "Perth", false)).toBeNull();
  });
});

describe("geoChip", () => {
  it("shortens the banner to one line with the same action", () => {
    expect(geoChip("denied", "Perth", false)).toEqual({ label: "Location off · near Perth", action: "Use my location" });
    expect(geoChip("denied", "Perth", true)).toEqual({ label: "Location blocked · near Perth", action: "Try again" });
    expect(geoChip("unsupported", "Perth", false)).toEqual({ label: "No location · near Perth", action: null });
  });
  it("is null when there is no banner", () => {
    expect(geoChip("granted", "Perth", false)).toBeNull();
  });
});
