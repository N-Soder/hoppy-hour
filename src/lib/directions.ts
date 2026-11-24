// "Directions" for a venue: Apple Maps where it is the platform's own maps app
// (iPhone, iPad, and Safari on a Mac), Google Maps everywhere else.

export interface DirectionsTarget {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

/**
 * Apple devices running Safari (or any iOS browser, which all hand
 * maps.apple.com links to the Maps app). iPadOS reports itself as a Mac, so a
 * Mac with a touch screen counts as iOS.
 */
export function prefersAppleMaps(userAgent: string, maxTouchPoints = 0): boolean {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (ios) return true;
  const mac = /Macintosh/.test(userAgent);
  const safari = /Safari\//.test(userAgent) && !/Chrome\/|Chromium\/|CriOS|Edg\/|OPR\/|Firefox\/|FxiOS/.test(userAgent);
  return mac && safari;
}

/** Directions URL to the venue, opened in a new tab by the caller. */
export function directionsUrl(target: DirectionsTarget, apple: boolean): string {
  if (apple) {
    const p = new URLSearchParams({ daddr: `${target.lat},${target.lng}`, q: target.name });
    return `https://maps.apple.com/?${p.toString()}`;
  }
  const p = new URLSearchParams({
    api: "1",
    destination: `${target.name}, ${target.address}`,
  });
  return `https://www.google.com/maps/dir/?${p.toString()}`;
}

/** Directions URL for the current browser. */
export function directionsUrlForBrowser(target: DirectionsTarget): string {
  const nav = typeof navigator === "undefined" ? null : navigator;
  return directionsUrl(target, nav ? prefersAppleMaps(nav.userAgent, nav.maxTouchPoints ?? 0) : false);
}
