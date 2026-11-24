// Wall-clock time in a named IANA time zone, with Intl only (no date library).
//
// Deal times are wall-clock times at the venue, so whether a deal is on is
// decided in the venue's zone, not the viewer's. These helpers convert between
// an instant (epoch ms) and the wall clock in a zone, in both directions,
// including DST transitions.

/** Year/month/day/hour/minute on a wall clock, plus the weekday (0=Sun…6=Sat). */
export interface WallClock {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    formatters.set(zone, f);
  }
  return f;
}

/** The viewer's own zone, as the browser reports it. */
export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** True for a zone name this browser's Intl knows. */
export function isValidTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || zone.length === 0) return false;
  try {
    formatterFor(zone);
    return true;
  } catch {
    return false;
  }
}

/** The zone a venue's deal times are in: its own, or the fallback (the viewer's) when unknown. */
export function zoneOrFallback(zone: string | null | undefined, fallback: string): string {
  return isValidTimeZone(zone) ? zone : fallback;
}

/** The wall clock in `zone` at `instant` (epoch ms or Date). */
export function wallClockAt(instant: number | Date, zone: string): WallClock {
  const parts = formatterFor(zone).formatToParts(typeof instant === "number" ? instant : instant.getTime());
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  // Some engines report midnight as 24 even with h23.
  const hour = get("hour") % 24;
  const minute = get("minute");
  return { year, month, day, hour, minute, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

/** Minutes `zone` is ahead of UTC at `instant` (Perth: 480; New York in winter: -300). */
export function offsetMinutes(instant: number | Date, zone: string): number {
  const ms = typeof instant === "number" ? instant : instant.getTime();
  const w = wallClockAt(ms, zone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  return Math.round((asUtc - Math.floor(ms / 60_000) * 60_000) / 60_000);
}

/**
 * The instant at which the wall clock in `zone` reads the given date and time.
 * A time skipped by a DST jump (2:30 am on a spring-forward night) maps to
 * the same distance past the jump (3:30 am); a time that happens twice (the
 * fall-back hour) maps to its first occurrence.
 */
export function instantOfWallClock(
  w: Pick<WallClock, "year" | "month" | "day" | "hour" | "minute">,
  zone: string,
): number {
  const DAY = 86_400_000;
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  // The zone's offsets a day either side cover any single transition near
  // this time. Each gives a candidate instant; keep those whose clock really
  // reads the wanted time, and take the earliest (fall-back overlap: the
  // first occurrence).
  const offsets = new Set([asUtc - DAY, asUtc, asUtc + DAY].map((t) => offsetMinutes(t, zone)));
  const reads = (t: number) => {
    const r = wallClockAt(t, zone);
    return r.year === w.year && r.month === w.month && r.day === w.day && r.hour === w.hour && r.minute === w.minute;
  };
  const candidates = [...offsets].map((o) => asUtc - o * 60_000).filter(reads).sort((a, b) => a - b);
  if (candidates.length > 0) return candidates[0];
  // Spring-forward gap: no instant reads this time. The offset from before
  // the jump lands the same distance past it.
  return asUtc - offsetMinutes(asUtc - DAY, zone) * 60_000;
}

/**
 * The IANA zones this browser knows, sorted, for a picker. Always includes
 * `extra` (the venue's current zone, which may be an alias the list omits)
 * and UTC. Empty-safe on engines without Intl.supportedValuesOf.
 */
export function supportedTimeZones(extra?: string | null): string[] {
  let zones: string[] = [];
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    zones = intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  const all = new Set([...zones, "UTC"]);
  if (extra && isValidTimeZone(extra)) all.add(extra);
  return [...all].sort();
}

/** "HH:MM" for a wall clock. */
export function hhmm(w: Pick<WallClock, "hour" | "minute">): string {
  return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
}

/**
 * A Date whose LOCAL getters read the given wall clock. The date and time
 * pickers work on local Dates; this lets them show another zone's calendar
 * day and time without the viewer's own zone getting in the way.
 */
export function wallClockAsLocalDate(w: Pick<WallClock, "year" | "month" | "day" | "hour" | "minute">): Date {
  return new Date(w.year, w.month - 1, w.day, w.hour, w.minute);
}

/** True when the two zones are on the same UTC offset at `instant`, so their clocks read alike. */
export function sameClock(a: string, b: string, instant: number | Date): boolean {
  return a === b || offsetMinutes(instant, a) === offsetMinutes(instant, b);
}

/** "Perth time" for "Australia/Perth", "New York time", "UTC" for UTC-like zones. */
export function zoneLabel(zone: string): string {
  if (/^(Etc\/)?(UTC|GMT|UCT|Zulu|Universal)$/i.test(zone)) return "UTC";
  const etc = /^Etc\/GMT([+-]\d+)$/.exec(zone);
  // IANA's Etc/GMT signs are inverted: Etc/GMT-8 is UTC+8.
  if (etc) return `UTC${-Number(etc[1]) >= 0 ? "+" : ""}${-Number(etc[1])}`;
  const city = zone.split("/").pop() ?? zone;
  return `${city.replace(/_/g, " ")} time`;
}
