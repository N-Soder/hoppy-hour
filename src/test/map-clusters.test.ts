import { describe, it, expect } from "vitest";
import { clusterLabel, clusterText, markerItems, pinLabel, venuesToFeatureCollection } from "@/lib/map-clusters";

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

describe("markerItems", () => {
  const venues = new Map(
    [
      { id: "a", name: "A", lat: -31.9, lng: 115.8 },
      { id: "b", name: "B", lat: -31.8, lng: 115.7 },
      { id: "sel", name: "Selected", lat: -31.85, lng: 115.75 },
    ].map((v) => [v.id, v]),
  );
  const pin = (id: string, lng: number, lat: number) => ({
    geometry: { type: "Point", coordinates: [lng + 1e-4, lat] },
    properties: { id, live: 0 },
  });
  const cluster = (id: number, count: number, live: number) => ({
    geometry: { type: "Point", coordinates: [115.76, -31.86] },
    properties: { cluster: true, cluster_id: id, point_count: count, live },
  });

  it("keeps every cluster while a venue is selected, and adds the selected venue as its own pin, last", () => {
    const items = markerItems([cluster(7, 12, 3), pin("a", 115.8, -31.9), cluster(7, 12, 3), cluster(9, 4, 0)], venues, "sel");
    expect(items.clusters.map((c) => c.key)).toEqual([7, 9]);
    expect(items.clusterCounts.get(7)).toEqual({ count: 12, live: 3 });
    expect(items.pins.map((p) => p.key)).toEqual(["a", "sel"]);
    // Pins sit at the venue's own coordinates, not the tile-rounded ones.
    expect(items.pins[0].lngLat).toEqual([115.8, -31.9]);
  });

  it("shows the selected pin once even if the source still reports it", () => {
    const items = markerItems([pin("sel", 115.75, -31.85), pin("b", 115.7, -31.8)], venues, "sel");
    expect(items.pins.map((p) => p.key)).toEqual(["b", "sel"]);
  });

  it("with nothing selected, draws exactly what the source reports", () => {
    const items = markerItems([pin("a", 115.8, -31.9), cluster(3, 2, 1)], venues, null);
    expect(items.pins.map((p) => p.key)).toEqual(["a"]);
    expect(items.clusters.map((c) => c.key)).toEqual([3]);
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
