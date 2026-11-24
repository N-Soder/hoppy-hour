import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api";
import {
  approveBlockers,
  checkCoordInputs,
  dealSummary,
  dealTimeError,
  describePin,
  endsNextDay,
  filterVenues,
  initialPin,
  locationLabel,
  readableError,
  sortVenues,
  splitCoordPair,
  venueCountLabel,
  type ApproveCheckInput,
} from "@/lib/admin";
import type { Venue } from "@/lib/api-types";

describe("readableError", () => {
  it("never shows a raw status text", () => {
    const msg = readableError(new ApiError(500, "Internal Server Error"));
    expect(msg).not.toMatch(/Internal Server Error/);
    expect(msg).toMatch(/couldn't finish that \(error 500\)/);
    expect(readableError(new ApiError(502, ""))).toMatch(/error 502/);
  });

  it("explains auth, rate limits and already-handled submissions", () => {
    expect(readableError(new ApiError(403, "Forbidden"))).toMatch(/session has expired/);
    expect(readableError(new ApiError(429, "Too many requests"))).toMatch(/Wait a minute/);
    expect(readableError(new ApiError(409, "not pending or not found"))).toMatch(/already handled/);
    expect(readableError(new ApiError(409, "already approved"))).toMatch(/already handled/);
  });

  it("sentence-cases validation messages and keeps network copy", () => {
    expect(readableError(new ApiError(400, "name is required (max 200)"))).toBe("Name is required (max 200)");
    expect(readableError(new ApiError(0, "Network error — check your connection and try again."))).toBe(
      "Network error — check your connection and try again.",
    );
    expect(readableError(new Error("boom"))).toBe("Boom");
  });
});

describe("deal times", () => {
  it("treats start after end as ending the next day", () => {
    expect(endsNextDay("22:00", "02:00")).toBe(true);
    expect(endsNextDay("22:00:00", "00:00:00")).toBe(true);
    expect(endsNextDay("17:00", "19:00")).toBe(false);
    expect(endsNextDay("00:00", "23:59")).toBe(false);
  });

  it("allows overnight deals and rejects only empty or zero-length ranges", () => {
    expect(dealTimeError("22:00", "02:00")).toBeNull();
    expect(dealTimeError("17:00", "19:00")).toBeNull();
    expect(dealTimeError("17:00", "17:00:00")).toMatch(/same time/);
    expect(dealTimeError("", "17:00")).toMatch(/start and end/);
  });

  it("summarises a deal Monday-first with the shared time format", () => {
    expect(dealSummary({ days_of_week: [5, 1, 2, 3, 4], start_time: "17:00:00", end_time: "18:00:00" })).toBe(
      "Mon–Fri, 5–6 pm",
    );
    expect(dealSummary({ days_of_week: [0, 6], start_time: "22:00", end_time: "02:00" })).toBe(
      "Sat, Sun, 10 pm–2 am, ends next day",
    );
  });
});

describe("coordinate inputs", () => {
  it("validates each field inline and only yields coords when both are valid", () => {
    expect(checkCoordInputs({ lat: "", lng: "" })).toEqual({ latError: null, lngError: null, coords: null });
    expect(checkCoordInputs({ lat: "-31.95", lng: "115.86" }).coords).toEqual({ lat: -31.95, lng: 115.86 });
    const bad = checkCoordInputs({ lat: "95", lng: "abc" });
    expect(bad.latError).toMatch(/between -90 and 90/);
    expect(bad.lngError).toMatch(/must be a number/);
    expect(bad.coords).toBeNull();
  });

  it("splits a pasted Google Maps pair", () => {
    expect(splitCoordPair("-31.95004, 115.86056")).toEqual({ lat: "-31.95004", lng: "115.86056" });
    expect(splitCoordPair("-31.95")).toBeNull();
  });
});

describe("locationLabel", () => {
  it("joins street, city and country without repeating an address that already names them", () => {
    expect(locationLabel({ venue_address: "12 Example St", city: "Perth", country: "AU" })).toBe(
      "12 Example St, Perth, Australia",
    );
    expect(locationLabel({ venue_address: "Smalltown, Australia", city: "Smalltown", country: "AU" })).toBe(
      "Smalltown, Australia",
    );
    expect(locationLabel({ venue_address: "", city: null, country: null })).toBe("");
  });
});

describe("review pin", () => {
  it("labels a form submission's coordinates as approximate city centre", () => {
    const pin = initialPin({ lat: -32.2, lng: 115.7, country: "AU", source: "form" });
    expect(pin?.source).toBe("city");
    expect(describePin("city")).toEqual({ label: "Approximate (city centre)", exact: false });
    expect(describePin("address").exact).toBe(true);
  });

  it("has no pin when the submission arrived without coordinates", () => {
    expect(initialPin({ lat: null, lng: null, country: "AU", source: "form" })).toBeNull();
  });
});

describe("approveBlockers", () => {
  const ready: ApproveCheckInput = {
    venueName: "Pub",
    deals: [{ days_of_week: [1], start_time: "22:00", end_time: "02:00", description: "$5 pints" }],
    attached: false,
    updateAttachedDetails: false,
    attachedHasCoords: false,
    hasPin: true,
    geocoding: false,
  };

  it("is empty when everything is in place, including an overnight deal", () => {
    expect(approveBlockers(ready)).toEqual([]);
  });

  it("requires a location for a new venue (null-coordinate submissions)", () => {
    expect(approveBlockers({ ...ready, hasPin: false })).toEqual([
      "Set a location: look up the address, or enter coordinates by hand.",
    ]);
  });

  it("does not need a location when attaching to a venue that has one", () => {
    expect(approveBlockers({ ...ready, hasPin: false, attached: true, attachedHasCoords: true })).toEqual([]);
  });

  it("names each incomplete deal", () => {
    const out = approveBlockers({
      ...ready,
      deals: [ready.deals[0], { days_of_week: [], start_time: "17:00", end_time: "17:00", description: "" }],
    });
    expect(out).toEqual(["Deal 2 needs a day and a description.", "Deal 2: start and end can't be the same time."]);
  });
});

describe("venues table", () => {
  const v = (name: string, status: Venue["status"], deal_count: number, address = "1 St"): Venue => ({
    id: `${name}-${address}`,
    name,
    address,
    country: "AU",
    lat: 0,
    lng: 0,
    status,
    deal_count,
  });
  const venues = [v("bobeche", "active", 2, "Basement/131"), v("Alpha", "inactive", 0), v("Bobeche", "active", 5, "131")];

  it("sorts by name case-insensitively, then address", () => {
    expect(sortVenues(venues, { key: "name", dir: "asc" }).map((x) => x.address)).toEqual(["1 St", "131", "Basement/131"]);
    expect(sortVenues(venues, { key: "name", dir: "desc" })[0].address).toBe("Basement/131");
  });

  it("sorts by status with active first, and by deal count", () => {
    expect(sortVenues(venues, { key: "status", dir: "asc" }).map((x) => x.status)).toEqual(["active", "active", "inactive"]);
    expect(sortVenues(venues, { key: "status", dir: "desc" })[0].status).toBe("inactive");
    expect(sortVenues(venues, { key: "deals", dir: "desc" }).map((x) => x.deal_count)).toEqual([5, 2, 0]);
  });

  it("filters by name or address and labels the count against the total", () => {
    expect(filterVenues(venues, " basement ").length).toBe(1);
    expect(venueCountLabel(3, 62)).toBe("3 of 62 venues");
    expect(venueCountLabel(62, 62)).toBe("62 venues");
    expect(venueCountLabel(1, 1)).toBe("1 venue");
  });
});
