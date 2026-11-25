// The map's DOM markers (venue pins and cluster bubbles), kept so they stay
// locked to the map while it moves.
//
// Mapbox positions a marker by writing `transform` on its element, and while
// the map is moving it defers that write to the start of the next rendered
// frame. So a marker attached (or given new coordinates) during a move is
// painted for one frame wherever its element happens to be: a new element at
// the map's top-left corner, a re-attached one where it was when it was last
// removed. Attaching and removing markers on every render, as clusters split
// and tiles load, made pins jump and trail behind the map. The rules here:
//
//  - a marker is created and attached once per pin or cluster, then reused;
//    one that is not wanted is hidden, not detached, so Mapbox keeps
//    positioning it and it is already in place when it shows again;
//  - a marker created or moved in one rendered frame is shown from the next
//    one at the earliest, once Mapbox has written its position;
//  - its position is only set again when its coordinates change;
//  - nothing on the positioned element animates (its visuals live on an inner
//    element), so it can never ease towards its position;
//  - a marker waiting for "the next frame" must get one: when the map is idle
//    Mapbox renders nothing more, so the caller asks for a repaint while
//    `needsFrame` says a wanted marker is still waiting. Without that, markers
//    created in the map's last frame stayed hidden until the map next moved:
//    selecting a venue re-clusters the source (it leaves the selected venue
//    out), every cluster gets a new id and so a new marker, and all of them
//    vanished until the selection was cleared.

export type LngLatTuple = [number, number];

/** The parts of mapboxgl.Marker this module uses (a fake one in tests). */
export interface MarkerLike {
  setLngLat(lngLat: LngLatTuple): unknown;
  remove(): unknown;
}

export interface MarkerEntry<K, M extends MarkerLike> {
  key: K;
  marker: M;
  el: HTMLButtonElement;
  lngLat: LngLatTuple;
  wanted: boolean;
  /** The frame its position was last set in; it shows from a later frame. */
  placedAt: number;
}

export interface MarkerItem<K> {
  key: K;
  lngLat: LngLatTuple;
}

/** Mapbox has written the element's position (it starts with no transform). */
export function isPositioned(el: HTMLElement): boolean {
  return el.style.transform !== "";
}

/**
 * Closer than this (degrees, about a metre: under a pixel up to street zoom)
 * is the same place. A cluster's coordinates come from the source's tiles,
 * rounded to the tile grid, so they wobble that much between tiles.
 */
const SAME_PLACE = 1e-5;

/** Frames a new or moved marker may wait to be positioned before we stop asking for more. */
const MAX_WAIT_FRAMES = 30;

function setShown(el: HTMLElement, shown: boolean) {
  const value = shown ? "" : "hidden";
  // visibility:hidden also takes the button out of the tab order, the
  // accessibility tree and hit testing.
  if (el.style.visibility !== value) el.style.visibility = value;
}

export class MarkerLayer<K, M extends MarkerLike> {
  readonly entries = new Map<K, MarkerEntry<K, M>>();

  constructor(
    private readonly make: (key: K) => { marker: M; el: HTMLButtonElement },
    private readonly attach: (marker: M) => void,
  ) {}

  /**
   * Show exactly `items`: create (once) any that are new, hide the rest.
   * Never detaches a marker, so it is safe to call on every rendered frame.
   * `frame` counts the map's rendered frames (it goes up by one per "render"
   * event). Returns the wanted entries, to style.
   */
  sync(items: Iterable<MarkerItem<K>>, frame: number): MarkerEntry<K, M>[] {
    const wanted: MarkerEntry<K, M>[] = [];
    for (const entry of this.entries.values()) entry.wanted = false;
    for (const { key, lngLat } of items) {
      let entry = this.entries.get(key);
      if (!entry) {
        const { marker, el } = this.make(key);
        setShown(el, false);
        marker.setLngLat(lngLat);
        this.attach(marker);
        entry = { key, marker, el, lngLat, wanted: false, placedAt: frame };
        this.entries.set(key, entry);
      } else if (Math.abs(entry.lngLat[0] - lngLat[0]) > SAME_PLACE || Math.abs(entry.lngLat[1] - lngLat[1]) > SAME_PLACE) {
        entry.lngLat = lngLat;
        entry.placedAt = frame;
        entry.marker.setLngLat(lngLat);
      }
      if (entry.wanted) continue; // the same key twice in one pass
      entry.wanted = true;
      wanted.push(entry);
    }
    for (const entry of this.entries.values()) {
      setShown(entry.el, entry.wanted && frame > entry.placedAt && isPositioned(entry.el));
    }
    return wanted;
  }

  /**
   * A wanted marker is still hidden waiting for a later frame (see the rules
   * above): the caller must make the map render one. Only recent placements
   * count, so a marker that can never be positioned does not make the map
   * repaint for ever.
   */
  needsFrame(frame: number): boolean {
    for (const entry of this.entries.values()) {
      if (entry.wanted && entry.el.style.visibility === "hidden" && frame - entry.placedAt < MAX_WAIT_FRAMES) return true;
    }
    return false;
  }

  /** Markers attached but not shown. */
  hiddenCount(): number {
    let n = 0;
    for (const entry of this.entries.values()) if (!entry.wanted) n++;
    return n;
  }

  /** Detach and forget markers: the hidden ones, or those `drop` picks. */
  prune(drop: (key: K, entry: MarkerEntry<K, M>) => boolean = (_k, e) => !e.wanted) {
    for (const [key, entry] of this.entries) {
      if (drop(key, entry)) {
        entry.marker.remove();
        this.entries.delete(key);
      }
    }
  }

  clear() {
    this.prune(() => true);
  }
}

/**
 * A marker's element: a <button> (positioned by Mapbox, no transitions, the
 * 44px touch area via CSS) around an inner element that carries the visuals
 * and their transitions.
 */
export function createMarkerButton(className: string): { el: HTMLButtonElement; face: HTMLSpanElement } {
  const el = document.createElement("button");
  el.type = "button";
  // Stated outright: mapboxgl.Marker gives an element without a role
  // role="img", which would announce the button as an image.
  el.setAttribute("role", "button");
  el.className = className;
  Object.assign(el.style, {
    padding: "0",
    border: "0",
    background: "transparent",
    borderRadius: "9999px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "inherit",
  } satisfies Partial<CSSStyleDeclaration>);
  const face = document.createElement("span");
  face.className = "map-marker-face";
  el.appendChild(face);
  return { el, face };
}
