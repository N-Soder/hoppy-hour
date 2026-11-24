import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * App bar for secondary public pages (submit, 404): an optional back link to
 * the map and the brand. The brand is a link home, not a heading, so each
 * page's own title can be its <h1>.
 */
export default function SiteHeader({ backTo }: { backTo?: string }) {
  return (
    <header className="flex items-center gap-3 border-b border-border bg-card px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:px-6">
      {backTo && (
        <Button variant="ghost" size="icon" asChild>
          <Link to={backTo} aria-label="Back to map">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      )}
      <Link
        to="/"
        className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <img src="/favicon.ico" alt="" className="h-8 w-8" />
        <span className="text-lg font-bold tracking-tight">HoppyHour</span>
      </Link>
    </header>
  );
}
