import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Submit from "@/pages/Submit";
import { dealDraftFromPhoto, isDealComplete, isHeic } from "@/lib/photo-prefill";
import type { MenuPhotoResult } from "@/lib/api-types";

// The canvas re-encode can't run in jsdom; it's covered by the admin path.
vi.mock("@/lib/image-compress", () => ({
  compressImage: vi.fn(async () => ({
    blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }),
    mediaType: "image/jpeg",
    width: 10,
    height: 10,
  })),
  blobToBase64: vi.fn(async () => "/9j/"),
}));

class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const READ: MenuPhotoResult = {
  found: true,
  upload_id: "a".repeat(32),
  expires_in: 3600,
  venue_name: "The Crown",
  venue_address: "1 Hay St",
  deals: [
    { days_of_week: [1, 2, 3, 4, 5], start_time: "16:00", end_time: "18:00", description: "$9 pints; $5 wines" },
    { days_of_week: [], start_time: "", end_time: "", description: "$15 jugs" },
  ],
};

let photoResponse: { status: number; body: unknown };
let posts: { url: string; body: Record<string, unknown> }[];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", RO);
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:preview", revokeObjectURL: () => {} }));
  localStorage.clear();
  posts = [];
  photoResponse = { status: 200, body: READ };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") posts.push({ url, body: JSON.parse(String(init.body)) });
      if (url === "/api/menu-photo") {
        return new Response(JSON.stringify(photoResponse.body), {
          status: photoResponse.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const renderSubmit = () =>
  render(
    <MemoryRouter>
      <Submit />
    </MemoryRouter>,
  );

function pickPhoto() {
  const input = document.getElementById("snap-menu-gallery") as HTMLInputElement;
  const file = new File(["x"], "menu.jpg", { type: "image/jpeg" });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("Snap a menu on the public submit form", () => {
  it("offers camera and gallery, with the privacy note", () => {
    renderSubmit();
    const section = screen.getByRole("region", { name: "Snap a menu" });
    expect(within(section).getByRole("button", { name: /take a photo/i })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: /choose a photo/i })).toBeInTheDocument();
    expect(document.getElementById("snap-menu-camera")).toHaveAttribute("capture", "environment");
    expect(document.getElementById("snap-menu-gallery")).not.toHaveAttribute("capture");
    expect(section).toHaveTextContent("Photos are only seen by our reviewers.");
  });

  it("pre-fills the form from the read and says to check it", async () => {
    renderSubmit();
    pickPhoto();
    await screen.findByText("Check the details — we read these from your photo.");
    expect(screen.getByPlaceholderText("e.g. The Golden Tap")).toHaveValue("The Crown");
    expect(screen.getByPlaceholderText("e.g. 123 Main St")).toHaveValue("1 Hay St");
    // Deal 1 open in the editor, deal 2 collapsed below it.
    expect(screen.getByPlaceholderText(/Half-price craft beers/)).toHaveValue("$9 pints; $5 wines");
    expect(screen.getByText("$15 jugs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit 2 deals/i })).toBeInTheDocument();
    // The read request carried the honeypot and a (dev: empty) token, nothing else identifying.
    expect(posts[0]).toEqual({
      url: "/api/menu-photo",
      body: { image_base64: "/9j/", media_type: "image/jpeg", turnstile_token: "", honeypot: "" },
    });
    expect(screen.getByText("Photo attached")).toBeInTheDocument();
  });

  it("a second read replaces untouched read deals instead of duplicating them", async () => {
    renderSubmit();
    pickPhoto();
    await screen.findByText("Check the details — we read these from your photo.");
    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    pickPhoto();
    await screen.findByText("Photo attached");
    expect(screen.getByRole("button", { name: /submit 2 deals/i })).toBeInTheDocument();
  });

  it("says when no deal was found and leaves the form empty", async () => {
    photoResponse = { status: 200, body: { ...READ, found: false, upload_id: null, deals: [] } };
    renderSubmit();
    pickPhoto();
    await screen.findByText(/Couldn't find a deal in that photo/);
    expect(screen.getByPlaceholderText("e.g. The Golden Tap")).toHaveValue("");
  });

  it("explains a paused feature and keeps the form usable", async () => {
    photoResponse = { status: 429, body: { error: "photo_paused" } };
    renderSubmit();
    pickPhoto();
    await screen.findByText(/paused until tomorrow/);
    expect(screen.getByRole("button", { name: /submit deal/i })).toBeEnabled();
  });

  it("keeps a typed venue, opens an incomplete read deal instead of sending it, then submits with upload_id", async () => {
    // "Suggest an edit" link fills venue + location, so only the deals are in play.
    window.history.pushState({}, "", "/submit?venue_name=Ezra+Pound&country=AU&city=Perth&lat=-31.95&lng=115.86");
    renderSubmit();
    pickPhoto();
    await screen.findByText("Check the details — we read these from your photo.");
    // The photo's venue name doesn't overwrite one that's already there.
    expect(screen.getByPlaceholderText("e.g. The Golden Tap")).toHaveValue("Ezra Pound");

    // Deal 1 is complete; deal 2 has no days or hours.
    fireEvent.click(screen.getByRole("button", { name: /submit 2 deals/i }));
    await waitFor(() => expect(screen.getByPlaceholderText(/Half-price craft beers/)).toHaveValue("$15 jugs"));
    expect((await screen.findAllByText("Select at least one day")).length).toBeGreaterThan(0);
    expect(posts.filter((p) => p.url === "/api/submissions")).toHaveLength(0);

    // Complete it and send: the photo rides along as upload_id.
    fireEvent.click(screen.getByRole("button", { name: "Weekdays" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Deal hours" })).getAllByRole("button")[0]);
    fireEvent.click(screen.getByRole("button", { name: /submit 2 deals/i }));
    await waitFor(() => expect(posts.some((p) => p.url === "/api/submissions")).toBe(true));
    const sent = posts.find((p) => p.url === "/api/submissions")!.body;
    expect(sent).toMatchObject({
      venue_name: "Ezra Pound",
      description: "$9 pints; $5 wines",
      upload_id: "a".repeat(32),
      extra_deals: [{ description: "$15 jugs", days_of_week: [1, 2, 3, 4, 5] }],
    });
    window.history.pushState({}, "", "/");
  });
});

describe("photo-prefill helpers", () => {
  it("maps read times onto the picker", () => {
    const d = (start_time: string, end_time: string) =>
      dealDraftFromPhoto({ days_of_week: [5], start_time, end_time, description: "$9 pints" });
    expect(d("16:00", "18:00")).toMatchObject({ activePreset: "4-6", startMin: 960, endMin: 1080 });
    expect(d("00:00", "23:59")).toMatchObject({ activePreset: "all" });
    expect(d("15:00", "20:30")).toMatchObject({ activePreset: "custom", startMin: 900, endMin: 1230 });
    expect(d("22:00", "01:00")).toMatchObject({ activePreset: "custom", startMin: 1320, endMin: 1500, end_time: "01:00" });
    expect(d("10:15", "12:00")).toMatchObject({ activePreset: null, start_time: "", end_time: "" });
    expect(d("", "")).toMatchObject({ activePreset: null, start_time: "" });
    expect(d("16:00", "18:00").tags).toContain("beer");
  });

  it("knows a complete deal", () => {
    const base = dealDraftFromPhoto({ days_of_week: [1], start_time: "16:00", end_time: "18:00", description: "x" });
    expect(isDealComplete(base)).toBe(true);
    expect(isDealComplete({ ...base, days_of_week: [] })).toBe(false);
    expect(isDealComplete({ ...base, start_time: "" })).toBe(false);
  });

  it("spots HEIC by type or extension", () => {
    expect(isHeic(new File([""], "IMG_1.HEIC", { type: "" }))).toBe(true);
    expect(isHeic(new File([""], "a", { type: "image/heif" }))).toBe(true);
    expect(isHeic(new File([""], "a.jpg", { type: "image/jpeg" }))).toBe(false);
  });
});
