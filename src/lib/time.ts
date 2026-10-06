// Round a Date's time-of-day to the nearest 15 minutes, as "HH:MM".
export function roundTo15(d: Date): string {
  const m = Math.round(d.getMinutes() / 15) * 15;
  const h = d.getHours() + (m === 60 ? 1 : 0);
  // Fix B4: 23:53–23:59 rounds up to 24:00. Clamp to "23:59" instead of
  // wrapping to "00:00" — filter times are compared as strings, and "00:00"
  // without advancing the date would point at the wrong end of the day
  // (start-of-today rather than end-of-today).
  if (h === 24) return "23:59";
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
