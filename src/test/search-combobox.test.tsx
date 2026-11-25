import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import SearchCombobox from "@/components/SearchCombobox";
import { clearPlaceSuggestionCache } from "@/hooks/use-place-suggestions";
import { PLACE_DEBOUNCE_MS } from "@/lib/search-suggestions";
import type { ChosenPlace } from "@/lib/url-state";

// Radix's popper measures with ResizeObserver, which jsdom lacks.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const venues = [
  { id: "v1", name: "Sofia Bar", address: "1 Hay St, Perth", distance_meters: 100 },
  { id: "v2", name: "Ezra Pound", address: "189 William St", distance_meters: 200 },
];

const sofia = {
  features: [
    { id: "place.1", text: "Sofia", place_name: "Sofia, Sofia City, Bulgaria", center: [23.3219, 42.6977] },
    { id: "place.2", text: "Sofia", place_name: "Sofia, Bulgaria", center: [23.5, 42.6] },
  ],
};

function Harness({ onVenue, onPlace }: { onVenue: (id: string) => void; onPlace: (p: ChosenPlace) => void }) {
  const [q, setQ] = useState("");
  return (
    <SearchCombobox
      query={q}
      onQueryChange={setQ}
      venues={venues}
      near={{ lng: 115.86, lat: -31.95 }}
      onPickVenue={(id) => {
        setQ("");
        onVenue(id);
      }}
      onPickPlace={(p) => {
        setQ("");
        onPlace(p);
      }}
    />
  );
}

describe("SearchCombobox", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let onVenue: ReturnType<typeof vi.fn>;
  let onPlace: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", RO);
    Element.prototype.scrollIntoView = () => {};
    clearPlaceSuggestionCache();
    fetchMock = vi.fn(async (url: string) => {
      const q = new URL(url, "https://x.test").searchParams.get("q") ?? "";
      const body = q.toLowerCase().startsWith("sof") ? sofia : { features: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    onVenue = vi.fn();
    onPlace = vi.fn();
    render(<Harness onVenue={onVenue} onPlace={onPlace} />);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const input = () => screen.getByRole("combobox", { name: "Search venues and places" });
  const type = (text: string) => {
    fireEvent.focus(input());
    for (let i = 1; i <= text.length; i++) fireEvent.change(input(), { target: { value: text.slice(0, i) } });
  };
  const settle = async () => {
    await act(async () => {
      vi.advanceTimersByTime(PLACE_DEBOUNCE_MS + 10);
    });
    await act(async () => {
      await Promise.resolve();
    });
  };

  it("is a labelled combobox, collapsed until there is text", () => {
    expect(input()).toHaveAttribute("aria-expanded", "false");
    expect(input()).toHaveAttribute("aria-autocomplete", "list");
    type("e");
    expect(input()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(input()).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
  });

  it("shows venues first, then places after a single debounced request", async () => {
    type("sofia");
    // Typing five letters made no request yet, and shows a loading row.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Searching places…")).toBeInTheDocument();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0][0] as string, "https://x.test");
    expect(url.searchParams.get("scope")).toBe("world");
    expect(url.searchParams.get("proximity")).toBe("115.86000,-31.95000");
    const groups = screen.getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("aria-labelledby") && document.getElementById(g.getAttribute("aria-labelledby")!)?.textContent)).toEqual([
      "Venues",
      "Places",
    ]);
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Sofia Bar1 Hay St, Perth", "SofiaSofia City, Bulgaria", "SofiaBulgaria"]);
  });

  it("never looks places up for short queries", async () => {
    type("ez");
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Ezra Pound189 William St"]);
  });

  it("says when no places match", async () => {
    type("ezra");
    await settle();
    expect(screen.getByText("No places found")).toBeInTheDocument();
  });

  it("arrow keys move aria-activedescendant; Enter picks the highlighted row", async () => {
    type("sofia");
    await settle();
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    const active = input().getAttribute("aria-activedescendant")!;
    expect(document.getElementById(active)).toHaveTextContent("SofiaSofia City, Bulgaria");
    expect(document.getElementById(active)).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onPlace).toHaveBeenCalledWith({ name: "Sofia", lng: 23.3219, lat: 42.6977 });
    expect(input()).toHaveAttribute("aria-expanded", "false");
  });

  it("Enter with nothing highlighted picks the first place, even before the lookup has run", async () => {
    type("sofia");
    fireEvent.keyDown(input(), { key: "Enter" }); // the debounce has not run out
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await settle();
    expect(onPlace).toHaveBeenCalledWith({ name: "Sofia", lng: 23.3219, lat: 42.6977 });
    expect(onVenue).not.toHaveBeenCalled();
  });

  it("clicking a venue opens it", async () => {
    type("ezra");
    await settle();
    fireEvent.click(screen.getByText("Ezra Pound"));
    expect(onVenue).toHaveBeenCalledWith("v2");
  });

  it("Escape closes the list, then clears the text", async () => {
    type("ezra");
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(input()).toHaveAttribute("aria-expanded", "false");
    expect(input()).toHaveValue("ezra");
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(input()).toHaveValue("");
  });

  it("answers a repeated query from memory, without another request", async () => {
    type("sofia");
    await settle();
    fireEvent.change(input(), { target: { value: "sofi" } });
    await settle();
    fireEvent.change(input(), { target: { value: "sofia" } });
    await settle();
    // "sofi" is new; "sofia" again is not.
    expect(fetchMock.mock.calls.map((c) => new URL(c[0] as string, "https://x.test").searchParams.get("q"))).toEqual(["sofia", "sofi"]);
  });
});
