import { DAYS_SHORT } from "@/lib/constants";
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
 * Formats an array of day indices (0=Sun…6=Sat) into a human-readable string.
 *
 * Rules:
 * - Contiguous run of 3+ days (including week-wrapping) → "Mon–Fri" (first–last)
 * - 1–2 days, or any non-contiguous set → comma-separated short names
 *
 * Examples:
 *   [1,2,3,4,5] → "Mon–Fri"
 *   [0,1,2,3,4,5,6] → "Sun–Sat"
 *   [0,6] → "Sun, Sat"   (non-contiguous even though they are adjacent wrapping)
 *   [3]   → "Wed"
 *   [1,3,5] → "Mon, Wed, Fri"
 *   [5,6,0] → "Fri–Sun"  (week-wrapping contiguous range)
 */
export function formatDayRange(days: number[]): string {
  if (!days || days.length === 0) return "";
  const sorted = [...days].sort((a, b) => a - b);

  // Check simple forward-contiguous run (no wrapping)
  const isForwardContiguous =
    sorted.length >= 3 &&
    sorted[sorted.length - 1] - sorted[0] === sorted.length - 1;

  if (isForwardContiguous) {
    return `${DAYS_SHORT[sorted[0]]}–${DAYS_SHORT[sorted[sorted.length - 1]]}`;
  }

  // Fix #10: check for week-wrapping contiguous range, e.g. [5,6,0] → Fri–Sun.
  // A wrap is contiguous if there is exactly one "gap" in the sorted array
  // (the wrap point from Sat=6 back to Sun=0) and all days before + after the
  // gap are consecutive.
  if (sorted.length >= 3) {
    // Find the single gap where the sequence breaks (day[i+1] !== day[i] + 1)
    let gapIndex = -1;
    let gapCount = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i + 1] !== sorted[i] + 1) {
        gapCount++;
        gapIndex = i;
      }
    }
    // Exactly one interior gap → potential wrap
    if (gapCount === 1) {
      const tail = sorted.slice(0, gapIndex + 1);   // days before gap (lower numbers = start of week)
      const head = sorted.slice(gapIndex + 1);       // days after gap  (higher numbers = end of week)
      // The wrap is valid if head ends at 6 (Sat) and tail starts at 0 (Sun),
      // and together they form a contiguous run around the week boundary.
      const wrapsAround =
        head[head.length - 1] === 6 &&
        tail[0] === 0 &&
        head.length + tail.length === sorted.length;
      // Check both segments are internally contiguous
      const headContiguous = head[head.length - 1] - head[0] === head.length - 1;
      const tailContiguous = tail[tail.length - 1] - tail[0] === tail.length - 1;
      if (wrapsAround && headContiguous && tailContiguous) {
        // Display as "first-of-head–last-of-tail"
        return `${DAYS_SHORT[head[0]]}–${DAYS_SHORT[tail[tail.length - 1]]}`;
      }
    }
  }

  return sorted.map((d) => DAYS_SHORT[d]).join(", ");
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
