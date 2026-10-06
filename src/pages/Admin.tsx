import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, isAuthError } from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, LogOut } from "lucide-react";
import SubmissionQueue from "@/components/admin/SubmissionQueue";
import VenueManager from "@/components/admin/VenueManager";
import PhotoSubmit from "@/components/admin/PhotoSubmit";

// Cloudflare Access gates /admin and /api/admin/* at the edge, so reaching this
// page means you're authenticated. The probe below confirms admin state to the
// SPA and detects a session that expired mid-use.
export default function Admin() {
  const [tab, setTab] = useState("submissions");
  const { data: me, isLoading, isError, error } = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => api.get<{ email: string }>("/api/admin/me"),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Skeleton className="h-12 w-48" />
      </div>
    );
  }

  if (isError) {
    const expired = isAuthError(error);
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-lg border border-border bg-card p-6 text-center space-y-3">
          <h2 className="text-lg font-bold tracking-tight">
            {expired ? "Your admin session has expired" : "Couldn't reach the admin API"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {expired
              ? "Reload the page to sign in again through Cloudflare Access."
              : "This is usually a network hiccup — try reloading."}
          </p>
          <div className="flex gap-2 justify-center">
            <Button onClick={() => window.location.reload()}>Reload</Button>
            <Button variant="outline" asChild>
              <Link to="/">Back to Map</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex items-center gap-2">
            <img src="/favicon.ico" alt="HoppyHour" className="h-8 w-8" />
            <h1 className="text-lg font-bold tracking-tight">Admin Panel</h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground hidden sm:block">{me?.email}</span>
          {/* Cloudflare Access hosts sign-out; this path is served on-domain when Access is enabled. */}
          <Button variant="outline" size="sm" asChild className="gap-1.5">
            <a href="/cdn-cgi/access/logout">
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </a>
          </Button>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6 max-w-6xl mx-auto w-full">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="submissions">Submissions</TabsTrigger>
            <TabsTrigger value="snap">Snap a Deal</TabsTrigger>
            <TabsTrigger value="venues">Venues</TabsTrigger>
          </TabsList>
          <TabsContent value="submissions">
            <SubmissionQueue />
          </TabsContent>
          <TabsContent value="snap">
            <PhotoSubmit onReview={() => setTab("submissions")} />
          </TabsContent>
          <TabsContent value="venues">
            <VenueManager />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
