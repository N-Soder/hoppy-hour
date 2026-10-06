import { describe, it, expect, vi, afterEach } from "vitest";
import { onRequestGet } from "../../functions/api/geocode";

// Minimal fakes: KV that makes rateLimit allow, and a fetch that records the
// init it was called with and returns a Mapbox-shaped payload.
const fakeKV = { get: async () => null, put: async () => {} } as unknown as KVNamespace;

function makeEnv(over: Record<string, unknown> = {}) {
  return { RATE_LIMIT: fakeKV, MAPBOX_ACCESS_TOKEN: "tok", ...over } as never;
}
function ctx(url: string, env: unknown) {
  return { request: new Request(url), env } as never;
}

afterEach(() => vi.unstubAllGlobals());

describe("geocode proxy Referer", () => {
  it("sends the request origin as Referer to Mapbox", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ features: [] }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await onRequestGet(ctx("https://hoppy-hour.pages.dev/api/geocode?q=sofia&types=place,locality", makeEnv())) as Response;

    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ Referer: "https://hoppy-hour.pages.dev" });
  });

  it("honors GEOCODE_REFERER override", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ features: [] }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await onRequestGet(ctx(
      "https://preview.pages.dev/api/geocode?q=sofia",
      makeEnv({ GEOCODE_REFERER: "https://hoppyhour.app" }),
    )) as Response;

    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ Referer: "https://hoppyhour.app" });
  });

  it("passes the Referer on the country-fallback call too", async () => {
    // First (country-restricted) call returns empty → triggers global fallback.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ features: [] }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ features: [{ text: "Sofia" }] }) } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await onRequestGet(ctx(
      "https://hoppy-hour.pages.dev/api/geocode?q=sofia",
      makeEnv({ GEOCODE_COUNTRY: "AU" }),
    )) as Response;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).headers).toMatchObject({ Referer: "https://hoppy-hour.pages.dev" });
    }
    // Fallback URL must drop the country filter.
    expect(fetchMock.mock.calls[1][0]).not.toContain("country=");
  });
});

describe("geocode proxy country selection", () => {
  it("uses the client-supplied ?country= over GEOCODE_COUNTRY", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ features: [] }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await onRequestGet(ctx(
      "https://hoppy-hour.pages.dev/api/geocode?q=Ed&country=CA",
      makeEnv({ GEOCODE_COUNTRY: "AU" }),
    )) as Response;

    expect(fetchMock.mock.calls[0][0]).toContain("country=CA");
  });

  it("falls back to GEOCODE_COUNTRY when the client sends no country", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ features: [] }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await onRequestGet(ctx(
      "https://hoppy-hour.pages.dev/api/geocode?q=Ed",
      makeEnv({ GEOCODE_COUNTRY: "AU" }),
    )) as Response;

    expect(fetchMock.mock.calls[0][0]).toContain("country=AU");
  });

  it("ignores a malformed ?country= value and falls back to GEOCODE_COUNTRY", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ features: [] }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await onRequestGet(ctx(
      "https://hoppy-hour.pages.dev/api/geocode?q=Ed&country=<script>",
      makeEnv({ GEOCODE_COUNTRY: "AU" }),
    )) as Response;

    expect(fetchMock.mock.calls[0][0]).toContain("country=AU");
  });
});

describe("geocode proxy robustness", () => {
  it("does not split an emoji when truncating a long query", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ features: [{}] }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    const q = encodeURIComponent("a" + "🍺".repeat(300));
    const res = (await onRequestGet(ctx(`https://hoppy-hour.pages.dev/api/geocode?q=${q}`, makeEnv()))) as Response;
    expect(res.status).toBe(200);
  });

  it("returns 502 when Mapbox is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
    const res = (await onRequestGet(ctx("https://hoppy-hour.pages.dev/api/geocode?q=perth", makeEnv()))) as Response;
    expect(res.status).toBe(502);
  });
});
