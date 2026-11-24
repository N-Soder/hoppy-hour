import { describe, it, expect, vi, afterEach } from "vitest";
import { onRequestPost } from "../../functions/api/submissions";

// Records the order the spam defences run in. KV counts calls to the limiter;
// fetch stands in for Turnstile's siteverify.
function setup({ limited = false, turnstile = { success: true, hostname: "hoppyhour.app" } } = {}) {
  const calls: string[] = [];
  const kv = {
    get: vi.fn(async () => { calls.push("ratelimit"); return limited ? "999" : null; }),
    put: vi.fn(async () => {}),
  };
  const run = vi.fn(async () => { calls.push("insert"); return {}; });
  const env = {
    RATE_LIMIT: kv,
    TURNSTILE_SECRET_KEY: "secret",
    DB: { prepare: () => ({ bind: () => ({ run }) }) },
  };
  vi.stubGlobal("fetch", vi.fn(async () => { calls.push("turnstile"); return { json: async () => turnstile }; }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return { calls, env, run };
}

const valid = {
  venue_name: "Bar", city: "Perth", country: "AU", lat: -31.95, lng: 115.86,
  days_of_week: [5], start_time: "16:00", end_time: "18:00", description: "$8 pints",
  tags: ["beer"], turnstile_token: "tok",
};
const post = (body: unknown, host = "hoppyhour.app") =>
  ({
    request: new Request(`https://${host}/api/submissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.2.3.4" },
      body: JSON.stringify(body),
    }),
  });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("POST /api/submissions defence order", () => {
  it("honeypot short-circuits with a fake 201 before rate limit and Turnstile", async () => {
    const { calls, env } = setup();
    const res = (await onRequestPost({ ...post({ ...valid, honeypot: "bot" }), env } as never)) as Response;
    expect(res.status).toBe(201);
    expect(calls).toEqual([]);
  });

  it("rate limit runs before Turnstile (no siteverify spend when limited)", async () => {
    const { calls, env } = setup({ limited: true });
    const res = (await onRequestPost({ ...post(valid), env } as never)) as Response;
    expect(res.status).toBe(429);
    expect(calls).toEqual(["ratelimit"]);
  });

  it("Turnstile failure stops before the insert", async () => {
    const { calls, env } = setup({ turnstile: { success: false } as never });
    const res = (await onRequestPost({ ...post(valid), env } as never)) as Response;
    expect(res.status).toBe(403);
    expect(calls).toEqual(["ratelimit", "turnstile"]);
  });

  it("happy path runs every check, then inserts", async () => {
    const { calls, env } = setup();
    const res = (await onRequestPost({ ...post(valid), env } as never)) as Response;
    expect(res.status).toBe(201);
    expect(calls).toEqual(["ratelimit", "turnstile", "insert"]);
  });

  it("rejects a token solved on another hostname", async () => {
    const { env, run } = setup({ turnstile: { success: true, hostname: "evil.test" } });
    const res = (await onRequestPost({ ...post(valid), env } as never)) as Response;
    expect(res.status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });

  it("skips the hostname match on loopback (Turnstile test keys)", async () => {
    const { env } = setup({ turnstile: { success: true, hostname: "example.com" } });
    const res = (await onRequestPost({ ...post(valid, "localhost"), env } as never)) as Response;
    expect(res.status).toBe(201);
  });
});
