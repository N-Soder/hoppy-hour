import { describe, it, expect } from "vitest";
import { directionsUrl, prefersAppleMaps } from "@/lib/directions";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1";
const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

describe("prefersAppleMaps", () => {
  it("is true on iOS in any browser and on Mac Safari", () => {
    expect(prefersAppleMaps(IPHONE)).toBe(true);
    expect(prefersAppleMaps(IPHONE_CHROME)).toBe(true);
    expect(prefersAppleMaps(MAC_SAFARI)).toBe(true);
    // iPadOS reports a Mac user agent but has touch points.
    expect(prefersAppleMaps(MAC_SAFARI, 5)).toBe(true);
  });
  it("is false for Chrome on a Mac and for Android", () => {
    expect(prefersAppleMaps(MAC_CHROME)).toBe(false);
    expect(prefersAppleMaps(ANDROID)).toBe(false);
  });
});

describe("directionsUrl", () => {
  const venue = { name: "Ezra Pound", address: "189 William St, Northbridge WA 6003", lat: -31.9478, lng: 115.8594 };
  it("builds an Apple Maps link labelled with the venue, hinted at its coordinates", () => {
    const url = new URL(directionsUrl(venue, true));
    expect(url.origin + url.pathname).toBe("https://maps.apple.com/");
    expect(url.searchParams.get("daddr")).toBe("Ezra Pound, 189 William St, Northbridge WA 6003");
    expect(url.searchParams.get("sll")).toBe("-31.9478,115.8594");
  });
  it("labels the destination with the name alone when there is no address", () => {
    const url = new URL(directionsUrl({ ...venue, address: " " }, true));
    expect(url.searchParams.get("daddr")).toBe("Ezra Pound");
    expect(new URL(directionsUrl({ ...venue, address: "" }, false)).searchParams.get("destination")).toBe("Ezra Pound");
  });
  it("builds a Google Maps directions link to the name and address", () => {
    const url = new URL(directionsUrl(venue, false));
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("destination")).toBe("Ezra Pound, 189 William St, Northbridge WA 6003");
  });
});
