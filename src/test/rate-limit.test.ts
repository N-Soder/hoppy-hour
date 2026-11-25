import { describe, it, expect, vi, afterEach } from "vitest";
import { peekDailyCap, rateLimit, rateLimitStatus, takeDailyCap, utcDate } from "../../functions/_shared/rate-limit";
import { fakeKv } from "./helpers/fake-bindings";

const kvOf = (kv: ReturnType<typeof fakeKv>) => kv as unknown as KVNamespace;

afterEach(() => vi.useRealTimers());

async function allowedCount(kv: KVNamespace, n: number, max: number, window?: "minute" | "hour" | "day") {
  let ok = 0;
  for (let i = 0; i < n; i++) if (await rateLimit(kv, "b", "1.2.3.4", max, window)) ok++;
  return ok;
}

describe("rateLimit windows", () => {
  it("per-minute default keeps its original key shape and 60s TTL", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-25T10:00:30Z") });
    const kv = fakeKv();
    expect(await allowedCount(kvOf(kv), 5, 3)).toBe(3);
    const minute = Math.floor(Date.now() / 60_000);
    expect(kv.store.get(`rl:b:1.2.3.4:${minute}`)).toEqual({ value: "3", ttl: 60 });
    // Next minute starts fresh.
    vi.setSystemTime(new Date("2026-11-25T10:01:00Z"));
    expect(await rateLimit(kvOf(kv), "b", "1.2.3.4", 3)).toBe(true);
  });

  it("hour window allows max per clock hour, then resets", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-25T10:05:00Z") });
    const kv = fakeKv();
    expect(await allowedCount(kvOf(kv), 7, 5, "hour")).toBe(5);
    vi.setSystemTime(new Date("2026-11-25T10:55:00Z"));
    expect(await rateLimit(kvOf(kv), "b", "1.2.3.4", 5, "hour")).toBe(false);
    vi.setSystemTime(new Date("2026-11-25T11:00:00Z"));
    expect(await rateLimit(kvOf(kv), "b", "1.2.3.4", 5, "hour")).toBe(true);
    expect([...kv.store.values()].every((v) => v.ttl === 3600)).toBe(true);
  });

  it("day window is a UTC calendar day", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-25T00:00:00Z") });
    const kv = fakeKv();
    expect(await allowedCount(kvOf(kv), 25, 20, "day")).toBe(20);
    vi.setSystemTime(new Date("2026-11-25T23:59:59Z"));
    expect(await rateLimit(kvOf(kv), "b", "1.2.3.4", 20, "day")).toBe(false);
    vi.setSystemTime(new Date("2026-11-26T00:00:00Z"));
    expect(await rateLimit(kvOf(kv), "b", "1.2.3.4", 20, "day")).toBe(true);
  });

  it("windows and IPs count separately", async () => {
    const kv = fakeKv();
    expect(await allowedCount(kvOf(kv), 3, 3, "minute")).toBe(3);
    expect(await rateLimit(kvOf(kv), "b", "1.2.3.4", 3, "hour")).toBe(true);
    expect(await rateLimit(kvOf(kv), "b", "5.6.7.8", 3, "minute")).toBe(true);
  });

  it("rateLimit (existing callers) still fails open when KV throws", async () => {
    const kv = { get: async () => { throw new Error("kv down"); } } as unknown as KVNamespace;
    expect(await rateLimit(kv, "b", "ip", 1, "day")).toBe(true);
    expect(await rateLimit(kv, "b", "ip", 1)).toBe(true);
  });

  it("rateLimitStatus reports KV read and write failures as 'error' so callers can fail closed", async () => {
    const down = { get: async () => { throw new Error("kv down"); } } as unknown as KVNamespace;
    expect(await rateLimitStatus(down, "b", "ip", 1, "hour")).toBe("error");
    const readOnly = { get: async () => null, put: async () => { throw new Error("429 too many writes"); } } as unknown as KVNamespace;
    expect(await rateLimitStatus(readOnly, "b", "ip", 5, "day")).toBe("error");
  });
});

describe("daily site-wide cap", () => {
  it("counts per UTC date and stops at max", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-25T12:00:00Z") });
    const kv = fakeKv();
    for (let i = 0; i < 3; i++) expect(await takeDailyCap(kvOf(kv), "photo_read", 3)).toBe("ok");
    expect(await takeDailyCap(kvOf(kv), "photo_read", 3)).toBe("limited");
    expect(await peekDailyCap(kvOf(kv), "photo_read", 3)).toBe("limited");
    expect(kv.store.get("cap:photo_read:2026-11-25")?.value).toBe("3");
    vi.setSystemTime(new Date("2026-11-26T00:00:01Z"));
    expect(await peekDailyCap(kvOf(kv), "photo_read", 3)).toBe("ok");
    expect(await takeDailyCap(kvOf(kv), "photo_read", 3)).toBe("ok");
  });

  it("reports KV failures as 'error'", async () => {
    const down = { get: async () => { throw new Error("kv down"); } } as unknown as KVNamespace;
    expect(await peekDailyCap(down, "x", 1)).toBe("error");
    expect(await takeDailyCap(down, "x", 1)).toBe("error");
  });

  it("peek never counts", async () => {
    const kv = fakeKv();
    for (let i = 0; i < 5; i++) await peekDailyCap(kvOf(kv), "x", 1);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("utcDate formats YYYY-MM-DD in UTC", () => {
    expect(utcDate(Date.parse("2026-11-25T23:30:00-05:00"))).toBe("2026-11-26");
  });
});
