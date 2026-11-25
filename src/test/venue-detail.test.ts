import { createElement, type ComponentProps } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import VenueDetail from "@/components/VenueDetail";
import type { HappyHour, VenueWithHappyHours } from "@/lib/api-types";
import type { SelectionLabel } from "@/lib/format";

function hh(id: string, days: number[], start: string, end: string, description = id): HappyHour {
  return { id, venue_id: "v", days_of_week: days, start_time: start, end_time: end, description, tags: null, is_active: true };
}

const venue: VenueWithHappyHours = {
  id: "v",
  name: "Test Bar",
  address: "1 Main St, Perth WA 6000",
  country: "AU",
  lat: -31.95,
  lng: 115.86,
  distance_meters: 300,
  happy_hours: [
    // Stored one row per day, as the data is: the detail merges them back.
    ...[1, 2, 3, 4, 5].map((d) => hh(`pints-${d}`, [d], "16:00:00", "18:00:00", "$8 pints")),
    hh("late-tue", [2], "21:00:00", "23:59:00", "Cocktail hour"),
    hh("weekend", [6, 0], "12:00:00", "15:00:00", "Bottomless brunch"),
  ],
};

const selection: SelectionLabel = { isNow: true, badge: "Live", phrase: "now" };

// Built with createElement rather than JSX so the test doesn't depend on how
// the test runner is configured to transform JSX.
function renderDetail(
  selectedDay: number,
  selectedIsToday: boolean,
  overrides: Partial<ComponentProps<typeof VenueDetail>> = {},
) {
  const props: ComponentProps<typeof VenueDetail> = {
    venue,
    status: { isLive: false, liveCount: 0, nextLabel: null, dealCount: 3 },
    selection,
    filteredHappyHourIds: new Set(),
    selectedDay,
    selectedIsToday,
    headingId: "t",
    ...overrides,
  };
  render(createElement(MemoryRouter, null, createElement(VenueDetail, props)));
}

function section(name: string) {
  return screen.getByRole("heading", { level: 3, name }).closest("section") as HTMLElement;
}

describe("VenueDetail deals", () => {
  it("lists today's deals by start time with their days, then the other days' deals", () => {
    renderDetail(2, true); // Tuesday
    const today = section("Today");
    const items = within(today).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([
      expect.stringContaining("4–6 pm"),
      expect.stringContaining("9 pm–late"),
    ]);
    expect(items[0]).toContain("Mon–Fri");
    expect(items[1]).toContain("Tue only");

    // A deal shown under Today is not printed again below.
    const other = section("Other days");
    expect(within(other).queryByText("$8 pints")).toBeNull();
    expect(within(other).getByText("Sat, Sun")).toBeInTheDocument();
    expect(within(other).getByText("Bottomless brunch")).toBeInTheDocument();
  });

  it("names the selected day when it isn't today", () => {
    renderDetail(6, false); // Saturday
    expect(within(section("Saturday")).getByText("Bottomless brunch")).toBeInTheDocument();
  });

  it("reads a 23:59 end as late in the day groups too", () => {
    renderDetail(4, true); // Thursday: the Tuesday-only deal is under Other days
    const other = section("Other days");
    expect(within(other).getByText("Tue")).toBeInTheDocument();
    expect(within(other).getByText("9 pm–late")).toBeInTheDocument();
  });
});

describe("VenueDetail with no deal on the day", () => {
  it("says so under Today", () => {
    renderDetail(2, true, {
      venue: { ...venue, happy_hours: [hh("w", [3], "17:00", "19:00")] },
      status: { isLive: false, liveCount: 0, nextLabel: null, dealCount: 1 },
    });
    expect(within(section("Today")).getByText("No deals today")).toBeInTheDocument();
    expect(within(section("Other days")).getByText("Wed")).toBeInTheDocument();
  });
});

describe("VenueDetail deal text", () => {
  it("lists each '; ' offer on its own line with its price, the title above, and tags as text", () => {
    const deal = {
      ...hh("d", [3], "17:30", "19:00", "Wine Wednesday: $9.00 pints of Great Northern; $5.00 glasses of red; Free snacks"),
      tags: ["beer", "wine"],
    };
    renderDetail(2, true, {
      venue: { ...venue, happy_hours: [deal] },
      status: { isLive: false, liveCount: 0, nextLabel: null, dealCount: 1 },
    });
    const other = section("Other days");
    expect(within(other).getByRole("heading", { level: 4, name: "Wed" })).toBeInTheDocument();
    expect(within(other).getByText("5:30–7 pm")).toBeInTheDocument();
    expect(within(other).getByText("Wine Wednesday")).toBeInTheDocument();
    const offers = within(other)
      .getAllByRole("list")
      .find((ul) => ul.querySelector(":scope > li > span"))!;
    expect(within(offers).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "$9 pints of Great Northern",
      "$5 glasses of red",
      "Free snacks",
    ]);
    expect(within(other).getByText("Beer · Wine")).toBeInTheDocument();
  });

  it("keeps a comma-separated description on one line", () => {
    renderDetail(2, true, {
      venue: { ...venue, happy_hours: [hh("d", [3], "17:00", "19:00", "$8 beer and wine, $15 select cocktails")] },
      status: { isLive: false, liveCount: 0, nextLabel: null, dealCount: 1 },
    });
    expect(within(section("Other days")).getByText("beer and wine, $15 select cocktails")).toBeInTheDocument();
  });
});
