// Time helpers for the "Submit a Hoppy Hour" deal-hours picker.
//
// The picker works internally in MINUTES SINCE MIDNIGHT of the start day, with
// past-midnight values continuing past 1440 (12 AM = 1440, 1 AM = 1500,
// 2 AM = 1560). This keeps end > start for every range the picker can produce,
// including late-night deals like 10 PM–1 AM (1320 → 1500).
//
// Storage, however, stays on the existing 'HH:MM' clock-string contract
// (see functions/_shared/db.ts, src/hooks/use-venues.ts). `minutesToClock`
// wraps a picker value back to a clock string on the way to the form: a
// late-night deal is stored as start > end (22:00 → 01:00), which the map
// filter and display formatters already understand.

export const DEAL_MIN = 660; // 11:00 AM
export const DEAL_MAX = 1560; // 2:00 AM next day
export const DEAL_STEP = 30;

/** Format minutes-since-midnight as a 12-hour clock label, e.g. 1020 → "5:00 PM". */
export function formatMinutes(m: number): string {
  const clock = ((m % 1440) + 1440) % 1440;
  let h = Math.floor(clock / 60);
  const min = clock % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(min).padStart(2, "0")} ${ampm}`;
}

/** Wrap picker minutes to an 'HH:MM' clock string for storage (1500 → "01:00"). */
export function minutesToClock(m: number): string {
  const clock = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(clock / 60);
  const min = clock % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Dropdown options from 11 AM to 2 AM next day in 30-minute steps. */
export const TIME_OPTIONS: { value: number; label: string }[] = (() => {
  const opts: { value: number; label: string }[] = [];
  for (let m = DEAL_MIN; m <= DEAL_MAX; m += DEAL_STEP) {
    opts.push({ value: m, label: formatMinutes(m) });
  }
  return opts;
})();

export const TWEAK_HINT = "Tweak the times if yours are slightly different";
export const CUSTOM_HINT = "Pick your start and end times";

export interface DealPreset {
  key: string;
  label: string;
  /** null start/end = "Custom": pick times manually. */
  start: number | null;
  end: number | null;
  hint: string;
}

export const DEAL_PRESETS: DealPreset[] = [
  { key: "4-6", label: "4–6 PM", start: 960, end: 1080, hint: TWEAK_HINT },
  { key: "4-7", label: "4–7 PM", start: 960, end: 1140, hint: TWEAK_HINT },
  { key: "5-6", label: "5–6 PM", start: 1020, end: 1080, hint: TWEAK_HINT },
  { key: "5-7", label: "5–7 PM", start: 1020, end: 1140, hint: TWEAK_HINT },
  { key: "all", label: "All day", start: 660, end: 1380, hint: TWEAK_HINT },
  { key: "custom", label: "Custom", start: null, end: null, hint: CUSTOM_HINT },
];

/** Neutral default the "Custom" chip pre-fills: 5:00 PM – 6:00 PM. */
export const CUSTOM_DEFAULT_START = 1020;
export const CUSTOM_DEFAULT_END = 1080;

/**
 * Keep end after start. If the chosen start is at or past end, bump end to
 * start + 60 min, capped at the 2 AM maximum. No error surfaced (per spec).
 */
export function bumpedEnd(start: number, end: number): number {
  if (end <= start) return Math.min(start + 60, DEAL_MAX);
  return end;
}
