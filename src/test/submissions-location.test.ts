import { describe, it, expect, vi, afterEach } from "vitest";
import { onRequestPost } from "../../functions/api/submissions";

// Fakes: KV that lets the rate limit through, Turnstile that passes for the
// request's hostname (as siteverify reports it), and a D1 that records the
// bound insert values.
const fakeKV = { get: async () => null, put: async () => {} } as unknown as KVNamespace;

const HOST = "hoppyhour.app";

function stubTurnstile() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => ({ success: true, hostname: HOST }) }) as unknown as Response),
  );
}

function makeEnv() {
  const bound: unknown[][] = [];
  const DB = {
    prepare: () => ({
      bind: (...args: unknown[]) => {
        bound.push(args);
        return { run: async () => ({}) };
      },
    }),
  };
  return { env: { RATE_LIMIT: fakeKV, TURNSTILE_SECRET_KEY: "s", DB } as never, bound };
}

function post(body: Record<string, unknown>, env: unknown) {
  const request = new Request(`https://${HOST}/api/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return onRequestPost({ request, env } as never) as Promise<Response>;
}

const base = {
  venue_name: "Typed Town Pub",
  city: "Smalltown",
  country: "AU",
  days_of_week: [4],
  start_time: "17:00",
  end_time: "19:00",
  description: "$5 schooners",
  tags: ["beer"],
  turnstile_token: "t",
};

afterEach(() => vi.unstubAllGlobals());

describe("POST /api/submissions location", () => {
  it("accepts a typed city with no coordinates and stores null lat/lng", async () => {
    stubTurnstile();
    const { env, bound } = makeEnv();
    const res = await post({ ...base, lat: null, lng: null }, env);
    expect(res.status).toBe(201);
    // id, name, address, city, country, lat, lng, …
    expect(bound[0][3]).toBe("Smalltown");
    expect(bound[0][5]).toBeNull();
    expect(bound[0][6]).toBeNull();
  });

  it("still stores coordinates from a picked city", async () => {
    stubTurnstile();
    const { env, bound } = makeEnv();
    const res = await post({ ...base, lat: -31.95, lng: 115.86 }, env);
    expect(res.status).toBe(201);
    expect(bound[0][5]).toBe(-31.95);
    expect(bound[0][6]).toBe(115.86);
  });

  it("rejects a half-present or out-of-range coordinate pair", async () => {
    stubTurnstile();
    const { env } = makeEnv();
    expect((await post({ ...base, lat: -31.95, lng: null }, env)).status).toBe(400);
    expect((await post({ ...base, lat: 123, lng: 115 }, env)).status).toBe(400);
  });

  it("still requires a city", async () => {
    stubTurnstile();
    const { env } = makeEnv();
    expect((await post({ ...base, city: "  " }, env)).status).toBe(400);
  });
});
