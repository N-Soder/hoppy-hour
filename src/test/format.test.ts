import { describe, it, expect } from "vitest";
import { formatDistance, formatTime } from "@/lib/format";

describe("formatTime", () => {
  it("formats an afternoon time as PM", () => {
    expect(formatTime("17:00:00")).toBe("5:00 PM");
  });

  it("maps hour 0 to 12 AM", () => {
    expect(formatTime("00:30:00")).toBe("12:30 AM");
  });

  it("keeps noon as 12 PM", () => {
    expect(formatTime("12:00:00")).toBe("12:00 PM");
  });

  it("keeps half past noon as 12:30 PM", () => {
    expect(formatTime("12:30:00")).toBe("12:30 PM");
  });

  it("drops the leading zero from morning hours", () => {
    expect(formatTime("09:05:00")).toBe("9:05 AM");
  });

  it("accepts the HH:MM form produced by the admin UI", () => {
    expect(formatTime("17:00")).toBe("5:00 PM");
  });
});

describe("formatDistance", () => {
  it("shows metres under 1km", () => {
    expect(formatDistance(950)).toBe("950m");
  });

  it("rounds fractional metres", () => {
    expect(formatDistance(999.4)).toBe("999m");
  });

  it("switches to km at exactly 1000m", () => {
    expect(formatDistance(1000)).toBe("1.0km");
  });

  it("rounds 1250m up to 1.3km (toFixed half-up)", () => {
    expect(formatDistance(1250)).toBe("1.3km");
  });

  it("keeps one decimal for long distances", () => {
    expect(formatDistance(12345)).toBe("12.3km");
  });
});
