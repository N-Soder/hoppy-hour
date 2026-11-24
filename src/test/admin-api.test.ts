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
    ...extra,
  };
  d1.query(
    `INSERT INTO submissions (id, venue_name, venue_address, city, country, lat, lng, days_of_week,
                              start_time, end_time, description, tags, status)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '[5,6]', '22:00:00', '02:00:00', 'Late deal', '[]', ?8)`,
    id, row.venue_name, row.venue_address, row.city, row.country, row.lat, row.lng, status,
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
        venue: { name: "Test Venue", address: "Testville, Australia", country: "AU", lat: -31.9, lng: 115.8 },
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
      body: {
        ids: [id],
        records: [5, 6].map((d) => ({ venue_id: "v1", ...overnight, days_of_week: [d], is_active: true })),
      },
    });
    expect(splitRes.status).toBe(200);
    expect(d1.query(`SELECT days_of_week, start_time, end_time FROM happy_hours ORDER BY days_of_week`)).toEqual([
      { days_of_week: "[5]", start_time: "22:00:00", end_time: "02:00:00" },
      { days_of_week: "[6]", start_time: "22:00:00", end_time: "02:00:00" },
    ]);
  });
});
