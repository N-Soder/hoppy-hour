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

  it("uses MAPBOX_GEOCODE_TOKEN without a spoofed Referer when set", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ features: [{}] }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await onRequestGet(ctx(
      "https://hoppy-hour.pages.dev/api/geocode?q=sofia",
      makeEnv({ MAPBOX_GEOCODE_TOKEN: "server-tok" }),
    )) as Response;

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("access_token=server-tok");
    expect(url).not.toContain("access_token=tok&");
    expect((init.headers as Record<string, string> | undefined)?.Referer).toBeUndefined();
  });
});

describe("geocode proxy worldwide place search (scope=world)", () => {
  const ok = () =>
    vi.fn(async () => ({ ok: true, json: async () => ({ features: [{ text: "Sofia" }] }) }) as unknown as Response);
  const urlOf = (mock: ReturnType<typeof ok>) => new URL((mock.mock.calls[0] as unknown as [string])[0]);

  it("sends no country filter, even with GEOCODE_COUNTRY set", async () => {
    const fetchMock = ok();
    vi.stubGlobal("fetch", fetchMock);

    await onRequestGet(ctx(
      "https://hoppy-hour.pages.dev/api/geocode?q=Sofia&scope=world&proximity=115.86000,-31.95000",
      makeEnv({ GEOCODE_COUNTRY: "AU" }),
    ));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = urlOf(fetchMock);
    expect(url.pathname).toBe("/geocoding/v5/mapbox.places/Sofia.json");
    expect(url.searchParams.has("country")).toBe(false);
    expect(url.searchParams.get("proximity")).toBe("115.86000,-31.95000");
    expect(url.searchParams.get("limit")).toBe("5");
  });

  it("ignores a ?country= sent alongside scope=world", async () => {
    const fetchMock = ok();
    vi.stubGlobal("fetch", fetchMock);

    await onRequestGet(ctx(
      "https://hoppy-hour.pages.dev/api/geocode?q=Sofia%2C%20Bulgaria&scope=world&country=AU",
      makeEnv({ GEOCODE_COUNTRY: "AU" }),
    ));

    const url = urlOf(fetchMock);
    expect(url.searchParams.has("country")).toBe(false);
    expect(decodeURIComponent(url.pathname)).toContain("Sofia, Bulgaria");
  });

  it("drops a malformed proximity rather than passing it on", async () => {
    const fetchMock = ok();
    vi.stubGlobal("fetch", fetchMock);

    await onRequestGet(ctx(
      "https://hoppy-hour.pages.dev/api/geocode?q=Sofia&scope=world&proximity=115.86,-31.95%26types%3Dpoi",
      makeEnv(),
    ));

    const url = urlOf(fetchMock);
    expect(url.searchParams.has("proximity")).toBe(false);
    expect(url.searchParams.has("types")).toBe(false);
  });

  it("keeps the submit form's chosen-country filter without scope=world", async () => {
    const fetchMock = ok();
    vi.stubGlobal("fetch", fetchMock);

    await onRequestGet(ctx(
      "https://hoppy-hour.pages.dev/api/geocode?q=Sof&types=place,locality&autocomplete=true&limit=8&country=BG",
      makeEnv({ GEOCODE_COUNTRY: "AU" }),
    ));

    const url = urlOf(fetchMock);
    expect(url.searchParams.get("country")).toBe("BG");
    expect(url.searchParams.get("types")).toBe("place,locality");
  });

  it("is still rate limited", async () => {
    const fetchMock = ok();
    vi.stubGlobal("fetch", fetchMock);
    const fullKV = { get: async () => "999", put: async () => {} } as unknown as KVNamespace;

    const res = (await onRequestGet(ctx(
      "https://hoppy-hour.pages.dev/api/geocode?q=Sofia&scope=world",
      makeEnv({ RATE_LIMIT: fullKV }),
    ))) as Response;

    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still sends the Referer for the URL-restricted public token", async () => {
    const fetchMock = ok();
    vi.stubGlobal("fetch", fetchMock);

    await onRequestGet(ctx("https://hoppy-hour.pages.dev/api/geocode?q=Sofia&scope=world", makeEnv()));

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ Referer: "https://hoppy-hour.pages.dev" });
  });
});

describe("geocode proxy language", () => {
  const languageSent = async (query: string) => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, json: async () => ({ features: [{ text: "Sofia" }] }) }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    await onRequestGet(ctx(`https://hoppy-hour.pages.dev/api/geocode?${query}`, makeEnv()));
    return new URL((fetchMock.mock.calls[0] as unknown as [string])[0]).searchParams.getAll("language");
  };

  it("forwards a valid two-letter language", async () => {
    expect(await languageSent("q=Sofia&scope=world&language=bg")).toEqual(["bg"]);
  });

  it("defaults to English when none is sent (the submit form's city picker)", async () => {
    expect(await languageSent("q=Sof&types=place,locality&autocomplete=true&limit=8")).toEqual(["en"]);
  });

  it.each(["EN", "eng", "en-AU", "e", "en&types=poi", "<script>"])(
    "replaces an invalid language %j with English",
    async (bad) => {
      expect(await languageSent(`q=Sofia&scope=world&language=${encodeURIComponent(bad)}`)).toEqual(["en"]);
    },
  );
});

