import { describe, it, expect } from "vitest";
import { readJson } from "../../functions/_shared/http";

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://example.test/api", { method: "POST", body, headers });

describe("readJson", () => {
  it("parses a small JSON body", async () => {
    expect(await readJson(post('{"a":1}'))).toEqual({ a: 1 });
  });

  it("returns null for malformed JSON", async () => {
    expect(await readJson(post("{nope"))).toBeNull();
  });

  it("rejects a body larger than the cap without parsing it", async () => {
    expect(await readJson(post(JSON.stringify({ a: "x".repeat(200) }), {}), 100)).toBeNull();
  });

  it("rejects an oversized declared Content-Length up front", async () => {
    expect(await readJson(post("{}", { "Content-Length": "999999" }), 100)).toBeNull();
  });
});
