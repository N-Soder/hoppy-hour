// Who approved or rejected a submission, and when: recorded by approve and
// reject, cleared by restore, shown in the admin lists, and harmless on a
// database where migration 0006 has not been applied yet.
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createSqliteD1, type SqliteD1 } from "./helpers/sqlite-d1";
import { onRequestPost as approve } from "../../functions/api/admin/submissions/[id]/approve";
import { onRequestPost as reject } from "../../functions/api/admin/submissions/[id]/reject";
import { onRequestPost as restore } from "../../functions/api/admin/submissions/[id]/restore";
import { onRequestGet as listSubmissions } from "../../functions/api/admin/submissions/index";
import { reviewerOf } from "../../functions/_shared/review";
import { decisionLabel } from "@/lib/admin";

// Placeholder identities only (the example.com domain is reserved).
const REVIEWER = "reviewer@example.com";
const DEV = "dev@localhost"; // what the middleware sets with DEV_BYPASS_ACCESS
const NOW = "2026-11-24T09:30:00.000Z";

let d1: SqliteD1;

function call(
  handler: (ctx: never) => Response | Promise<Response>,
  { body, params = {}, adminEmail, method = "POST", url = "http://localhost/api/admin/x" }:
    { body?: unknown; params?: Record<string, string>; adminEmail?: string; method?: string; url?: string } = {},
) {
  const request = new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = adminEmail === undefined ? {} : { adminEmail };
  return handler({ request, env: { DB: d1.DB }, params, data } as never) as Promise<Response>;
}

function insertPending(id: string) {
  d1.query(
    `INSERT INTO submissions (id, venue_name, venue_address, days_of_week, start_time, end_time, description)
     VALUES (?1, 'Bar', '', '[5]', '17:00:00', '19:00:00', 'Deal')`,
    id,
  );
}

const reviewOf = (id: string) =>
  d1.query<{ status: string; reviewed_by: string | null; reviewed_at: string | null }>(
    `SELECT status, reviewed_by, reviewed_at FROM submissions WHERE id = ?1`,
    id,
  )[0];

const approveBody = {
  venue: { name: "Bar", address: "Perth", country: "AU", lat: -31.95, lng: 115.86, location_source: "manual" },
  happy_hours: [{ days_of_week: [5], start_time: "17:00", end_time: "19:00", description: "Deal", tags: [] }],
};

beforeEach(() => {
  d1 = createSqliteD1();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("recording the decision", () => {
  it("approve records the verified reviewer and the time", async () => {
    insertPending("s");
    expect((await call(approve, { params: { id: "s" }, body: approveBody, adminEmail: REVIEWER })).status).toBe(200);
    expect(reviewOf("s")).toEqual({ status: "approved", reviewed_by: REVIEWER, reviewed_at: NOW });
  });

  it("reject records the reviewer and time, and restore clears both", async () => {
    insertPending("s");
    expect((await call(reject, { params: { id: "s" }, adminEmail: DEV })).status).toBe(200);
    expect(reviewOf("s")).toEqual({ status: "rejected", reviewed_by: DEV, reviewed_at: NOW });

    expect((await call(restore, { params: { id: "s" }, adminEmail: DEV })).status).toBe(200);
    expect(reviewOf("s")).toEqual({ status: "pending", reviewed_by: null, reviewed_at: null });
  });

  it("does not overwrite a decision when the guarded update misses", async () => {
    insertPending("s");
    await call(reject, { params: { id: "s" }, adminEmail: REVIEWER });
    vi.setSystemTime(new Date("2026-11-25T00:00:00.000Z"));
    expect((await call(reject, { params: { id: "s" }, adminEmail: DEV })).status).toBe(409);
    expect((await call(approve, { params: { id: "s" }, body: approveBody, adminEmail: DEV })).status).toBe(409);
    expect(reviewOf("s")).toEqual({ status: "rejected", reviewed_by: REVIEWER, reviewed_at: NOW });
  });

  it("falls back to 'admin' when the middleware gave no identity", async () => {
    insertPending("s");
    await call(reject, { params: { id: "s" } });
    expect(reviewOf("s").reviewed_by).toBe("admin");
    expect(reviewerOf({ adminEmail: "  " })).toBe("admin");
    expect(reviewerOf({ adminEmail: ` ${REVIEWER} ` })).toBe(REVIEWER);
  });

  it("returns the decision in the admin list", async () => {
    insertPending("s");
    await call(reject, { params: { id: "s" }, adminEmail: REVIEWER });
    const res = await call(listSubmissions, { method: "GET", url: "http://localhost/api/admin/submissions?status=rejected" });
    const { submissions } = (await res.json()) as { submissions: { reviewed_by: string; reviewed_at: string }[] };
    expect(submissions[0]).toMatchObject({ reviewed_by: REVIEWER, reviewed_at: NOW });
  });
});

describe("before migration 0006 is applied", () => {
  beforeEach(() => {
    d1.exec(`ALTER TABLE submissions DROP COLUMN reviewed_at; ALTER TABLE submissions DROP COLUMN reviewed_by;`);
  });

  it("approve, reject and restore still work and the list reports nulls", async () => {
    insertPending("a");
    insertPending("r");
    expect((await call(approve, { params: { id: "a" }, body: approveBody, adminEmail: REVIEWER })).status).toBe(200);
    expect((await call(reject, { params: { id: "r" }, adminEmail: REVIEWER })).status).toBe(200);
    expect(d1.query(`SELECT id, status FROM submissions ORDER BY id`)).toEqual([
      { id: "a", status: "approved" },
      { id: "r", status: "rejected" },
    ]);
    expect((await call(restore, { params: { id: "r" }, adminEmail: REVIEWER })).status).toBe(200);
    expect(d1.query(`SELECT status FROM submissions WHERE id = 'r'`)).toEqual([{ status: "pending" }]);

    const res = await call(listSubmissions, { method: "GET", url: "http://localhost/api/admin/submissions?status=approved" });
    const { submissions } = (await res.json()) as { submissions: Record<string, unknown>[] };
    expect(submissions[0]).toMatchObject({ reviewed_by: null, reviewed_at: null });
  });

  it("approve also works with neither 0005 nor 0006 applied", async () => {
    d1.exec(`ALTER TABLE venues DROP COLUMN timezone`);
    insertPending("a");
    expect((await call(approve, { params: { id: "a" }, body: approveBody, adminEmail: REVIEWER })).status).toBe(200);
    expect(d1.query(`SELECT COUNT(*) AS n FROM venues`)).toEqual([{ n: 1 }]);
  });
});

describe("decisionLabel", () => {
  it("shows the date and reviewer for a decided submission", () => {
    const label = decisionLabel({ status: "approved", reviewed_by: REVIEWER, reviewed_at: NOW });
    expect(label).toMatch(/2026/);
    expect(label).toMatch(new RegExp(`by ${REVIEWER}$`));
  });

  it("shows nothing for pending rows or rows decided before the migration", () => {
    expect(decisionLabel({ status: "pending", reviewed_by: REVIEWER, reviewed_at: NOW })).toBeNull();
    expect(decisionLabel({ status: "rejected", reviewed_by: null, reviewed_at: null })).toBeNull();
    expect(decisionLabel({ status: "rejected" })).toBeNull();
  });

  it("shows whichever half was recorded", () => {
    expect(decisionLabel({ status: "rejected", reviewed_by: REVIEWER, reviewed_at: null })).toBe(`by ${REVIEWER}`);
    expect(decisionLabel({ status: "rejected", reviewed_by: null, reviewed_at: NOW })).toMatch(/2026/);
  });
});
