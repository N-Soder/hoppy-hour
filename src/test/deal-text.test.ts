import { describe, it, expect } from "vitest";
import {
  DEAL_TEXT_FORMAT, MAX_DESCRIPTION_CHARS, TIDY_SYSTEM_PROMPT, guardTidied, numericAmounts, validateTidyInput,
} from "../../functions/_shared/deal-text";

describe("numericAmounts", () => {
  it("treats $9.00 as $9 and $6.5 as $6.50", () => {
    expect(numericAmounts("$9.00 pints, $6.5 wine")).toEqual(numericAmounts("$9 pints; $6.50 wine"));
  });

  it("matches ranges with or without the second currency symbol", () => {
    expect(numericAmounts("$8.50-9.50 cocktails")).toEqual(numericAmounts("$8.50-$9.50 cocktails"));
  });

  it("keeps percentages distinct from prices", () => {
    expect(numericAmounts("$50 platters")).not.toEqual(numericAmounts("50% off platters"));
  });

  it("reads half price as 50% and number words as digits", () => {
    expect(numericAmounts("Half priced drinks")).toEqual(numericAmounts("50% off drinks"));
    expect(numericAmounts("two for one cocktails")).toEqual(numericAmounts("2-for-1 cocktails"));
    expect(numericAmounts("BOGO burgers")).toEqual(numericAmounts("2-for-1 burgers"));
  });
});

describe("guardTidied", () => {
  it.each([
    ["Brewery in Focus LRG $8 MED $6", "$8 large Brewery in Focus; $6 medium Brewery in Focus"],
    ["$10 select cocktails, $10 craft beer and wine.", "$10 select cocktails; $10 craft beer and wine"],
    ["Singha Longneck $15, Selected wines by the glass $10", "$15 Singha longneck; $10 selected wines by the glass"],
    ["Half priced select drinks and bar snacks", "50% off select drinks and bar snacks"],
    ["$9.00 pints & $6.5 house wine", "$9 pints; $6.50 house wine"],
    ["Cocktails $8.50 - 9.50", "$8.50-$9.50 cocktails"],
  ])("accepts %j → %j", (original, tidied) => {
    expect(guardTidied(original, tidied)).toEqual({ original, tidied, changed: true });
  });

  it("rejects a changed price and returns the original", () => {
    const r = guardTidied("$10 cocktails", "$12 cocktails");
    expect(r).toMatchObject({ tidied: "$10 cocktails", changed: false });
    expect(r.reason).toMatch(/numbers/);
  });

  it("rejects a dropped or invented price", () => {
    expect(guardTidied("$8 beer, $15 cocktails", "$8 beer and cocktails").changed).toBe(false);
    expect(guardTidied("Cheap beer", "$5 beer").changed).toBe(false);
  });

  it("rejects a price turned into a percentage", () => {
    expect(guardTidied("$50 off platters", "50% off platters").changed).toBe(false);
  });

  it("rejects a dropped condition", () => {
    const r = guardTidied("$10 select cocktails until sold out", "$10 cocktails until sold out");
    expect(r.changed).toBe(false);
    expect(r.reason).toMatch(/select/);
  });

  it("rejects empty, non-string, overlong and padded suggestions", () => {
    expect(guardTidied("$5 pints", "   ").reason).toMatch(/empty/);
    expect(guardTidied("$5 pints", undefined).reason).toMatch(/no suggestion/);
    expect(guardTidied("$5 pints", `$5 ${"x".repeat(MAX_DESCRIPTION_CHARS)}`).reason).toMatch(/too long/);
    expect(guardTidied("$5 pints", `$5 pints ${"and more ".repeat(10)}`).reason).toMatch(/much longer/);
  });

  it("reports an identical suggestion as unchanged without a reason", () => {
    expect(guardTidied("$5 pints", " $5 pints ")).toEqual({ original: "$5 pints", tidied: "$5 pints", changed: false });
  });
});

describe("validateTidyInput", () => {
  it.each([
    [null, /non-empty array/],
    [{}, /non-empty array/],
    [{ descriptions: [] }, /non-empty array/],
    [{ descriptions: [1] }, /strings/],
    [{ descriptions: ["  "] }, /blank/],
    [{ descriptions: ["x".repeat(MAX_DESCRIPTION_CHARS + 1)] }, /too long/],
    [{ descriptions: Array(11).fill("$5 pints") }, /too many/],
  ])("rejects %j", (body, msg) => {
    expect(validateTidyInput(body, 10)).toMatch(msg);
  });

  it("accepts a valid list", () => {
    expect(validateTidyInput({ descriptions: ["$5 pints", "2-for-1 cocktails"] }, 10)).toBeNull();
  });
});

it("the tidy prompt carries the shared format rules", () => {
  expect(TIDY_SYSTEM_PROMPT).toContain(DEAL_TEXT_FORMAT);
});
