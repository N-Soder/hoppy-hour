import { useEffect, useRef } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { ThemeProvider, useTheme } from "next-themes";
import Index from "./pages/Index";
import Submit from "./pages/Submit";
import Admin from "./pages/Admin";
import NotFound from "./pages/NotFound";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { applyThemeColor, type ThemeChoice } from "./lib/theme-color";
import { notifyNavigation } from "./lib/sw-update";

const queryClient = new QueryClient();

/** Keep the browser-chrome color (mobile status bar / PWA titlebar) in sync
    with the theme chosen in the app. See lib/theme-color. */
function ThemeColorSync() {
  const { theme, resolvedTheme } = useTheme();
  useEffect(() => {
    // Also on resolvedTheme: a system change while "system" is chosen
    // re-inserts the metas, so the browser looks at them again.
    applyThemeColor(theme as ThemeChoice);
  }, [theme, resolvedTheme]);
  // Safari on iOS 26 ignores theme-color and tints the status bar from a
  // fixed element at the top edge, sampled when such an element appears. This
  // strip, in the header colour, is re-created on every theme change so the
  // tint is sampled again rather than kept from before the switch.
  return (
    <div
      key={resolvedTheme ?? "unknown"}
      aria-hidden="true"
      data-status-bar-tint=""
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] hidden bg-card coarse:block"
      style={{ height: "max(1px, env(safe-area-inset-top))" }}
    />
  );
}

/** Tell the service-worker updater about in-app page changes (not filter or
    venue changes on the home page, which only touch the query string): a
    waiting deploy is taken at the next one. See lib/sw-update. */
function NavigationReporter() {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    notifyNavigation();
  }, [pathname]);
  return null;
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <ThemeColorSync />
        <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <NavigationReporter />
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/submit" element={<Submit />} />
            {/* /admin is gated at the edge by Cloudflare Access — no in-app login route. */}
            <Route path="/admin" element={<Admin />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
