import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { fakeKv, fakeR2, MAGIC, b64 } from "./helpers/fake-bindings";

// The Anthropic SDK is mocked: no network, and each test sets what the model
// "reads".
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status?: number;
  }
  class RateLimitError extends APIError {}
  class Anthropic {
    messages = { create };
  }
  return { default: Anthropic, APIError, RateLimitError };
});

import { onRequestPost } from "../../functions/api/menu-photo";
import { onRequestPost as submitPost } from "../../functions/api/submissions";

const modelSays = (body: unknown) =>
  create.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(body) }] });

const MENU = {
  venue_name: "The Crown",
  venue_address: "1 Hay St",
  notes: null,
  deals: [
    { days_of_week: [1, 2, 3, 4, 5], start_time: "16:00", end_time: "18:00", description: "$9 pints; $5 wines" },
    { days_of_week: [0], start_time: "", end_time: "", description: "$15 jugs" },
  ],
};

let calls: string[];
function setup({ turnstile = { success: true, hostname: "hoppyhour.app" } } = {}) {
  calls = [];
  const kv = fakeKv();
  const r2 = fakeR2();
  const env = {
    RATE_LIMIT: kv,
    SUBMISSION_IMAGES: r2,
    TURNSTILE_SECRET_KEY: "secret",
    ANTHROPIC_API_KEY: "test",
    DB: { prepare: vi.fn(() => ({ bind: vi.fn((...args: unknown[]) => ({ run: async () => { calls.push("insert"); bound = args; return {}; } })) })) },
  };
  vi.stubGlobal("fetch", vi.fn(async () => { calls.push("turnstile"); return { json: async () => turnstile }; }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return { env, kv, r2 };
}
let bound: unknown[] = [];

const req = (path: string, body: unknown, ip = "1.2.3.4") => ({
  request: new Request(`https://hoppyhour.app${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify(body),
  }),
});
const photo = (over: Record<string, unknown> = {}) =>
  req("/api/menu-photo", { image_base64: b64(MAGIC.jpeg), media_type: "image/jpeg", turnstile_token: "tok", honeypot: "", ...over });
const read = async (env: unknown, over?: Record<string, unknown>, ip?: string) => {
  const r = ip ? req("/api/menu-photo", { image_base64: b64(MAGIC.jpeg), media_type: "image/jpeg", turnstile_token: "tok", honeypot: "", ...over }, ip) : photo(over);
  const res = (await onRequestPost({ ...r, env } as never)) as Response;
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => {
  create.mockReset();
  modelSays(MENU);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("POST /api/menu-photo", () => {
  it("reads a menu, stores it once under pending/ and returns pre-fill + an opaque upload_id", async () => {
    const { env, r2 } = setup();
    const { status, body } = await read(env);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      found: true,
      venue_name: "The Crown",
      venue_address: "1 Hay St",
      expires_in: 3600,
      deals: [
        { days_of_week: [1, 2, 3, 4, 5], start_time: "16:00", end_time: "18:00", description: "$9 pints; $5 wines" },
        { days_of_week: [0], start_time: "", end_time: "", description: "$15 jugs" },
      ],
    });
    expect(body.upload_id).toMatch(/^[0-9a-f]{32}$/);
    expect(r2.put).toHaveBeenCalledTimes(1);
    // Never leaks where the photo lives.
    expect(JSON.stringify(body)).not.toMatch(/pending\/|submissions\//);
    expect(create.mock.calls[0][0].max_tokens).toBeLessThanOrEqual(1024);
  });

  it("says 'not found' and stores nothing when the photo has no deal", async () => {
    const { env, r2 } = setup();
    modelSays({ venue_name: null, venue_address: null, notes: "a dog", deals: [] });
    const { status, body } = await read(env);
    expect(status).toBe(200);
    expect(body).toMatchObject({ found: false, upload_id: null });
    expect(r2.put).not.toHaveBeenCalled();
  });

  it("treats a model refusal as 'not found'", async () => {
    const { env } = setup();
    create.mockResolvedValue({ stop_reason: "refusal", content: [] });
    expect((await read(env)).body).toMatchObject({ found: false });
  });

  it("honeypot: fake 'not found', no Turnstile, no model, no quota", async () => {
    const { env, kv } = setup();
    const { body } = await read(env, { honeypot: "x" });
    expect(body.found).toBe(false);
    expect(calls).toEqual([]);
    expect(create).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("Turnstile failure stops before the model and before the site-wide cap is spent", async () => {
    const { env, kv } = setup({ turnstile: { success: false } as never });
    const { status } = await read(env);
    expect(status).toBe(403);
    expect(create).not.toHaveBeenCalled();
    expect([...kv.store.keys()].some((k) => k.startsWith("cap:"))).toBe(false);
  });

  it("rejects bytes that aren't the declared image type (magic bytes) before the model", async () => {
    const { env } = setup();
    const { status } = await read(env, { image_base64: b64(MAGIC.gif) });
    expect(status).toBe(415);
    expect(create).not.toHaveBeenCalled();
  });

  it("allows 5 reads per IP per hour", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-25T10:00:00Z"), toFake: ["Date"] });
    const { env } = setup();
    for (let i = 0; i < 5; i++) expect((await read(env)).status).toBe(200);
    const sixth = await read(env);
    expect(sixth).toMatchObject({ status: 429, body: { error: "photo_rate_limited" } });
    // Another IP is unaffected.
    expect((await read(env, {}, "5.6.7.8")).status).toBe(200);
  });

  it("allows 20 reads per IP per day across hours", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-25T00:00:00Z"), toFake: ["Date"] });
    const { env } = setup();
    for (let h = 0; h < 4; h++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 25, h)));
      for (let i = 0; i < 5; i++) expect((await read(env)).status).toBe(200);
    }
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 25, 5)));
    expect((await read(env)).body.error).toBe("photo_rate_limited");
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 26, 0)));
    expect((await read(env)).status).toBe(200);
  });

  it("pauses for everyone once the site-wide daily cap (200) is reached", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-25T12:00:00Z"), toFake: ["Date"] });
    const { env, kv } = setup();
    kv.store.set("cap:photo_read:2026-11-25", { value: "199" });
    expect((await read(env)).status).toBe(200);
    const paused = await read(env, {}, "9.9.9.9");
    expect(paused).toMatchObject({ status: 429, body: { error: "photo_paused" } });
    // Paused requests don't touch Turnstile or the model.
    expect(calls.filter((c) => c === "turnstile")).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("maps an API failure to a 5xx without storing anything", async () => {
    const { env, r2 } = setup();
    create.mockRejectedValue(new Error("boom"));
    expect((await read(env)).status).toBe(502);
    expect(r2.put).not.toHaveBeenCalled();
  });
});

describe("photo read -> POST /api/submissions with upload_id", () => {
  const form = {
    venue_name: "The Crown", city: "Perth", country: "AU", lat: -31.95, lng: 115.86,
    days_of_week: [1, 2, 3, 4, 5], start_time: "16:00", end_time: "18:00", description: "$9 pints",
    tags: ["beer"], turnstile_token: "tok2", honeypot: "",
  };

  it("attaches the photo: source='photo', image_key under submissions/", async () => {
    const { env, r2 } = setup();
    const { body } = await read(env);
    const res = (await submitPost({ ...req("/api/submissions", { ...form, upload_id: body.upload_id }), env } as never)) as Response;
    expect(res.status).toBe(201);
    expect(bound).toContain("photo");
    const key = bound.find((v) => typeof v === "string" && v.startsWith("submissions/"));
    expect(key).toMatch(/^submissions\/[0-9a-f-]{36}\.jpg$/);
    expect([...r2.store.keys()]).toEqual([key]);
  });

  it("still validates the fields — a read can't bypass validation", async () => {
    const { env } = setup();
    const { body } = await read(env);
    const res = (await submitPost({ ...req("/api/submissions", { ...form, days_of_week: [], upload_id: body.upload_id }), env } as never)) as Response;
    expect(res.status).toBe(400);
    expect(calls).not.toContain("insert");
  });

  it("410 photo_expired from another IP, and nothing inserted", async () => {
    const { env } = setup();
    const { body } = await read(env);
    const res = (await submitPost({ ...req("/api/submissions", { ...form, upload_id: body.upload_id }, "8.8.8.8"), env } as never)) as Response;
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "photo_expired" });
    expect(calls).not.toContain("insert");
  });

  it("410 for an unknown / expired id; 400 for a malformed one", async () => {
    const { env } = setup();
    const expired = (await submitPost({ ...req("/api/submissions", { ...form, upload_id: "0".repeat(32) }), env } as never)) as Response;
    expect(expired.status).toBe(410);
    const bad = (await submitPost({ ...req("/api/submissions", { ...form, upload_id: "../x" }), env } as never)) as Response;
    expect(bad.status).toBe(400);
  });

  it("a form submission without upload_id stays source='form'", async () => {
    const { env } = setup();
    const res = (await submitPost({ ...req("/api/submissions", form), env } as never)) as Response;
    expect(res.status).toBe(201);
    expect(bound.slice(-2)).toEqual(["form", null]);
  });
});
