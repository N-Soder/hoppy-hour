import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MarkerLayer, createMarkerButton, type LngLatTuple, type MarkerItem } from "@/lib/map-markers";

// A stand-in for mapboxgl.Marker that behaves like it does while the map is
// moving: attaching or moving a marker only queues its position, which is
// written to the element's transform when the next frame renders.
class FakeMarker {
  setLngLatCalls = 0;
  removed = false;
  queued: LngLatTuple | null = null;
  constructor(readonly el: HTMLElement) {}
  setLngLat(lngLat: LngLatTuple) {
    this.setLngLatCalls++;
    this.queued = lngLat;
  }
  remove() {
    this.removed = true;
    this.el.remove();
  }
  /** Mapbox's per-frame DOM write. */
  render() {
    if (this.removed || !this.queued) return;
    this.el.style.transform = `translate(${this.queued[0]}px, ${this.queued[1]}px) translate(-50%, -50%)`;
  }
}

describe("MarkerLayer", () => {
  let made: FakeMarker[];
  let layer: MarkerLayer<string, FakeMarker>;
  let frame: number;
  const container = document.createElement("div");

  /** One rendered frame: Mapbox positions markers, then the app syncs. */
  const renderFrame = (items: MarkerItem<string>[]) => {
    frame++;
    made.forEach((m) => m.render());
    return layer.sync(items, frame);
  };
  const shown = () =>
    [...layer.entries.values()].filter((e) => e.el.style.visibility !== "hidden").map((e) => e.key).sort();

  beforeEach(() => {
    made = [];
    frame = 0;
    layer = new MarkerLayer(
      () => {
        const { el } = createMarkerButton("venue-pin");
        const marker = new FakeMarker(el);
        made.push(marker);
        return { el, marker };
      },
      (marker) => container.appendChild(marker.el),
    );
  });

  const a: MarkerItem<string> = { key: "a", lngLat: [115.86, -31.95] };
  const b: MarkerItem<string> = { key: "b", lngLat: [115.87, -31.94] };

  it("creates each marker once and reuses it on every frame of a move", () => {
    for (let i = 0; i < 120; i++) renderFrame([a, b]);
    expect(made).toHaveLength(2);
    expect(made.every((m) => !m.removed)).toBe(true);
    // Its position is set once, not again on every frame.
    expect(made.map((m) => m.setLngLatCalls)).toEqual([1, 1]);
    expect(shown()).toEqual(["a", "b"]);
  });

  it("hides a marker the source stops reporting instead of detaching it, and shows the same element again", () => {
    renderFrame([a, b]);
    renderFrame([a, b]);
    const elB = layer.entries.get("b")!.el;
    renderFrame([a]); // b swallowed into a cluster, or its tile reloading
    expect(shown()).toEqual(["a"]);
    expect(elB.parentNode).toBe(container);
    expect(made[1].removed).toBe(false);
    renderFrame([a, b]);
    expect(layer.entries.get("b")!.el).toBe(elB);
    expect(shown()).toEqual(["a", "b"]);
    expect(made).toHaveLength(2);
  });

  it("never shows a marker before its position has been written", () => {
    renderFrame([a]);
    // Created in this frame: its transform is only written next frame, so it
    // must not be painted (it would sit at the map's top-left corner).
    expect(layer.entries.get("a")!.el.style.transform).toBe("");
    expect(shown()).toEqual([]);
    renderFrame([a]);
    expect(shown()).toEqual(["a"]);
  });

  it("asks for one more frame when markers are made in the map's last frame", () => {
    // Selecting a venue re-clusters the source: new cluster ids, new markers,
    // made while the map is otherwise idle. They wait for the next frame, so
    // the layer must say one is needed (the map then calls triggerRepaint).
    renderFrame([a]);
    renderFrame([a]);
    expect(layer.needsFrame(frame)).toBe(false);
    renderFrame([a, b]);
    expect(shown()).toEqual(["a"]);
    expect(layer.needsFrame(frame)).toBe(true);
    renderFrame([a, b]); // the repaint it asked for
    expect(shown()).toEqual(["a", "b"]);
    expect(layer.needsFrame(frame)).toBe(false);
  });

  it("stops asking for frames for a marker that never gets positioned", () => {
    layer.sync([a], ++frame); // never rendered by the fake map
    expect(layer.needsFrame(frame)).toBe(true);
    for (let i = 0; i < 40; i++) layer.sync([a], ++frame);
    expect(layer.needsFrame(frame)).toBe(false);
  });

  it("hides a marker for the frame its coordinates change", () => {
    renderFrame([a]);
    renderFrame([a]);
    renderFrame([{ key: "a", lngLat: [115.9, -31.9] }]);
    expect(shown()).toEqual([]); // still painted at the old place otherwise
    renderFrame([{ key: "a", lngLat: [115.9, -31.9] }]);
    expect(shown()).toEqual(["a"]);
    expect(made[0].setLngLatCalls).toBe(2);
  });

  it("ignores sub-metre wobble in coordinates", () => {
    renderFrame([a]);
    renderFrame([{ key: "a", lngLat: [a.lngLat[0] + 2e-6, a.lngLat[1] - 2e-6] }]);
    expect(made[0].setLngLatCalls).toBe(1);
    expect(shown()).toEqual(["a"]);
  });

  it("prunes only hidden markers", () => {
    renderFrame([a, b]);
    renderFrame([a]);
    expect(layer.hiddenCount()).toBe(1);
    layer.prune();
    expect([...layer.entries.keys()]).toEqual(["a"]);
    expect(made[1].removed).toBe(true);
    expect(made[0].removed).toBe(false);
  });
});

describe("marker elements", () => {
  it("are buttons whose positioned root has no transition; visuals ease on an inner face", () => {
    const { el, face } = createMarkerButton("venue-pin");
    expect(el.tagName).toBe("BUTTON");
    expect(el.type).toBe("button");
    expect(el.getAttribute("role")).toBe("button"); // else Mapbox sets role="img"
    expect(el.style.transition).toBe("");
    expect(el.style.animation).toBe("");
    expect(face.parentElement).toBe(el);
  });

  it("no stylesheet rule transitions or animates the marker root", () => {
    // Mapbox moves markers by setting `transform` on the root on every frame;
    // a transition there (even `transition: all`) makes pins ease towards
    // their spot and trail the map.
    const css = readFileSync(resolve(__dirname, "../index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ sel: sel.trim(), body }));
    const rootRules = rules.filter(({ sel }) =>
      sel.split(",").some((s) => /\.(venue-pin|venue-cluster|mapboxgl-marker)(?![-\w])(?!\s*(::?(after|before)|\s+\S))/.test(s.trim())),
    );
    expect(rootRules.length).toBeGreaterThan(0);
    for (const { sel, body } of rootRules) {
      expect(body, sel).not.toMatch(/(^|[\s;])(transition|animation)[\w-]*\s*:/);
    }
    const face = rules.find(({ sel }) => sel === ".map-marker-face");
    expect(face?.body).toMatch(/transition:/);
    expect(face?.body).not.toMatch(/transform|\ball\b/);
  });
});
