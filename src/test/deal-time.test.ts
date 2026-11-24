import { describe, it, expect } from "vitest";
import {
  minutesToClock,
  bumpedEnd,
  TIME_OPTIONS,
  DEAL_MIN,
  DEAL_MAX,
  DEAL_PRESETS,
} from "@/lib/deal-time";

describe("picker labels use the shared clock format", () => {
  it("labels past-midnight picker values", () => {
    expect(TIME_OPTIONS.find((o) => o.value === 1440)?.label).toBe("12 am");
    expect(TIME_OPTIONS.find((o) => o.value === 1530)?.label).toBe("1:30 am");
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
    expect(TIME_OPTIONS[0]).toEqual({ value: DEAL_MIN, label: "11 am" });
    expect(TIME_OPTIONS[TIME_OPTIONS.length - 1]).toEqual({ value: DEAL_MAX, label: "2 am" });
    expect(TIME_OPTIONS).toHaveLength((DEAL_MAX - DEAL_MIN) / 30 + 1);
  });
});

describe("DEAL_PRESETS", () => {
  it("matches the spec's six chips in order", () => {
    expect(DEAL_PRESETS.map((p) => p.label)).toEqual([
      "4–6 pm",
      "4–7 pm",
      "5–6 pm",
      "5–7 pm",
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
