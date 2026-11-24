import { describe, it, expect, vi, beforeEach } from "vitest";
import { createUpdateController, reloadBlocker } from "@/lib/sw-update";

function setup(opts: { path?: string; hidden?: boolean } = {}) {
  const doc = document.implementation.createHTMLDocument("t");
  let hidden = opts.hidden ?? false;
  Object.defineProperty(doc, "visibilityState", { get: () => (hidden ? "hidden" : "visible") });
  let path = opts.path ?? "/";
  let t = 1_000_000;
  let last = 0;
  const reload = vi.fn();
  const update = vi.fn(async () => undefined as unknown as ServiceWorkerRegistration);
  const c = createUpdateController({
    doc,
    pathname: () => path,
    reload,
    now: () => t,
    lastReload: { get: () => last, set: (v) => (last = v) },
  });
  c.setRegistration({ update } as unknown as ServiceWorkerRegistration);
  return {
    c,
    doc,
    reload,
    update,
    setPath: (p: string) => (path = p),
    setHidden: (h: boolean) => (hidden = h),
    advance: (ms: number) => (t += ms),
  };
}

describe("reloadBlocker", () => {
  let doc: Document;
  beforeEach(() => {
    doc = document.implementation.createHTMLDocument("t");
  });

  it("allows a reload on a quiet page", () => {
    expect(reloadBlocker(doc, "/")).toBeNull();
  });

  it("blocks on /submit, unless the person has only just arrived there", () => {
    expect(reloadBlocker(doc, "/submit")).toBe("submit");
    expect(reloadBlocker(doc, "/submit", { arrivedJustNow: true })).toBeNull();
  });

  it("blocks while a dialog is open, but not for the venue sheet", () => {
    doc.body.innerHTML = '<div role="dialog" data-venue-sheet=""></div>';
    expect(reloadBlocker(doc, "/")).toBeNull();
    doc.body.innerHTML = '<div role="dialog"></div>';
    expect(reloadBlocker(doc, "/admin")).toBe("dialog");
    doc.body.innerHTML = '<div role="alertdialog"></div>';
    expect(reloadBlocker(doc, "/admin")).toBe("dialog");
  });

  it("blocks while a text field has focus", () => {
    // Focus needs the window's own document.
    document.body.innerHTML = '<input id="q" type="text"><input id="c" type="checkbox">';
    document.getElementById("q")!.focus();
    expect(reloadBlocker(document, "/")).toBe("typing");
    document.getElementById("c")!.focus();
    expect(reloadBlocker(document, "/")).toBeNull();
    document.body.innerHTML = "";
  });
});

describe("update controller", () => {
  it("reloads at once when a returning visitor hasn't touched the page yet", () => {
    const s = setup();
    s.c.onUpdateReady();
    expect(s.reload).toHaveBeenCalledTimes(1);
  });

  it("waits for the next navigation when the page is in use", () => {
    const s = setup();
    s.c.onInteraction();
    s.c.onUpdateReady();
    expect(s.reload).not.toHaveBeenCalled();
    s.c.onNavigate();
    expect(s.reload).toHaveBeenCalledTimes(1);
  });

  it("takes the update when the tab regains focus", () => {
    const s = setup();
    s.c.onInteraction();
    s.c.onUpdateReady();
    s.c.onResume();
    expect(s.reload).toHaveBeenCalledTimes(1);
  });

  it("reloads a hidden tab straight away", () => {
    const s = setup({ hidden: true });
    s.c.onInteraction();
    s.c.onUpdateReady();
    expect(s.reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads under someone filling in /submit, and takes it when they leave", () => {
    const s = setup({ path: "/submit" });
    s.c.onUpdateReady();
    s.c.onResume();
    s.setHidden(true);
    s.c.onHidden();
    expect(s.reload).not.toHaveBeenCalled();
    s.setHidden(false);
    s.setPath("/");
    s.c.onNavigate();
    expect(s.reload).toHaveBeenCalledTimes(1);
  });

  it("defers while an admin dialog is open", () => {
    const s = setup({ path: "/admin" });
    s.doc.body.innerHTML = '<div role="dialog"></div>';
    s.c.onUpdateReady();
    s.c.onResume();
    expect(s.reload).not.toHaveBeenCalled();
    s.doc.body.innerHTML = "";
    s.c.onResume();
    expect(s.reload).toHaveBeenCalledTimes(1);
  });

  it("does nothing before an update is ready, but checks for one (throttled)", () => {
    const s = setup();
    s.c.onResume();
    s.c.onNavigate();
    expect(s.reload).not.toHaveBeenCalled();
    expect(s.update).toHaveBeenCalledTimes(1);
    s.advance(61_000);
    s.c.onNavigate();
    expect(s.update).toHaveBeenCalledTimes(2);
  });

  it("never reloads twice in quick succession", () => {
    const s = setup();
    s.c.onUpdateReady();
    s.c.onUpdateReady();
    expect(s.reload).toHaveBeenCalledTimes(1);
  });
});
