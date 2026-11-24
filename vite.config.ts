import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    // Proxy /api to `wrangler pages dev` (functions + local D1) during dev, so
    // the Vite HMR server and the real API run together. Start wrangler with:
    //   npx wrangler pages dev dist --port 8788
    proxy: {
      "/api": "http://localhost:8788",
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        id: "/",
        name: "HoppyHour",
        short_name: "HoppyHour",
        description: "Find happy hour deals near you.",
        lang: "en",
        categories: ["food", "lifestyle", "travel"],
        // Light-theme surfaces: theme_color is the app header (--card),
        // background_color the page (--background), so the title bar and the
        // splash match the app. The page's theme-color metas (index.html,
        // src/lib/theme-color.ts) take over for dark mode once it loads.
        theme_color: "#ffffff",
        background_color: "#F8F4EC",
        display: "standalone",
        scope: "/",
        start_url: "/",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          // Full-bleed, glyph inside the central safe zone (scripts/gen-icons.mjs).
          { src: "/pwa-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          {
            name: "Submit a deal",
            short_name: "Submit",
            description: "Tell us about a happy hour deal",
            url: "/submit",
            icons: [{ src: "/pwa-192.png", sizes: "192x192", type: "image/png" }],
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // 3 MiB — main bundle is ~2.5 MiB
        // Navigations the service worker must NOT answer with the cached app
        // shell: Cloudflare Access's own endpoints (login callback, logout),
        // /admin (so the edge can check the Access session before the page
        // loads), and /api.
        navigateFallbackDenylist: [/^\/cdn-cgi\//, /^\/admin(\/|$)/, /^\/api\//],
        runtimeCaching: [
          {
            // Venue data and the map token: serve cached while fetching fresh.
            // Nothing else under /api (admin data, geocoding queries) is
            // stored on the device.
            urlPattern: ({ url }) =>
              url.pathname === "/api/venues" || url.pathname === "/api/mapbox-token",
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              expiration: { maxEntries: 50, maxAgeSeconds: 3600 },
              networkTimeoutSeconds: 10,
            },
          },
          {
            // Mapbox tiles: network only — offline map handled in UI
            urlPattern: /^https:\/\/.*\.mapbox\.com\/.*/i,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
