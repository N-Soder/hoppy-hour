import { describe, it, expect, vi, beforeEach } from "vitest";

// The SDK is mocked: no network, and each test sets what the model "returns".
const create = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    constructor(public status: number | undefined) {
      super("api error");
    }
  }
  class RateLimitError extends APIError {}
  class Anthropic {
    messages = { create };
  }
  return { default: Anthropic, APIError, RateLimitError };
});

const { onRequestPost, TIDY_MODEL } = await import("../../functions/api/admin/tidy-description");
const sdk = await import("@anthropic-ai/sdk");

function env(over: Record<string, unknown> = {}) {
  return {
    ANTHROPIC_API_KEY: "test-key",
    RATE_LIMIT: { get: async () => "0", put: async () => undefined },
    ...over,
  };
}
const req = (body: unknown, contentType = "application/json") =>
  new Request("https://example.test/api/admin/tidy-description", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const call = async (body: unknown, e = env()) =>
  (await onRequestPost({ request: req(body), env: e } as never)) as Response;
const modelSays = (tidied: unknown) =>
  create.mockResolvedValueOnce({
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify({ tidied }) }],
  });

beforeEach(() => create.mockReset());

describe("POST /api/admin/tidy-description", () => {
  it.each([
    [{}, /non-empty array/],
    [{ descriptions: [] }, /non-empty array/],
    [{ descriptions: ["ok", 3] }, /strings/],
    [{ descriptions: Array(11).fill("$5 pints") }, /too many/],
    [{ descriptions: ["x".repeat(1001)] }, /too long/],
  ])("rejects %j before calling the model", async (body, msg) => {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(msg);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON body", async () => {
    const res = (await onRequestPost({ request: req("x", "text/plain"), env: env() } as never)) as Response;
    expect(res.status).toBe(400);
  });

  it("enforces the per-IP rate limit", async () => {
    const res = await call({ descriptions: ["$5 pints"] }, env({ RATE_LIMIT: { get: async () => "30", put: async () => {} } }));
    expect(res.status).toBe(429);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 503 when no API key is configured", async () => {
    const res = await call({ descriptions: ["$5 pints"] }, env({ ANTHROPIC_API_KEY: "" }));
    expect(res.status).toBe(503);
  });

  it("calls Haiku with structured output and guards each result", async () => {
    modelSays(["$8 large Brewery in Focus; $6 medium Brewery in Focus", "$12 cocktails", "$5 pints"]);
    const res = await call({ descriptions: ["Brewery in Focus LRG $8 MED $6", "$10 cocktails", "$5 pints"] });
    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results).toEqual([
      {
        original: "Brewery in Focus LRG $8 MED $6",
        tidied: "$8 large Brewery in Focus; $6 medium Brewery in Focus",
        changed: true,
      },
      { original: "$10 cocktails", tidied: "$10 cocktails", changed: false, reason: expect.stringMatching(/numbers/) },
      { original: "$5 pints", tidied: "$5 pints", changed: false },
    ]);
    const params = create.mock.calls[0][0];
    expect(params.model).toBe(TIDY_MODEL);
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.max_tokens).toBeLessThanOrEqual(4096);
  });

  it("offers nothing when the model returns the wrong number of items", async () => {
    modelSays(["$5 pints"]);
    const { results } = await (await call({ descriptions: ["$5 Pints.", "$7 wine."] })).json();
    expect(results.every((r: { changed: boolean }) => !r.changed)).toBe(true);
  });

  it("maps SDK failures to clean errors", async () => {
    create.mockRejectedValueOnce(new sdk.RateLimitError(429 as never, undefined as never, "", undefined as never));
    expect((await call({ descriptions: ["$5 pints"] })).status).toBe(503);
    create.mockRejectedValueOnce(new sdk.APIError(500 as never, undefined as never, "", undefined as never));
    const res = await call({ descriptions: ["$5 pints"] });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/tidy failed/);
    create.mockResolvedValueOnce({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] });
    expect((await call({ descriptions: ["$5 pints"] })).status).toBe(502);
    create.mockResolvedValueOnce({ stop_reason: "refusal", content: [] });
    expect((await call({ descriptions: ["$5 pints"] })).status).toBe(422);
  });
});
