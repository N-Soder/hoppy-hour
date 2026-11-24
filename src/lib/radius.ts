// Search radius choices for the venue filters.

export const RADIUS_OPTIONS = [1000, 3000, 5000, 10000] as const;
export const DEFAULT_RADIUS = 5000;
export const MAX_RADIUS = RADIUS_OPTIONS[RADIUS_OPTIONS.length - 1];

/** 5000 → "5 km", 500 → "500 m". */
export function formatDistanceRadius(m: number): string {
  return m >= 1000 ? `${Number((m / 1000).toFixed(1))} km` : `${m} m`;
}
