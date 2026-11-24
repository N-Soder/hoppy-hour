// Admin Functions run against a real SQLite copy of db/schema.sql.
import { describe, it, expect, beforeEach } from "vitest";
import { createSqliteD1, type SqliteD1 } from "./helpers/sqlite-d1";
import { onRequestPost as reject } from "../../functions/api/admin/submissions/[id]/reject";
import { onRequestPost as restore } from "../../functions/api/admin/submissions/[id]/restore";
import { onRequestPost as approve } from "../../functions/api/admin/submissions/[id]/approve";
import { onRequestGet as listVenues } from "../../functions/api/admin/venues/index";
import { onRequestPost as createDeal } from "../../functions/api/admin/happy-hours/index";
import { onRequestPut as updateDeal } from "../../functions/api/admin/happy-hours/[id]";
import { onRequestPost as groupUpdate } from "../../functions/api/admin/happy-hours/group-update";
import { onRequestPost as split } from "../../functions/api/admin/happy-hours/split";
import { onRequestPost as groupDelete } from "../../functions/api/admin/happy-hours/group-delete";
import { validateDealFields } from "../../functions/_shared/validate";

let d1: SqliteD1;

function call(
  handler: (ctx: never) => Response | Promise<Response>,
  { body, params = {}, method = "POST" }: { body?: unknown; params?: Record<string, string>; method?: string } = {},
) {
  const request = new Request("http://localhost/api/admin/x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handler({ request, env: { DB: d1.DB }, params, data: {} } as never) as Promise<Response>;
}

function insertSubmission(id: string, status: string, extra: Partial<Record<string, string | number | null>> = {}) {
  const row = {
    venue_name: "Test Venue",
    venue_address: "",
    city: "Testville",
    country: "AU",
    lat: null as number | null,
    lng: null as number | null,
    source: "form",
    ...extra,
  };
  d1.query(
    `INSERT INTO submissions (id, venue_name, venue_address, city, country, lat, lng, days_of_week,
                              start_time, end_time, description, tags, status, source)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '[5,6]', '22:00:00', '02:00:00', 'Late deal', '[]', ?8, ?9)`,
    id, row.venue_name, row.venue_address, row.city, row.country, row.lat, row.lng, status, row.source,
  );
}

function statusOf(id: string) {
  return d1.query<{ status: string }>(`SELECT status FROM submissions WHERE id = ?1`, id)[0]?.status;
}

beforeEach(() => {
  d1 = createSqliteD1();
});

describe("reject then restore (undo)", () => {
  it("rejects a pending submission and restores it to pending", async () => {
    insertSubmission("s1", "pending");
    expect((await call(reject, { params: { id: "s1" } })).status).toBe(200);
    expect(statusOf("s1")).toBe("rejected");
    expect((await call(restore, { params: { id: "s1" } })).status).toBe(200);
    expect(statusOf("s1")).toBe("pending");
  });

  it("refuses to restore a submission that is not rejected", async () => {
    insertSubmission("p", "pending");
    insertSubmission("a", "approved");
    const pending = await call(restore, { params: { id: "p" } });
    expect(pending.status).toBe(409);
    expect(await pending.json()).toEqual({ error: "submission is pending, not rejected" });
    expect((await call(restore, { params: { id: "a" } })).status).toBe(409);
    expect(statusOf("a")).toBe("approved");
  });

  it("returns 404 for an unknown submission", async () => {
    expect((await call(restore, { params: { id: "nope" } })).status).toBe(404);
  });
});

describe("approve", () => {
  it("approves a submission that arrived without coordinates once the reviewer supplies them", async () => {
    insertSubmission("s2", "pending");
    const res = await call(approve, {
      params: { id: "s2" },
      body: {
        venue: {
          name: "Test Venue", address: "Testville, Australia", country: "AU", lat: -31.9, lng: 115.8,
          location_source: "manual",
        },
        happy_hours: [{ days_of_week: [5, 6], start_time: "22:00", end_time: "02:00", description: "Late deal", tags: [] }],
      },
    });
    expect(res.status).toBe(200);
    const { venue_id } = (await res.json()) as { venue_id: string };
    expect(statusOf("s2")).toBe("approved");
    expect(d1.query(`SELECT lat, lng FROM venues WHERE id = ?1`, venue_id)).toEqual([{ lat: -31.9, lng: 115.8 }]);
    // Overnight deal stored as start > end.
    expect(d1.query(`SELECT start_time, end_time FROM happy_hours WHERE venue_id = ?1`, venue_id)).toEqual([
      { start_time: "22:00:00", end_time: "02:00:00" },
    ]);
  });

  it("still refuses an approval with no coordinates", async () => {
    insertSubmission("s3", "pending");
    const res = await call(approve, {
      params: { id: "s3" },
      body: {
        venue: { name: "Test Venue", address: "Testville", country: "AU" },
        happy_hours: [{ days_of_week: [5], start_time: "17:00", end_time: "18:00", description: "x", tags: [] }],
      },
    });
    expect(res.status).toBe(400);
    expect(statusOf("s3")).toBe("pending");
  });
});

describe("approve needs a confirmed location", () => {
  const deal = { days_of_week: [5], start_time: "17:00", end_time: "18:00", description: "x", tags: [] };
  const venue = (extra: Record<string, unknown> = {}) => ({
    name: "Test Venue", address: "1 Real St, Testville", country: "AU", lat: -31.95, lng: 115.86,
    location_source: "address", ...extra,
  });
  const approveWith = (id: string, body: Record<string, unknown>) =>
    call(approve, { params: { id }, body: { happy_hours: [deal], ...body } });
  const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;
  const venueCount = () => d1.query<{ n: number }>(`SELECT COUNT(*) AS n FROM venues`)[0].n;

  it("refuses a new venue without location_source, or with an unconfirmed one", async () => {
    insertSubmission("s", "pending", { lat: -32, lng: 115 });
    for (const location_source of [undefined, "city", "upload", "venue"]) {
      const res = await approveWith("s", { venue: venue({ location_source }) });
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toMatch(/confirmed location is required/);
    }
    expect(statusOf("s")).toBe("pending");
    expect(venueCount()).toBe(0);
  });

  it("refuses a form submission's own city-centre coordinates even when labelled as confirmed", async () => {
    insertSubmission("s", "pending", { lat: -31.95, lng: 115.86 });
    const res = await approveWith("s", { venue: venue({ location_source: "manual" }) });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatch(/city-centre coordinates/);
    expect(statusOf("s")).toBe("pending");
    expect(venueCount()).toBe(0);
  });

  it("accepts a photo submission's own coordinates once the reviewer enters them", async () => {
    insertSubmission("p", "pending", { lat: -31.95, lng: 115.86, source: "photo" });
    const res = await approveWith("p", { venue: venue({ location_source: "manual" }) });
    expect(res.status).toBe(200);
    expect(statusOf("p")).toBe("approved");
  });

  it("approves a new venue at a geocoded street address", async () => {
    insertSubmission("s", "pending", { lat: -32, lng: 115 });
    const res = await approveWith("s", { venue: venue() });
    expect(res.status).toBe(200);
    expect(d1.query(`SELECT lat, lng FROM venues`)).toEqual([{ lat: -31.95, lng: 115.86 }]);
  });

  it("allows attaching to an existing venue with a location, using that location", async () => {
    d1.exec(`INSERT INTO venues (id, name, address, lat, lng) VALUES ('v1', 'One', '1 St', -31.9, 115.8)`);
    insertSubmission("s", "pending");
    const res = await approveWith("s", { venue_id: "v1" });
    expect(res.status).toBe(200);
    expect(d1.query(`SELECT lat, lng FROM venues WHERE id = 'v1'`)).toEqual([{ lat: -31.9, lng: 115.8 }]);
  });

  it("refuses attaching to a venue that has no location", async () => {
    d1.exec(`INSERT INTO venues (id, name, address) VALUES ('v1', 'One', '1 St')`);
    insertSubmission("s", "pending");
    const res = await approveWith("s", { venue_id: "v1" });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatch(/venue has no location/);
    expect(statusOf("s")).toBe("pending");
  });

  it("venue_update keeps the venue's own coordinates with location_source venue, and only those", async () => {
    d1.exec(`INSERT INTO venues (id, name, address, lat, lng) VALUES ('v1', 'One', '1 St', -31.9, 115.8)`);
    insertSubmission("s", "pending", { lat: -32, lng: 115 });
    const moved = await approveWith("s", {
      venue_id: "v1", venue_update: venue({ lat: -32, lng: 115, location_source: "venue" }),
    });
    expect(moved.status).toBe(400);
    const kept = await approveWith("s", {
      venue_id: "v1", venue_update: venue({ name: "One Renamed", lat: -31.9, lng: 115.8, location_source: "venue" }),
    });
    expect(kept.status).toBe(200);
    expect(d1.query(`SELECT name, lat, lng FROM venues WHERE id = 'v1'`)).toEqual([
      { name: "One Renamed", lat: -31.9, lng: 115.8 },
    ]);
  });
});

describe("GET /api/admin/venues deal_count", () => {
  it("counts per-day records of one deal once and keeps venues with no deals at 0", async () => {
    d1.exec(`
      INSERT INTO venues (id, name, address) VALUES ('v1', 'One', '1 St'), ('v2', 'Two', '2 St');
      INSERT INTO happy_hours (id, venue_id, days_of_week, start_time, end_time, description, tags) VALUES
        ('h1', 'v1', '[1]', '17:00:00', '18:00:00', '$8 pints', '["beer"]'),
        ('h2', 'v1', '[2]', '17:00:00', '18:00:00', '$8 pints', '["beer"]'),
        ('h3', 'v1', '[5]', '22:00:00', '02:00:00', 'Late wine', '["wine"]');
    `);
    const res = await call(listVenues, { method: "GET" });
    const { venues } = (await res.json()) as { venues: { id: string; deal_count: number }[] };
    expect(venues.map((v) => [v.id, v.deal_count])).toEqual([
      ["v1", 2],
      ["v2", 0],
    ]);
  });
});

describe("deals that cross midnight", () => {
  const overnight = { days_of_week: [5, 6], start_time: "22:00", end_time: "02:00", description: "Late", tags: ["beer"] };

  beforeEach(() => {
    d1.exec(`INSERT INTO venues (id, name, address) VALUES ('v1', 'One', '1 St')`);
  });

  it("validateDealFields accepts start after end", () => {
    expect(validateDealFields(overnight)).toBeNull();
  });

  it("create, update, group-update and split all store start > end", async () => {
    const created = await call(createDeal, { body: { venue_id: "v1", ...overnight, is_active: true } });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const updated = await call(updateDeal, {
      params: { id },
      method: "PUT",
      body: { ...overnight, start_time: "23:00", end_time: "01:30", is_active: true },
    });
    expect(updated.status).toBe(200);
    expect(d1.query(`SELECT start_time, end_time FROM happy_hours WHERE id = ?1`, id)).toEqual([
      { start_time: "23:00:00", end_time: "01:30:00" },
    ]);

    const grouped = await call(groupUpdate, { body: { ids: [id], fields: { ...overnight, is_active: true } } });
    expect(grouped.status).toBe(200);

    const splitRes = await call(split, {
      body: { ids: [id], record: { ...overnight, days_of_week: [6], end_time: "03:00", is_active: true } },
    });
    expect(splitRes.status).toBe(200);
    expect(d1.query(`SELECT days_of_week, start_time, end_time FROM happy_hours ORDER BY days_of_week`)).toEqual([
      { days_of_week: "[5]", start_time: "22:00:00", end_time: "02:00:00" },
      { days_of_week: "[6]", start_time: "22:00:00", end_time: "03:00:00" },
    ]);
  });
});

describe("split, group-update and group-delete keep grouped deals consistent", () => {
  const base = { start_time: "17:00", end_time: "19:00", description: "$8 pints", tags: ["beer"], is_active: true };

  beforeEach(() => {
    // One deal on Mon–Fri stored as two records (Mon–Wed + Thu–Fri), as the
    // editor groups it, plus an unrelated deal at the same venue and a deal
    // at another venue.
    d1.exec(`
      INSERT INTO venues (id, name, address) VALUES ('v1', 'One', '1 St'), ('v2', 'Two', '2 St');
      INSERT INTO happy_hours (id, venue_id, days_of_week, start_time, end_time, description, tags) VALUES
        ('a', 'v1', '[1,2,3]', '17:00:00', '19:00:00', '$8 pints', '["beer"]'),
        ('b', 'v1', '[4,5]',   '17:00:00', '19:00:00', '$8 pints', '["beer"]'),
        ('c', 'v1', '[6]',     '12:00:00', '14:00:00', 'Lunch',    '[]'),
        ('z', 'v2', '[1]',     '17:00:00', '19:00:00', '$8 pints', '["beer"]');
    `);
  });

  const rows = (venue = "v1") =>
    d1.query<{ id: string; days_of_week: string; end_time: string; description: string }>(
      `SELECT id, days_of_week, end_time, description FROM happy_hours WHERE venue_id = ?1 ORDER BY id`,
      venue,
    );
  const dealCounts = async () => {
    const { venues } = (await (await call(listVenues, { method: "GET" })).json()) as {
      venues: { id: string; deal_count: number }[];
    };
    return Object.fromEntries(venues.map((v) => [v.id, v.deal_count]));
  };

  it("splits chosen days off into a separate, changed deal in one step", async () => {
    expect((await dealCounts()).v1).toBe(2);
    const res = await call(split, {
      body: { ids: ["a", "b"], record: { ...base, days_of_week: [5], end_time: "21:00", description: "$8 pints, late Friday" } },
    });
    expect(res.status).toBe(200);
    const { id, taken_days } = (await res.json()) as { id: string; taken_days: number[] };
    expect(taken_days).toEqual([5]);
    expect(rows()).toEqual([
      { id: "a", days_of_week: "[1,2,3]", end_time: "19:00:00", description: "$8 pints" },
      { id: "b", days_of_week: "[4]", end_time: "19:00:00", description: "$8 pints" },
      { id: "c", days_of_week: "[6]", end_time: "14:00:00", description: "Lunch" },
      { id, days_of_week: "[5]", end_time: "21:00:00", description: "$8 pints, late Friday" },
    ].sort((x, y) => x.id.localeCompare(y.id)));
    // The venues list now counts the split-off deal separately.
    expect((await dealCounts()).v1).toBe(3);
  });

  it("deletes an original record left with no days", async () => {
    const res = await call(split, { body: { ids: ["a", "b"], record: { ...base, days_of_week: [4, 5], end_time: "20:00" } } });
    expect(res.status).toBe(200);
    expect(rows().map((r) => r.id)).not.toContain("b");
    expect(rows().find((r) => r.id === "a")?.days_of_week).toBe("[1,2,3]");
  });

  it("refuses a split-off deal identical to the original, changing nothing", async () => {
    const before = rows();
    const res = await call(split, { body: { ids: ["a", "b"], record: { ...base, days_of_week: [5], description: " $8 pints " } } });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/identical to the original/);
    expect(rows()).toEqual(before);
  });

  it("refuses taking no days, or every day, of the original", async () => {
    const before = rows();
    expect((await call(split, { body: { ids: ["a", "b"], record: { ...base, days_of_week: [0], end_time: "20:00" } } })).status).toBe(400);
    expect(
      (await call(split, { body: { ids: ["a", "b"], record: { ...base, days_of_week: [1, 2, 3, 4, 5], end_time: "20:00" } } })).status,
    ).toBe(400);
    expect((await call(split, { body: { ids: ["c"], record: { ...base, days_of_week: [6] } } })).status).toBe(400);
    expect(rows()).toEqual(before);
  });

  it("refuses ids that are not one deal, or span venues", async () => {
    const before = rows();
    const record = { ...base, days_of_week: [5], end_time: "20:00" };
    expect((await call(split, { body: { ids: ["a", "c"], record } })).status).toBe(400);
    expect((await call(split, { body: { ids: ["a", "z"], record } })).status).toBe(400);
    expect((await call(split, { body: { ids: ["a", "gone"], record } })).status).toBe(404);
    expect((await call(groupUpdate, { body: { ids: ["a", "c"], fields: { ...base, days_of_week: [1] } } })).status).toBe(400);
    expect((await call(groupDelete, { body: { ids: ["a", "z"] } })).status).toBe(400);
    expect(rows()).toEqual(before);
    expect(rows("v2")).toHaveLength(1);
  });

  it("group-update merges the group's records into the first one", async () => {
    const res = await call(groupUpdate, { body: { ids: ["a", "b"], fields: { ...base, days_of_week: [1, 2, 3, 4, 5, 6] } } });
    expect(res.status).toBe(200);
    expect(rows().map((r) => [r.id, r.days_of_week])).toEqual([
      ["a", "[1,2,3,4,5,6]"],
      ["c", "[6]"],
    ]);
  });

  it("group-delete removes only the group's records", async () => {
    expect((await call(groupDelete, { body: { ids: ["a", "b"] } })).status).toBe(200);
    expect(rows().map((r) => r.id)).toEqual(["c"]);
    expect(rows("v2")).toHaveLength(1);
  });
});
