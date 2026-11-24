import "./lib/zod-config";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import { startUpdateController } from "./lib/sw-update";
import "./index.css";

// The service worker, registered here rather than by the plugin's injected
// script so a new deploy can take over the open page (see lib/sw-update).
if ("serviceWorker" in navigator) {
  const updates = startUpdateController();
  registerSW({
    onNeedReload: () => updates.onUpdateReady(),
    onRegisteredSW: (_url, registration) => updates.setRegistration(registration),
  });
}

createRoot(document.getElementById("root")!).render(<App />);
