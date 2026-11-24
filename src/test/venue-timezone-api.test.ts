// Venue time zones on the server: derived from coordinates on create, approve
// and coordinate changes; returned by the public API; and every path keeps
// working on a database where migration 0005 has not been applied yet.
import { describe, it, expect, beforeEach } from "vitest";
import { createSqliteD1, type SqliteD1 } from "./helpers/sqlite-d1";
import { isMissingColumn, withOptionalColumns } from "../../functions/_shared/schema-compat";
import { isValidTimeZone, timezoneFor } from "../../functions/_shared/timezone";
import { onRequestGet as publicVenues } from "../../functions/api/venues";
import { onRequestGet as publicVenue } from "../../functions/api/venues/[id]";
import { onRequestGet as adminVenues, onRequestPost as createVenue } from "../../functions/api/admin/venues/index";
import { onRequestPut as updateVenue } from "../../functions/api/admin/venues/[id]";
import { onRequestPost as approve } from "../../functions/api/admin/submissions/[id]/approve";
import { onRequestGet as detectZone } from "../../functions/api/admin/timezone";

const PERTH = { lat: -31.95, lng: 115.86 };
const SYDNEY = { lat: -33.87, lng: 151.21 };

let d1: SqliteD1;

function call(
  handler: (ctx: never) => Response | Promise<Response>,
  { body, params = {}, method = "POST", url = "http://localhost/api/x" }:
    { body?: unknown; params?: Record<string, string>; method?: string; url?: string } = {},
) {
  const request = new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handler({ request, env: { DB: d1.DB }, params, data: {} } as never) as Promise<Response>;
}

const zoneOf = (id: string) =>
  d1.query<{ timezone: string | null }>(`SELECT timezone FROM venues WHERE id = ?1`, id)[0]?.timezone;

function insertPending(id: string) {
  d1.query(
    `INSERT INTO submissions (id, venue_name, venue_address, days_of_week, start_time, end_time, description)
     VALUES (?1, 'Bar', '', '[5]', '17:00:00', '19:00:00', 'Deal')`,
    id,
  );
}

const deal = { days_of_week: [5], start_time: "17:00", end_time: "19:00", description: "Deal", tags: [] };

beforeEach(() => {
  d1 = createSqliteD1();
});

