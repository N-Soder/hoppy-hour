import { describe, it, expect } from "vitest";
import { clusterLabel, clusterText, pinLabel, venuesToFeatureCollection } from "@/lib/map-clusters";

const NOW = { isNow: true, badge: "Live", phrase: "now" };
const SAT = { isNow: false, badge: "On Sat 5 pm", phrase: "Sat 5 pm" };

describe("venuesToFeatureCollection", () => {
  const venues = [
    { id: "a", name: "A", lat: -31.9, lng: 115.8 },
    { id: "b", name: "B", lat: -31.8, lng: 115.7 },
  ];
  it("marks live venues and uses lng,lat order", () => {
    const fc = venuesToFeatureCollection(venues, new Set(["b"]), null);
    expect(fc.features.map((f) => [f.properties.id, f.properties.live, f.geometry.coordinates])).toEqual([
      ["a", 0, [115.8, -31.9]],
      ["b", 1, [115.7, -31.8]],
    ]);
  });
  it("leaves the selected venue out so it is never clustered", () => {
    expect(venuesToFeatureCollection(venues, new Set(), "a").features.map((f) => f.properties.id)).toEqual(["b"]);
  });
});

describe("labels", () => {
  it("names a cluster with its live count", () => {
    expect(clusterLabel(12, 3, NOW)).toBe("12 venues, 3 with deals on now. Zoom in");
    expect(clusterLabel(2, 1, SAT)).toBe("2 venues, 1 with a deal on Sat 5 pm. Zoom in");
    expect(clusterLabel(4, 0, NOW)).toBe("4 venues, none with a deal on now. Zoom in");
  });
  it("names a pin with its status", () => {
    expect(pinLabel("Ezra Pound", 2, NOW)).toBe("Ezra Pound, 2 deals on now");
    expect(pinLabel("Ezra Pound", 0, SAT)).toBe("Ezra Pound, no deal on Sat 5 pm");
  });
  it("caps the bubble text", () => {
    expect(clusterText(8)).toBe("8");
    expect(clusterText(150)).toBe("99+");
  });
});
