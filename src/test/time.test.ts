import { describe, it, expect } from "vitest";
import { roundTo15 } from "@/lib/time";

describe("roundTo15", () => {
  it("rounds down when closer to the previous quarter hour", () => {
    expect(roundTo15(new Date(2026, 6, 12, 10, 7))).toBe("10:00");
  });

  it("rounds up when closer to the next quarter hour", () => {
    expect(roundTo15(new Date(2026, 6, 12, 10, 8))).toBe("10:15");
  });

  it("rounds down to 23:45 just before the clamp window", () => {
    expect(roundTo15(new Date(2026, 6, 12, 23, 52))).toBe("23:45");
  });

  it("clamps 23:53 to 23:59 instead of wrapping to 00:00 (Fix B4)", () => {
    expect(roundTo15(new Date(2026, 6, 12, 23, 53))).toBe("23:59");
  });

  it("clamps 23:59 to 23:59 instead of wrapping to 00:00 (Fix B4)", () => {
    expect(roundTo15(new Date(2026, 6, 12, 23, 59))).toBe("23:59");
  });

  it("rounds just after midnight down to 00:00", () => {
    expect(roundTo15(new Date(2026, 6, 12, 0, 2))).toBe("00:00");
  });
});
