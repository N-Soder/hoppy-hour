// Time helpers for the "Submit a deal" deal-hours picker.
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
import { formatClock, formatTimeRange } from "./format";

export const DEAL_MIN = 660; // 11:00 AM
export const DEAL_MAX = 1560; // 2:00 AM next day
export const DEAL_STEP = 30;

/** Wrap picker minutes to an 'HH:MM' clock string for storage (1500 → "01:00"). */
export function minutesToClock(m: number): string {
  const clock = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(clock / 60);
  const min = clock % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Dropdown options from 11 am to 2 am next day in 30-minute steps. */
export const TIME_OPTIONS: { value: number; label: string }[] = (() => {
  const opts: { value: number; label: string }[] = [];
  for (let m = DEAL_MIN; m <= DEAL_MAX; m += DEAL_STEP) {
    opts.push({ value: m, label: formatClock(m) });
  }
  return opts;
})();

/**
 * "All day" is stored as 00:00–23:59, the range the formatters read as
 * "All day" (see isAllDay in ./format). Picker minutes for it sit outside the
 * dropdown range on purpose: the dropdowns are hidden while it is selected.
 */
export const ALL_DAY_START = 0;
export const ALL_DAY_END = 1439;

export const TWEAK_HINT = "Tweak the times if yours are slightly different";
export const CUSTOM_HINT = "Pick your start and end times";
export const ALL_DAY_HINT = "Shown as “All day”. Choose Custom to set opening hours instead.";

export interface DealPreset {
  key: string;
  label: string;
  /** null start/end = "Custom": pick times manually. */
  start: number | null;
  end: number | null;
  hint: string;
}

export const DEAL_PRESETS: DealPreset[] = [
  { key: "4-6", label: formatTimeRange(960, 1080), start: 960, end: 1080, hint: TWEAK_HINT },
  { key: "4-7", label: formatTimeRange(960, 1140), start: 960, end: 1140, hint: TWEAK_HINT },
  { key: "5-6", label: formatTimeRange(1020, 1080), start: 1020, end: 1080, hint: TWEAK_HINT },
  { key: "5-7", label: formatTimeRange(1020, 1140), start: 1020, end: 1140, hint: TWEAK_HINT },
  { key: "all", label: "All day", start: ALL_DAY_START, end: ALL_DAY_END, hint: ALL_DAY_HINT },
  { key: "custom", label: "Custom", start: null, end: null, hint: CUSTOM_HINT },
];

/** Neutral default the "Custom" chip pre-fills: 5–6 pm. */
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

/** Picker state for one deal, as kept in a draft. */
export interface PickerState {
  activePreset: string | null;
  startMin: number | null;
  endMin: number | null;
  start_time: string;
  end_time: string;
}

/**
 * Drafts saved before the "All day" preset stored a true all-day range hold
 * 11 am–11 pm under the "all" chip. Bring those forward so a restored draft
 * submits what its chip says. Anything else passes through untouched.
 */
export function migrateLegacyAllDay<T extends PickerState>(d: T): T {
  if (d.activePreset !== "all" || d.startMin !== 660 || d.endMin !== 1380) return d;
  return {
    ...d,
    startMin: ALL_DAY_START,
    endMin: ALL_DAY_END,
    start_time: minutesToClock(ALL_DAY_START),
    end_time: minutesToClock(ALL_DAY_END),
  };
}
