import { describe, it, expect, vi } from "vitest";
import { isCrossSiteWrite, onRequest } from "../../functions/api/admin/_middleware";

function ctx(url: string, env: Record<string, unknown>, init: RequestInit = {}) {
  const next = vi.fn(async () => new Response("ok"));
  return { c: { request: new Request(url, init), env, data: {}, next } as never, next };
}

describe("admin middleware DEV_BYPASS_ACCESS", () => {
  it("bypasses Access on loopback hosts", async () => {
    const { c, next } = ctx("http://localhost:8788/api/admin/me", { DEV_BYPASS_ACCESS: "1" });
    const res = (await onRequest(c)) as Response;
    expect(next).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("ignores the flag on a deployed host (fails closed)", async () => {
    const { c, next } = ctx("https://example.pages.dev/api/admin/me", { DEV_BYPASS_ACCESS: "1" });
    const res = (await onRequest(c)) as Response;
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toBe(403);
  });
});

describe("isCrossSiteWrite", () => {
  const url = "https://example.pages.dev/api/admin/venues";

  it("allows reads regardless of origin", () => {
    const req = new Request(url, { headers: { Origin: "https://evil.test", "Sec-Fetch-Site": "cross-site" } });
    expect(isCrossSiteWrite(req)).toBe(false);
  });

  it("blocks a cross-site POST", () => {
    const req = new Request(url, { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(isCrossSiteWrite(req)).toBe(true);
  });

  it("blocks a POST whose Origin differs", () => {
    const req = new Request(url, { method: "POST", headers: { Origin: "https://evil.test" } });
    expect(isCrossSiteWrite(req)).toBe(true);
  });

  it("allows a same-origin POST", () => {
    const req = new Request(url, {
      method: "POST",
      headers: { Origin: "https://example.pages.dev", "Sec-Fetch-Site": "same-origin" },
    });
    expect(isCrossSiteWrite(req)).toBe(false);
  });

  it("allows non-browser clients that send no Origin", () => {
    expect(isCrossSiteWrite(new Request(url, { method: "DELETE" }))).toBe(false);
  });
});
