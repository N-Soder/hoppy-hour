import { describe, it, expect } from "vitest";
import { splitOffers } from "@/lib/deal-text";

describe("splitOffers", () => {
  it("splits on '; ' and pulls out each leading price", () => {
    expect(
      splitOffers("$9.00 pints of Great Northern and Carlton Dry; $5.00 glasses of Deepwoods SSB and Rothbury Estate Cabernet Merlot"),
    ).toEqual({
      offers: [
        { price: "$9", text: "pints of Great Northern and Carlton Dry" },
        { price: "$5", text: "glasses of Deepwoods SSB and Rothbury Estate Cabernet Merlot" },
      ],
    });
  });

  it("keeps text without '; ' on one line and never splits on commas", () => {
    expect(splitOffers("$8 beer and wine, $15 select cocktails")).toEqual({
      offers: [{ price: "$8", text: "beer and wine, $15 select cocktails" }],
    });
    expect(splitOffers("Bottomless brunch")).toEqual({ offers: [{ text: "Bottomless brunch" }] });
  });

  it("keeps cents that matter", () => {
    expect(splitOffers("$7.50 house wine").offers).toEqual([{ price: "$7.50", text: "house wine" }]);
  });

  it("does not read a malformed or glued-on price as one", () => {
    expect(splitOffers("$6.5 schooners").offers).toEqual([{ text: "$6.5 schooners" }]);
    expect(splitOffers("$9pints").offers).toEqual([{ text: "$9pints" }]);
    expect(splitOffers("$9").offers).toEqual([{ text: "$9" }]);
    expect(splitOffers("Half price $9 pints").offers).toEqual([{ text: "Half price $9 pints" }]);
  });

  it("ignores a trailing semicolon, empty segments and stray spaces", () => {
    expect(splitOffers("  $9 pints;   $5 wines; ")).toEqual({
      offers: [
        { price: "$9", text: "pints" },
        { price: "$5", text: "wines" },
      ],
    });
    expect(splitOffers("$9 pints;")).toEqual({ offers: [{ price: "$9", text: "pints" }] });
    expect(splitOffers("")).toEqual({ offers: [] });
    expect(splitOffers(null)).toEqual({ offers: [] });
    expect(splitOffers(" ; ")).toEqual({ offers: [] });
  });

  it("does not split on a semicolon without a following space", () => {
    expect(splitOffers("a;b").offers).toEqual([{ text: "a;b" }]);
  });

  it("reads 'Title: ' before the first offer", () => {
    expect(splitOffers("Monday Steak Night: $25 200g skirt steak with chips; $9 pints")).toEqual({
      title: "Monday Steak Night",
      offers: [
        { price: "$25", text: "200g skirt steak with chips" },
        { price: "$9", text: "pints" },
      ],
    });
  });

  it("allows a title with no offers after it", () => {
    expect(splitOffers("Trivia Night:")).toEqual({ title: "Trivia Night", offers: [] });
    expect(splitOffers("Trivia Night: ")).toEqual({ title: "Trivia Night", offers: [] });
    expect(splitOffers("Trivia Night: ; $9 pints")).toEqual({
      title: "Trivia Night",
      offers: [{ price: "$9", text: "pints" }],
    });
  });

  it("does not take a title from a line that opens with a price or a later colon", () => {
    expect(splitOffers("$9 pints: all day").offers).toEqual([{ price: "$9", text: "pints: all day" }]);
    expect(splitOffers("$9 pints; Note: cash only")).toEqual({
      offers: [
        { price: "$9", text: "pints" },
        { text: "Note: cash only" },
      ],
    });
  });

  it("keeps very long text whole", () => {
    const long = "pints of ".concat("Great Northern ".repeat(40)).trim();
    expect(splitOffers(`$9 ${long}`).offers).toEqual([{ price: "$9", text: long }]);
  });
});
