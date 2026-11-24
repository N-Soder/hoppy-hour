import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { MapPinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import SiteHeader from "@/components/SiteHeader";
import { useDocumentTitle, useNoIndex } from "@/hooks/use-document-title";

const NotFound = () => {
  const location = useLocation();
  useDocumentTitle("Page not found");
  // Every path is answered with the app shell (status 200), so tell crawlers
  // this one isn't a page.
  useNoIndex();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-sm space-y-3 text-center">
          <MapPinOff className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
          <p className="text-sm text-muted-foreground">
            There's nothing at this address. The deals are all on the map.
          </p>
          <Button asChild className="mt-2">
            <Link to="/">Back to the map</Link>
          </Button>
        </div>
      </main>
    </div>
  );
};

export default NotFound;
