// When a venue's next deal starts, for venues with nothing on at the selected
// date and time. Pure, so the week arithmetic is unit-tested.
import { DAYS_SHORT } from "./constants";
import { formatTimeRange, toMinutes } from "./format";
import type { HappyHour } from "./api-types";

export interface NextDeal {
  deal: HappyHour;
  /** Days after the selected date the deal starts on: 0 (later that day) … 7 (same weekday next week). */
  daysAhead: number;
  /** Stored day index (0=Sun…6=Sat) of the start. */
  day: number;
}

const MINUTES_PER_DAY = 1440;

/**
 * The first deal to start after the selected moment, looking forward through
 * the week and wrapping into next week (so a Monday-only deal seen from a
 * Tuesday is six days ahead, and one that started earlier today is seven).
 * Ties on the same start pick the deal listed first. Null when the venue has
 * no deals with any days.
 *
 * `day` is the selected date's weekday (0=Sun…6=Sat); `time` is "HH:MM" or
 * "HH:MM:SS". A deal starting exactly at the selected time counts as on, not
 * next, so it is skipped for that day.
 */
export function findNextDeal(deals: HappyHour[], day: number, time: string): NextDeal | null {
  const now = toMinutes(time);
  let best: { deal: HappyHour; at: number; day: number } | null = null;
  for (const deal of deals) {
    const start = toMinutes(deal.start_time);
    for (const d of deal.days_of_week ?? []) {
      let daysAhead = (d - day + 7) % 7;
      if (daysAhead === 0 && start <= now) daysAhead = 7;
      const at = daysAhead * MINUTES_PER_DAY + start;
      if (!best || at < best.at) best = { deal, at, day: d };
    }
  }
  if (!best) return null;
  return { deal: best.deal, daysAhead: Math.floor(best.at / MINUTES_PER_DAY), day: best.day };
}

/**
 * "today 7–9 pm", "tomorrow 4–6 pm", "Fri 4–6 pm", "Tue 4–6 pm next week".
 * `selectedIsToday` lets the label say today/tomorrow only when the selected
 * date really is today; for another selected date a weekday is clearer.
 */
export function describeNextDeal(next: NextDeal, selectedIsToday: boolean): string {
  const range = formatTimeRange(next.deal.start_time, next.deal.end_time);
  const time = range === "All day" ? "all day" : range;
  if (selectedIsToday && next.daysAhead === 0) return `today ${time}`;
  if (selectedIsToday && next.daysAhead === 1) return `tomorrow ${time}`;
  const day = DAYS_SHORT[next.day];
  if (next.daysAhead === 7) return `${day} ${time} next week`;
  return `${day} ${time}`;
}