describe("timezoneFor", () => {
  it("finds the zone for coordinates", () => {
    expect(timezoneFor(PERTH.lat, PERTH.lng)).toBe("Australia/Perth");
    expect(timezoneFor(SYDNEY.lat, SYDNEY.lng)).toBe("Australia/Sydney");
    expect(timezoneFor(51.5, -0.12)).toBe("Europe/London");
  });

  it("returns null for missing or invalid coordinates", () => {
    expect(timezoneFor(null, 115)).toBeNull();
    expect(timezoneFor(-31, undefined)).toBeNull();
    expect(timezoneFor(Number.NaN, 0)).toBeNull();
    expect(timezoneFor(95, 0)).toBeNull();
    expect(timezoneFor("-31", "115")).toBeNull();
  });

  it("validates zone names", () => {
    expect(isValidTimeZone("Australia/Perth")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });
});

describe("schema-compat", () => {
  it("recognises SQLite and D1 missing-column errors for the named column only", () => {
    expect(isMissingColumn(new Error("no such column: timezone"), "timezone")).toBe(true);
    expect(isMissingColumn(new Error("D1_ERROR: no such column: v.timezone: SQLITE_ERROR"), "timezone")).toBe(true);
    expect(isMissingColumn(new Error("table venues has no column named timezone"), "timezone")).toBe(true);
    expect(isMissingColumn(new Error("no such column: timezone_x"), "timezone")).toBe(false);
    expect(isMissingColumn(new Error("no such column: reviewed_by"), "timezone")).toBe(false);
    expect(isMissingColumn(new Error("UNIQUE constraint failed"), "timezone")).toBe(false);
  });

  it("drops missing columns one at a time and rethrows anything else", async () => {
    const seen: string[][] = [];
    const out = await withOptionalColumns(["a", "b"], async (present) => {
      seen.push([...present]);
      if (present.has("a")) throw new Error("no such column: a");
      if (present.has("b")) throw new Error("table t has no column named b");
      return "ok";
    });
    expect(out).toBe("ok");
    expect(seen).toEqual([["a", "b"], ["b"], []]);
    await expect(withOptionalColumns(["a"], async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  });
});

describe("admin create and update", () => {
  it("stores the zone of a new venue, or null without coordinates", async () => {
    const res = await call(createVenue, { body: { name: "P", address: "1 St", country: "AU", ...PERTH } });
    expect(res.status).toBe(201);
    expect(zoneOf(((await res.json()) as { id: string }).id)).toBe("Australia/Perth");

    const noCoords = await call(createVenue, { body: { name: "N", address: "2 St", country: "AU", lat: null, lng: null } });
    expect(zoneOf(((await noCoords.json()) as { id: string }).id)).toBeNull();
  });

  it("derives the zone again when coordinates change, including a one-coordinate change", async () => {
    d1.exec(`INSERT INTO venues (id, name, address, lat, lng, timezone)
             VALUES ('v', 'V', '1 St', ${PERTH.lat}, ${PERTH.lng}, 'Australia/Perth')`);
    expect((await call(updateVenue, { method: "PUT", params: { id: "v" }, body: SYDNEY })).status).toBe(200);
    expect(zoneOf("v")).toBe("Australia/Sydney");

    // Only lng sent: the stored lat is combined with it (Perth latitude, Adelaide-ish longitude).
    await call(updateVenue, { method: "PUT", params: { id: "v" }, body: { lat: -34.93 } });
    await call(updateVenue, { method: "PUT", params: { id: "v" }, body: { lng: 138.6 } });
    expect(zoneOf("v")).toBe("Australia/Adelaide");

    // Clearing coordinates clears the zone.
    await call(updateVenue, { method: "PUT", params: { id: "v" }, body: { lat: null, lng: null } });
    expect(zoneOf("v")).toBeNull();
  });

  it("leaves the zone alone for other edits and accepts an explicit correction", async () => {
    d1.exec(`INSERT INTO venues (id, name, address, lat, lng, timezone)
             VALUES ('v', 'V', '1 St', -28.17, 153.54, 'Australia/Sydney')`);
    await call(updateVenue, { method: "PUT", params: { id: "v" }, body: { timezone: "Australia/Brisbane" } });
    expect(zoneOf("v")).toBe("Australia/Brisbane");
    await call(updateVenue, { method: "PUT", params: { id: "v" }, body: { name: "Renamed" } });
    expect(zoneOf("v")).toBe("Australia/Brisbane");

    const bad = await call(updateVenue, { method: "PUT", params: { id: "v" }, body: { timezone: "Nowhere/Land" } });
    expect(bad.status).toBe(400);
    expect(zoneOf("v")).toBe("Australia/Brisbane");
  });

  it("returns 404 for an unknown venue", async () => {
    expect((await call(updateVenue, { method: "PUT", params: { id: "x" }, body: { lat: 1 } })).status).toBe(404);
    expect((await call(updateVenue, { method: "PUT", params: { id: "x" }, body: { name: "n" } })).status).toBe(404);
  });
});

describe("approve", () => {
  it("stores the zone of a venue created on approval", async () => {
    insertPending("s");
    const res = await call(approve, {
      params: { id: "s" },
      body: { venue: { name: "Bar", address: "Perth", country: "AU", ...PERTH, location_source: "manual" }, happy_hours: [deal] },
    });
    expect(res.status).toBe(200);
    expect(zoneOf(((await res.json()) as { venue_id: string }).venue_id)).toBe("Australia/Perth");
  });

  it("derives the zone when an approval moves an existing venue, and keeps a correction otherwise", async () => {
    d1.exec(`INSERT INTO venues (id, name, address, lat, lng, timezone)
             VALUES ('v', 'V', '1 St', ${PERTH.lat}, ${PERTH.lng}, 'Etc/GMT-8')`);
    insertPending("same");
    const kept = await call(approve, {
      params: { id: "same" },
      body: {
        venue_id: "v",
        venue_update: { name: "V", address: "1 St", country: "AU", ...PERTH, location_source: "venue" },
        happy_hours: [deal],
      },
    });
    expect(kept.status).toBe(200);
    expect(zoneOf("v")).toBe("Etc/GMT-8");

    insertPending("moved");
    const moved = await call(approve, {
      params: { id: "moved" },
      body: {
        venue_id: "v",
        venue_update: { name: "V", address: "1 St", country: "AU", ...SYDNEY, location_source: "address" },
        happy_hours: [deal],
      },
    });
    expect(moved.status).toBe(200);
    expect(zoneOf("v")).toBe("Australia/Sydney");
  });

  it("fills a missing zone when attaching to an existing venue as-is, and leaves a set one alone", async () => {
    d1.exec(`INSERT INTO venues (id, name, address, lat, lng, timezone)
             VALUES ('empty', 'E', '1 St', ${PERTH.lat}, ${PERTH.lng}, NULL),
                    ('fixed', 'F', '2 St', ${PERTH.lat}, ${PERTH.lng}, 'Etc/GMT-8')`);
    insertPending("a");
    insertPending("b");
    expect((await call(approve, { params: { id: "a" }, body: { venue_id: "empty", happy_hours: [deal] } })).status).toBe(200);
    expect((await call(approve, { params: { id: "b" }, body: { venue_id: "fixed", happy_hours: [deal] } })).status).toBe(200);
    expect(zoneOf("empty")).toBe("Australia/Perth");
    expect(zoneOf("fixed")).toBe("Etc/GMT-8");
  });
});

describe("admin time zone helpers", () => {
  it("detects the zone for coordinates", async () => {
    const res = await call(detectZone, { method: "GET", url: `http://localhost/api/admin/timezone?lat=${SYDNEY.lat}&lng=${SYDNEY.lng}` });
    expect(await res.json()).toEqual({ timezone: "Australia/Sydney" });
    expect((await call(detectZone, { method: "GET", url: "http://localhost/api/admin/timezone?lat=1" })).status).toBe(400);
    expect((await call(detectZone, { method: "GET", url: "http://localhost/api/admin/timezone?lat=95&lng=0" })).status).toBe(400);
  });

  it("tells the editor whether the timezone column exists", async () => {
    const before = await call(adminVenues, { method: "GET" });
    expect(((await before.json()) as { timezone_supported: boolean }).timezone_supported).toBe(true);
    d1.exec(`ALTER TABLE venues DROP COLUMN timezone`);
    const after = await call(adminVenues, { method: "GET" });
    expect(((await after.json()) as { timezone_supported: boolean }).timezone_supported).toBe(false);
  });
});

describe("public API", () => {
  it("returns each venue's zone from the list and single-venue endpoints", async () => {
    d1.exec(`INSERT INTO venues (id, name, address, lat, lng, timezone)
             VALUES ('p', 'P', '1 St', ${PERTH.lat}, ${PERTH.lng}, 'Australia/Perth'),
                    ('q', 'Q', '2 St', ${PERTH.lat + 0.001}, ${PERTH.lng}, NULL)`);
    const list = await call(publicVenues, { method: "GET", url: `http://localhost/api/venues?lat=${PERTH.lat}&lng=${PERTH.lng}` });
    const venues = (await list.json()) as { id: string; timezone: string | null }[];
    expect(venues.map((v) => [v.id, v.timezone])).toEqual([["p", "Australia/Perth"], ["q", null]]);

    const one = await call(publicVenue, { method: "GET", params: { id: "p" }, url: "http://localhost/api/venues/p" });
    expect(((await one.json()) as { timezone: string }).timezone).toBe("Australia/Perth");
  });
});

describe("before migration 0005 is applied", () => {
  beforeEach(() => {
    d1.exec(`ALTER TABLE venues DROP COLUMN timezone`);
  });

  it("serves venues with a null zone", async () => {
    d1.exec(`INSERT INTO venues (id, name, address, lat, lng) VALUES ('p', 'P', '1 St', ${PERTH.lat}, ${PERTH.lng})`);
    const list = await call(publicVenues, { method: "GET", url: `http://localhost/api/venues?lat=${PERTH.lat}&lng=${PERTH.lng}` });
    expect(list.status).toBe(200);
    expect(((await list.json()) as { timezone: unknown }[])[0].timezone).toBeNull();
    const one = await call(publicVenue, { method: "GET", params: { id: "p" }, url: "http://localhost/api/venues/p" });
    expect(((await one.json()) as { timezone: unknown }).timezone).toBeNull();
    const admin = await call(adminVenues, { method: "GET" });
    expect(((await admin.json()) as { venues: { timezone: unknown }[] }).venues[0].timezone).toBeNull();
  });

  it("creates, moves and approves venues without storing a zone", async () => {
    const created = await call(createVenue, { body: { name: "P", address: "1 St", country: "AU", ...PERTH } });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect((await call(updateVenue, { method: "PUT", params: { id }, body: SYDNEY })).status).toBe(200);
    expect(d1.query(`SELECT lat, lng FROM venues WHERE id = ?1`, id)).toEqual([SYDNEY]);

    insertPending("s");
    const approved = await call(approve, {
      params: { id: "s" },
      body: {
        venue_id: id,
        venue_update: { name: "P", address: "1 St", country: "AU", ...PERTH, location_source: "manual" },
        happy_hours: [deal],
      },
    });
    expect(approved.status).toBe(200);
    expect(d1.query(`SELECT status FROM submissions WHERE id = 's'`)).toEqual([{ status: "approved" }]);
  });
});
