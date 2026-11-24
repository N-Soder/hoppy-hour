import { describe, it, expect, vi } from "vitest";
import {
  MAX_BATCH_ITEMS,
  validateIdList,
  validateVenue,
  validateVenuePatch,
} from "../../functions/_shared/validate";
import { onRequestPut as putVenue } from "../../functions/api/admin/venues/[id]";
import { onRequestPost as groupDelete } from "../../functions/api/admin/happy-hours/group-delete";

describe("validateVenuePatch", () => {
  it("accepts a valid partial update", () => {
    expect(validateVenuePatch({ name: "Bar", lat: -31.9, lng: 115.8, status: "inactive" })).toBeNull();
  });

  it("accepts clearing coordinates and country", () => {
    expect(validateVenuePatch({ lat: null, lng: null, country: null })).toBeNull();
  });

  it.each([
    [{ lat: "12" }, /lat/],
    [{ lat: 91 }, /lat/],
    [{ lng: -181 }, /lng/],
    [{ lat: Number.NaN }, /lat/],
    [{ name: "" }, /name/],
    [{ name: "x".repeat(201) }, /name/],
    [{ address: 5 }, /address/],
    [{ country: "AUS" }, /country/],
    [{ status: "deleted" }, /status/],
  ])("rejects %j", (patch, msg) => {
    expect(validateVenuePatch(patch)).toMatch(msg);
  });
});

describe("validateVenue", () => {
  const ok = { name: "Bar", address: "1 St", country: "AU", lat: -31.9, lng: 115.8 };

  it("requires an in-range pair when coords are required (approve)", () => {
    expect(validateVenue(ok, { requireCoords: true })).toBeNull();
    expect(validateVenue({ ...ok, lat: 200 }, { requireCoords: true })).toMatch(/lat/);
    expect(validateVenue({ ...ok, lat: null, lng: null }, { requireCoords: true })).toMatch(/lat/);
  });

  it("allows a venue with no pin yet, but not half a pin (create)", () => {
    expect(validateVenue({ ...ok, lat: null, lng: null }, { requireCoords: false })).toBeNull();
    expect(validateVenue({ ...ok, lat: 1, lng: null }, { requireCoords: false })).toMatch(/lat/);
  });

  it("rejects a malformed country", () => {
    expect(validateVenue({ ...ok, country: "Australia" }, { requireCoords: true })).toMatch(/country/);
  });
});

describe("validateIdList", () => {
  it("caps the batch size", () => {
    expect(validateIdList(Array.from({ length: MAX_BATCH_ITEMS }, (_, i) => `id${i}`))).toBeNull();
    expect(validateIdList(Array.from({ length: MAX_BATCH_ITEMS + 1 }, (_, i) => `id${i}`))).toMatch(/too many/);
  });

  it("rejects empty lists and non-string ids", () => {
    expect(validateIdList([])).toMatch(/required/);
    expect(validateIdList("abc")).toMatch(/required/);
    expect(validateIdList([1, 2])).toMatch(/strings/);
  });
});

// Handler-level: invalid input is rejected before any D1 statement is built.
function fakeDb() {
  const prepare = vi.fn(() => ({ bind: () => ({ run: async () => ({ meta: { changes: 1 } }) }) }));
  const batch = vi.fn(async () => []);
  return { DB: { prepare, batch }, prepare, batch };
}
const jsonReq = (method: string, body: unknown) =>
  new Request("https://example.test/api/admin/x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("admin handlers reject bad input before touching D1", () => {
  it("PUT /venues/:id with a string lat", async () => {
    const db = fakeDb();
    const res = (await putVenue({ request: jsonReq("PUT", { lat: "12" }), env: db, params: { id: "v1" } } as never)) as Response;
    expect(res.status).toBe(400);
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it("PUT /venues/:id upper-cases country before writing", async () => {
    const db = fakeDb();
    const bind = vi.fn(() => ({ run: async () => ({ meta: { changes: 1 } }) }));
    db.prepare.mockReturnValue({ bind } as never);
    const res = (await putVenue({ request: jsonReq("PUT", { country: "au" }), env: db, params: { id: "v1" } } as never)) as Response;
    expect(res.status).toBe(200);
    expect(bind.mock.calls[0]).toContain("AU");
  });

  it("group-delete with too many ids", async () => {
    const db = fakeDb();
    const ids = Array.from({ length: MAX_BATCH_ITEMS + 1 }, (_, i) => `id${i}`);
    const res = (await groupDelete({ request: jsonReq("POST", { ids }), env: db } as never)) as Response;
    expect(res.status).toBe(400);
    expect(db.batch).not.toHaveBeenCalled();
  });
});
