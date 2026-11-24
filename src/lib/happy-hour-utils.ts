import { DAYS_SHORT, WEEK_ORDER, weekIndex } from "@/lib/constants";
import { toMinutes } from "@/lib/format";
import type { HappyHour } from "@/hooks/use-venues";

export interface GroupedHappyHour {
  /** All source record IDs merged into this group (1..N) */
  ids: string[];
  venue_id: string;
  /** Union of all days from all source records, sorted ascending */
  days_of_week: number[];
  start_time: string;
  end_time: string;
  description: string;
  tags: string[] | null;
  is_active: boolean;
}

/**
 * Groups happy hour records that share the same time, description, tags, and
 * active status. Their days_of_week arrays are merged (unioned) into one.
 * Preserves first-seen insertion order.
 */
export function groupHappyHours(hours: HappyHour[]): GroupedHappyHour[] {
  const map = new Map<string, GroupedHappyHour>();

  for (const hh of hours) {
    const tagKey = (hh.tags ?? [])
      .map((t) => t.trim().toLowerCase())
      .sort()
      .join(",");
    const key = `${hh.start_time}|${hh.end_time}|${hh.description.trim()}|${tagKey}|${hh.is_active}`;

    const existing = map.get(key);
    if (existing) {
      existing.ids.push(hh.id);
      const merged = Array.from(new Set([...existing.days_of_week, ...(hh.days_of_week ?? [])]));
      merged.sort((a, b) => a - b);
      existing.days_of_week = merged;
    } else {
      map.set(key, {
        ids: [hh.id],
        venue_id: hh.venue_id,
        days_of_week: [...(hh.days_of_week ?? [])].sort((a, b) => a - b),
        start_time: hh.start_time,
        end_time: hh.end_time,
        description: hh.description,
        tags: hh.tags,
        is_active: hh.is_active,
      });
    }
  }

  return Array.from(map.values());
}

/**
 * Formats an array of day indices (0=Sun…6=Sat) into a human-readable string,
 * reading the week Monday-first.
 *
 * Rules:
 * - All seven days → "Every day"
 * - Contiguous run of 3+ days in Monday-first order, including a run that
 *   wraps from Sunday back to Monday → "Mon–Fri" (first–last)
 * - 1–2 days, or any non-contiguous set → comma-separated short names, in
 *   Monday-first order
 *
 * Examples:
 *   [1,2,3,4,5] → "Mon–Fri"
 *   [0,1,2,3,4,5,6] → "Every day"
 *   [0,6] → "Sat, Sun"
 *   [3]   → "Wed"
 *   [1,3,5] → "Mon, Wed, Fri"
 *   [5,6,0] → "Fri–Sun"
 *   [6,0,1] → "Sat–Mon"  (wraps past the end of the week)
 */
export function formatDayRange(days: number[]): string {
  if (!days || days.length === 0) return "";
  const unique = Array.from(new Set(days));
  if (unique.length === 7) return "Every day";
  // Positions in the Monday-first week (Mon=0 … Sun=6), ascending.
  const pos = unique.map(weekIndex).sort((a, b) => a - b);
  const name = (p: number) => DAYS_SHORT[WEEK_ORDER[p]];

  if (pos.length >= 3) {
    // Treat the week as a circle: the set is one contiguous run when exactly
    // one gap between consecutive members (wrapping Sun→Mon) is larger than 1.
    let gaps = 0;
    let runStart = pos[0];
    for (let i = 0; i < pos.length; i++) {
      const next = pos[(i + 1) % pos.length] + (i + 1 === pos.length ? 7 : 0);
      if (next - pos[i] !== 1) {
        gaps++;
        runStart = pos[(i + 1) % pos.length];
      }
    }
    if (gaps === 1) {
      const runEnd = (runStart + pos.length - 1) % 7;
      return `${name(runStart)}–${name(runEnd)}`;
    }
  }

  return pos.map(name).join(", ");
}

/**
 * Splits a grouped happy hour back into individual per-day records (without IDs).
 * The caller is responsible for deleting the source records and inserting these.
 */
export function ungroupHappyHour(
  group: GroupedHappyHour
): Omit<HappyHour, "id">[] {
  return group.days_of_week.map((day) => ({
    venue_id: group.venue_id,
    days_of_week: [day],
    start_time: group.start_time,
    end_time: group.end_time,
    description: group.description,
    tags: group.tags,
    is_active: group.is_active,
  }));
}

/** Monday-first sort key for a set of days: its earliest day in week order. */
function firstWeekDay(days: number[]): number {
  return days.length === 0 ? 7 : Math.min(...days.map(weekIndex));
}

/**
 * Groups deals that share the exact same days_of_week set under one header,
 * then sorts those sections in week order (Monday first; the section that
 * starts earliest in the week comes first, and a shorter set wins a tie).
 * Deals within each section are sorted by start time.
 */
export function groupByDaySet(
  groups: GroupedHappyHour[],
): { days: number[]; deals: GroupedHappyHour[] }[] {
  const map = new Map<string, { days: number[]; deals: GroupedHappyHour[] }>();
  for (const group of groups) {
    const key = [...group.days_of_week].sort((a, b) => a - b).join(",");
    const existing = map.get(key);
    if (existing) {
      existing.deals.push(group);
    } else {
      map.set(key, { days: group.days_of_week, deals: [group] });
    }
  }
  return Array.from(map.values())
    .sort(
      (a, b) =>
        firstWeekDay(a.days) - firstWeekDay(b.days) || a.days.length - b.days.length,
    )
    .map(({ days, deals }) => ({
      days,
      deals: deals.slice().sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time)),
    }));
}

/** The deals that run on `day` (0=Sun…6=Sat), earliest start first. */
export function dealsOnDay(groups: GroupedHappyHour[], day: number): GroupedHappyHour[] {
  return groups
    .filter((g) => g.days_of_week.includes(day))
    .sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
}
