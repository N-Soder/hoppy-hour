// Taking a new deploy without pulling the page out from under anyone.
//
// Why this exists: vite-plugin-pwa's `registerType: "autoUpdate"` makes the
// generated service worker call skipWaiting() and clients.claim(), but with no
// `virtual:pwa-register` import the plugin only injects a bare registerSW.js
// that calls navigator.serviceWorker.register(). Nothing reloads the page when
// a new worker takes over, so an open tab keeps running the old JavaScript; a
// returning visitor gets the old app shell from the cache (the new worker
// installs in the background during that visit); and an installed app resumed
// from the background never navigates, so the browser rarely even checks.
//
// main.tsx now registers through `virtual:pwa-register`, whose onNeedReload
// fires when a new worker has activated, and this controller:
//  - checks for a new worker when the tab comes back to the front, on in-app
//    navigation, and hourly while open (throttled to once a minute);
//  - once one is ready, reloads straight away if nobody is using the page
//    (tab hidden, or no tap or key since it loaded or came back); otherwise
//    on the next in-app navigation, when the tab is hidden, or when it
//    regains focus;
//  - never reloads while it isn't safe: on /submit (someone may be typing a
//    deal; the draft autosave is not relied on), while a dialog is open
//    (admin editors, confirmations), or while a text field has focus. It
//    tries again at the next of those moments.

/** Whether reloading now could lose something the person is doing. */
export function reloadBlocker(
  doc: Document,
  pathname: string,
  opts: { arrivedJustNow?: boolean } = {},
): "submit" | "dialog" | "typing" | null {
  // Arriving on /submit by an in-app link: nothing has been typed yet.
  if (!opts.arrivedJustNow && (pathname === "/submit" || pathname.startsWith("/submit/"))) return "submit";
  // Any open dialog except the home page's venue sheet, whose state is in the URL.
  if (doc.querySelector('[role="dialog"]:not([data-venue-sheet]), [role="alertdialog"]')) return "dialog";
  const a = doc.activeElement;
  if (a && a.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea, select, [contenteditable]:not([contenteditable="false"])')) {
    return "typing";
  }
  return null;
}

export interface UpdateControllerDeps {
  doc: Document;
  pathname: () => string;
  reload: () => void;
  now: () => number;
  /** Last reload this controller did, kept across the reload (sessionStorage). */
  lastReload: { get: () => number; set: (t: number) => void };
}

const CHECK_THROTTLE_MS = 60_000;
/** Never reload twice in this window, whatever the worker reports. */
const RELOAD_GUARD_MS = 30_000;

export function createUpdateController(deps: UpdateControllerDeps) {
  let registration: Pick<ServiceWorkerRegistration, "update"> | undefined;
  let updateReady = false;
  let interacted = false;
  let lastCheck = 0;

  const tryReload = (arrivedJustNow = false): boolean => {
    if (!updateReady) return false;
    if (reloadBlocker(deps.doc, deps.pathname(), { arrivedJustNow })) return false;
    const t = deps.now();
    if (t - deps.lastReload.get() < RELOAD_GUARD_MS) return false;
    deps.lastReload.set(t);
    updateReady = false;
    deps.reload();
    return true;
  };

  const checkForUpdate = () => {
    if (!registration || updateReady) return;
    const t = deps.now();
    if (t - lastCheck < CHECK_THROTTLE_MS) return;
    lastCheck = t;
    // Offline or a server error: the next trigger tries again.
    registration.update().catch(() => {});
  };

  return {
    setRegistration(r: Pick<ServiceWorkerRegistration, "update"> | undefined) {
      registration = r;
    },
    /** A new service worker has taken over: the page is running an old build. */
    onUpdateReady() {
      updateReady = true;
      if (deps.doc.visibilityState === "hidden" || !interacted) tryReload();
    },
    /** A tap, click or key press: someone is using the page right now. */
    onInteraction() {
      interacted = true;
    },
    /** The tab came back to the front or regained focus. */
    onResume() {
      interacted = false;
      if (!tryReload()) checkForUpdate();
    },
    onHidden() {
      tryReload();
    },
    /** An in-app route change (a new pathname). */
    onNavigate() {
      if (!tryReload(true)) checkForUpdate();
    },
    /** Hourly while open. */
    onTick() {
      if (deps.doc.visibilityState === "visible") checkForUpdate();
    },
    get updateReady() {
      return updateReady;
    },
  };
}

export type UpdateController = ReturnType<typeof createUpdateController>;

const LAST_RELOAD_KEY = "hh:sw-reloaded-at";

let active: UpdateController | null = null;

/** Wire the controller to this window. Call once, before registering the worker. */
export function startUpdateController(win: Window = window): UpdateController {
  const controller = createUpdateController({
    doc: win.document,
    pathname: () => win.location.pathname,
    reload: () => win.location.reload(),
    now: () => Date.now(),
    lastReload: {
      get: () => {
        try {
          return Number(win.sessionStorage.getItem(LAST_RELOAD_KEY)) || 0;
        } catch {
          return 0;
        }
      },
      set: (t) => {
        try {
          win.sessionStorage.setItem(LAST_RELOAD_KEY, String(t));
        } catch {
          // Storage blocked: the guard is a safety net only.
        }
      },
    },
  });
  const interaction = () => controller.onInteraction();
  win.addEventListener("pointerdown", interaction, { capture: true, passive: true });
  win.addEventListener("keydown", interaction, { capture: true });
  win.document.addEventListener("visibilitychange", () => {
    if (win.document.visibilityState === "visible") controller.onResume();
    else controller.onHidden();
  });
  win.addEventListener("focus", () => controller.onResume());
  win.setInterval(() => controller.onTick(), 60 * 60_000);
  active = controller;
  return controller;
}

/** Called by the router on every pathname change. No-op until started. */
export function notifyNavigation(): void {
  active?.onNavigate();
}
