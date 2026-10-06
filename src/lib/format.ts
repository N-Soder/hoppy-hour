// Shared display formatters for venue distances and hoppy hour times.

// "17:00:00" (or "17:00") → "5:00 PM". Hour 0 maps to 12 AM.
export function formatTime(t: string): string {
  const [h, m] = t.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

// Metres under 1km are rounded ("950m"); otherwise one decimal ("1.3km").
export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}
