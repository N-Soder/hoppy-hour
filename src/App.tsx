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
  const { theme } = useTheme();
  useEffect(() => {
    applyThemeColor(theme as ThemeChoice);
  }, [theme]);
  return null;
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
