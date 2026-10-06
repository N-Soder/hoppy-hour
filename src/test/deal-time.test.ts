import { describe, it, expect } from "vitest";
import {
  formatMinutes,
  minutesToClock,
  bumpedEnd,
  TIME_OPTIONS,
  DEAL_MIN,
  DEAL_MAX,
  DEAL_PRESETS,
} from "@/lib/deal-time";

describe("formatMinutes", () => {
  it("formats afternoon times", () => {
    expect(formatMinutes(960)).toBe("4:00 PM");
    expect(formatMinutes(1020)).toBe("5:00 PM");
  });

  it("formats noon and midnight boundaries", () => {
    expect(formatMinutes(660)).toBe("11:00 AM");
    expect(formatMinutes(720)).toBe("12:00 PM");
    expect(formatMinutes(1440)).toBe("12:00 AM"); // past-midnight wrap
  });

  it("formats past-midnight values (continue past 1440)", () => {
    expect(formatMinutes(1500)).toBe("1:00 AM");
    expect(formatMinutes(1560)).toBe("2:00 AM");
  });
});

describe("minutesToClock", () => {
  it("keeps same-day times as HH:MM", () => {
    expect(minutesToClock(660)).toBe("11:00");
    expect(minutesToClock(1020)).toBe("17:00");
    expect(minutesToClock(1380)).toBe("23:00");
  });

  it("wraps past-midnight values back to clock time", () => {
    expect(minutesToClock(1440)).toBe("00:00");
    expect(minutesToClock(1500)).toBe("01:00");
    expect(minutesToClock(1560)).toBe("02:00");
  });

  it("stores a 10 PM–1 AM deal as start > end (midnight-crossing convention)", () => {
    const start = minutesToClock(1320); // 10 PM
    const end = minutesToClock(1500); // 1 AM
    expect(start).toBe("22:00");
    expect(end).toBe("01:00");
    expect(start > end).toBe(true);
  });
});

describe("bumpedEnd", () => {
  it("leaves a valid range untouched", () => {
    expect(bumpedEnd(960, 1080)).toBe(1080);
  });

  it("bumps end to start + 60 when end <= start", () => {
    expect(bumpedEnd(1080, 1080)).toBe(1140);
    expect(bumpedEnd(1080, 960)).toBe(1140);
  });

  it("caps the bump at the 2 AM maximum", () => {
    expect(bumpedEnd(DEAL_MAX, DEAL_MAX)).toBe(DEAL_MAX);
    expect(bumpedEnd(1560, 1500)).toBe(1560);
  });
});

describe("TIME_OPTIONS", () => {
  it("runs 11 AM to 2 AM in 30-minute steps", () => {
    expect(TIME_OPTIONS[0]).toEqual({ value: DEAL_MIN, label: "11:00 AM" });
    expect(TIME_OPTIONS[TIME_OPTIONS.length - 1]).toEqual({ value: DEAL_MAX, label: "2:00 AM" });
    expect(TIME_OPTIONS).toHaveLength((DEAL_MAX - DEAL_MIN) / 30 + 1);
  });
});

describe("DEAL_PRESETS", () => {
  it("matches the spec's six chips in order", () => {
    expect(DEAL_PRESETS.map((p) => p.label)).toEqual([
      "4–6 PM",
      "4–7 PM",
      "5–6 PM",
      "5–7 PM",
      "All day",
      "Custom",
    ]);
  });

  it("carries the spec's preset minute values", () => {
    const all = DEAL_PRESETS.find((p) => p.key === "all")!;
    expect([all.start, all.end]).toEqual([660, 1380]);
    const custom = DEAL_PRESETS.find((p) => p.key === "custom")!;
    expect([custom.start, custom.end]).toEqual([null, null]);
  });
});
