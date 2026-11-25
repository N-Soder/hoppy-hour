import { describe, it, expect } from "vitest";
import { decodeImage, sniffImageType, SYSTEM_PROMPT, toPhotoPrefill } from "../../functions/_shared/menu-extract";
import { DEAL_TEXT_FORMAT } from "../../functions/_shared/deal-text";
import { MAGIC, b64 } from "./helpers/fake-bindings";

describe("sniffImageType (magic bytes)", () => {
  it("recognises jpeg, png and webp", () => {
    expect(sniffImageType(new Uint8Array(MAGIC.jpeg))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array(MAGIC.png))).toBe("image/png");
    expect(sniffImageType(new Uint8Array(MAGIC.webp))).toBe("image/webp");
  });

  it("rejects anything else, including truncated headers", () => {
    expect(sniffImageType(new Uint8Array(MAGIC.gif))).toBeNull();
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("<svg xmlns="))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("decodeImage", () => {
  it("accepts bytes that match the declared type", () => {
    const r = decodeImage(b64(MAGIC.webp), "image/webp");
    expect(r.ok).toBe(true);
  });

  it("rejects a declared type the bytes don't back up", () => {
    expect(decodeImage(b64(MAGIC.png), "image/jpeg")).toMatchObject({ ok: false, status: 415 });
    expect(decodeImage(b64(MAGIC.gif), "image/png")).toMatchObject({ ok: false, status: 415 });
  });

  it("rejects disallowed declared types, bad base64 and oversize payloads", () => {
    expect(decodeImage(b64(MAGIC.gif), "image/gif")).toMatchObject({ ok: false, status: 400 });
    expect(decodeImage("", "image/jpeg")).toMatchObject({ ok: false, status: 400 });
    expect(decodeImage("not base64!!", "image/jpeg")).toMatchObject({ ok: false, status: 400 });
    expect(decodeImage("A".repeat(4.1 * 1024 * 1024), "image/jpeg")).toMatchObject({ ok: false, status: 413 });
  });
});

describe("toPhotoPrefill", () => {
  it("keeps well-formed values and blanks the rest", () => {
    const p = toPhotoPrefill({
      venue_name: "  The Crown ",
      venue_address: null,
      notes: null,
      deals: [
        { days_of_week: [5, 1, 9, 1], start_time: "16:00", end_time: "7pm", description: " $9 pints " },
        { days_of_week: [], start_time: "", end_time: "", description: "" },
      ],
    });
    expect(p).toEqual({
      found: true,
      venue_name: "The Crown",
      venue_address: null,
      deals: [{ days_of_week: [1, 5], start_time: "16:00", end_time: "", description: "$9 pints" }],
    });
  });

  it("is not found when no deal has a description", () => {
    expect(toPhotoPrefill({ venue_name: null, venue_address: null, notes: "a cat", deals: [] }).found).toBe(false);
  });

  it("caps deals at the per-submission max", () => {
    const deal = { days_of_week: [1], start_time: "16:00", end_time: "18:00", description: "x" };
    const p = toPhotoPrefill({ venue_name: null, venue_address: null, notes: null, deals: Array(12).fill(deal) });
    expect(p.deals).toHaveLength(7);
  });
});

describe("photo extraction prompt", () => {
  it("uses the shared deal-text format (admin and public reads)", () => {
    expect(SYSTEM_PROMPT).toContain(DEAL_TEXT_FORMAT);
  });
});
