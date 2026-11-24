// Shared display formatters: deal times, the date/time selection, distances
// and counts. These are the app's single source of truth for how a time or a
// time range reads — use them everywhere instead of formatting inline.
//
// House style for times: lower-case "am"/"pm", ":00" dropped ("5 pm"), an en
// dash between range ends with no spaces, the meridiem repeated only when the
// two ends differ ("5–6 pm", "11:30 am–2 pm", "10 pm–2 am"), and "All day" for
// a deal stored as 00:00–23:59.
import { DAYS_SHORT } from "./constants";

const MINUTES_PER_DAY = 1440;

/**
 * Minutes since midnight for a clock string ("17:00", "17:00:00") or a
 * minute count. Minute counts wrap into one day, so the deal picker's
 * past-midnight values (1500 = 1 am next day) work too.
 */
export function toMinutes(t: string | number): number {
  if (typeof t === "number") {
    return ((Math.round(t) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  }
  const [h, m] = t.split(":");
  return (parseInt(h, 10) % 24) * 60 + (parseInt(m, 10) || 0);
}

function clockParts(t: string | number): { hm: string; meridiem: "am" | "pm" } {
  const mins = toMinutes(t);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const h12 = h % 12 || 12;
  return {
    hm: m === 0 ? String(h12) : `${h12}:${String(m).padStart(2, "0")}`,
    meridiem: h < 12 ? "am" : "pm",
  };
}

/** A single clock time: "17:00:00" → "5 pm", "17:30" → "5:30 pm", "00:00" → "12 am". */
export function formatClock(t: string | number): string {
  const { hm, meridiem } = clockParts(t);
  return `${hm} ${meridiem}`;
}

/** True for a deal that runs the whole day (stored as 00:00–23:59). */
export function isAllDay(start: string | number, end: string | number): boolean {
  return toMinutes(start) === 0 && toMinutes(end) >= MINUTES_PER_DAY - 1;
}

/**
 * A deal's time range: "5–6 pm", "11:30 am–2 pm", "10 pm–2 am", "All day".
 * Accepts clock strings or minutes since midnight. A range whose end is at or
 * before its start crosses midnight, so both ends always carry their meridiem.
 */
export function formatTimeRange(start: string | number, end: string | number): string {
  if (isAllDay(start, end)) return "All day";
  const s = clockParts(start);
  const e = clockParts(end);
  const crossesMidnight = toMinutes(end) <= toMinutes(start);
  if (!crossesMidnight && s.meridiem === e.meridiem) {
    return `${s.hm}–${e.hm} ${e.meridiem}`;
  }
  return `${s.hm} ${s.meridiem}–${e.hm} ${e.meridiem}`;
}

// Metres under 1km are rounded ("950m"); otherwise one decimal ("1.3km").
export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

/** "1 deal", "2 deals", "0 venues". */
export function plural(n: number, noun: string, pluralNoun = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : pluralNoun}`;
}

// ─── The date/time the user is looking at ──────────────────────────────────

/** How close (minutes) the chosen time must be to the clock to count as "now". */
const NOW_TOLERANCE_MIN = 15;

export interface SelectionLabel {
  /** The filter points at the present moment, so "Live" is true. */
  isNow: boolean;
  /** Badge text for a venue with a deal on at the selection: "Live" or "On Sat 5:15 pm". */
  badge: string;
  /** Completes "N deals on …": "now", "Sat 5:15 pm", "at 7 pm" (later today). */
  phrase: string;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Describe the date + time filter relative to `now`, so nothing claims a deal
 * is live unless the filter really is the present moment.
 *
 * - same day, time within 15 minutes of the clock → Live / "now"
 * - later or earlier today                        → "On at 7 pm" / "at 7 pm"
 * - another day within the next week               → "On Sat 5:15 pm"
 * - further away or in the past                    → "On Sat 5 Dec 5:15 pm"
 */
export function describeSelection(date: Date, time: string, now: Date): SelectionLabel {
  const clock = formatClock(time);
  if (sameDay(date, now)) {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    if (Math.abs(toMinutes(time) - nowMin) <= NOW_TOLERANCE_MIN) {
      return { isNow: true, badge: "Live", phrase: "now" };
    }
    return { isNow: false, badge: `On at ${clock}`, phrase: `at ${clock}` };
  }
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const daysAhead = Math.round((startOfDate - startOfToday) / 86_400_000);
  const day = DAYS_SHORT[date.getDay()];
  const dayLabel =
    daysAhead > 0 && daysAhead < 7 ? day : `${day} ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
  return { isNow: false, badge: `On ${dayLabel} ${clock}`, phrase: `${dayLabel} ${clock}` };
}
