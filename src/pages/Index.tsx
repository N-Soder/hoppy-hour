import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMapboxToken } from "@/hooks/use-mapbox-token";
import { useGeolocation } from "@/hooks/use-geolocation";
import { useVenuesWithinRadius, filterByDayAndTime, filterByTags, type VenueWithHappyHours } from "@/hooks/use-venues";
import { useOnlineStatus } from "@/hooks/use-online-status";
import MapView from "@/components/MapView";
import { MapMessage } from "@/components/MapMessage";
import FiltersPanel from "@/components/FiltersPanel";
import VenueList, { VenueListEmpty, VenueListError, VenueListSkeleton } from "@/components/VenueList";
import VenueDetailModal from "@/components/VenueDetailModal";
import VenueBottomSheet from "@/components/VenueBottomSheet";
import { Button } from "@/components/ui/button";
import { RefreshCw, Plus, LocateOff, ChevronDown, Loader2 } from "lucide-react";
import OptionsMenu from "@/components/OptionsMenu";
import { Link } from "react-router-dom";
import { DEFAULT_LOCATION_NAME } from "@/lib/constants";
import { roundTo15 } from "@/lib/time";
import { describeSelection, plural } from "@/lib/format";
import { geoBanner, hasRealLocation, isLocating } from "@/lib/geo-status";
import { describeEmptyState, selectListState } from "@/lib/list-state";
import { DEFAULT_RADIUS, MAX_RADIUS, RADIUS_OPTIONS, formatDistanceRadius } from "@/lib/radius";
import { cn } from "@/lib/utils";

// Height of the collapsed header strip on phones: a full 44px tap target.
const MINI_STRIP_HEIGHT = 44;

export default function Index() {
  const isMobile = useIsMobile();
  const [mobileView, setMobileView] = useState<"list" | "map">("list");
  const {
    lng,
    lat,
    status: geoStatus,
    userInitiated: geoUserInitiated,
    requestLocation,
  } = useGeolocation();
  const tokenQuery = useMapboxToken();
  const token = tokenQuery.data;
  const isOnline = useOnlineStatus();

  // Filter state
  const [date, setDate] = useState(new Date());
  const [time, setTime] = useState(roundTo15(new Date()));
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  // Wall clock, refreshed every minute, so "Live" stays honest over time.
  const [now, setNow] = useState(() => new Date());
  // Fix #5: track whether the user has manually set the time (stops auto-advance)
  const isTimeManual = useRef(false);
  // Fix B5: track whether the user has manually picked a date (stops auto-rollover)
  const isDateManual = useRef(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [detailVenueId, setDetailVenueId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Map center for "search this area"
  const [mapCenter, setMapCenter] = useState<{
    lng: number;
    lat: number;
  } | null>(null);
  const [searchCenter, setSearchCenter] = useState<{
    lng: number;
    lat: number;
  } | null>(null);
  const queryLng = searchCenter?.lng ?? lng;
  const queryLat = searchCenter?.lat ?? lat;
  const venuesQuery = useVenuesWithinRadius(queryLng, queryLat, radius);
  const { isFetching: venuesFetching } = venuesQuery;
  const venues = useMemo(() => venuesQuery.data ?? [], [venuesQuery.data]);
  // Happy hours now arrive embedded on each venue (one /api/venues round trip);
  // flatten them for the day/time/tag filters below.
  const happyHours = useMemo(() => venues.flatMap((v) => v.happy_hours), [venues]);

  // Apply filters
  const dayOfWeek = date.getDay();
  const timeStr = time + ":00";
  const filteredHH = useMemo(() => {
    let hh = filterByDayAndTime(happyHours, dayOfWeek, timeStr);
    hh = filterByTags(hh, selectedTags);
    return hh;
  }, [happyHours, dayOfWeek, timeStr, selectedTags]);
  const filteredHHIds = useMemo(() => new Set(filteredHH.map((h) => h.id)), [filteredHH]);
  const liveVenueIds = useMemo(() => {
    const ids = new Set<string>();
    filteredHH.forEach((hh) => ids.add(hh.venue_id));
    return ids;
  }, [filteredHH]);
  const liveVenueCounts = useMemo(() => {
    const counts = new Map<string, number>();
    filteredHH.forEach((hh) => {
      counts.set(hh.venue_id, (counts.get(hh.venue_id) ?? 0) + 1);
    });
    return counts;
  }, [filteredHH]);

  // Venues already carry their happy_hours; just apply the name/address search
  // filter and sort (live venues first, then by distance).
  const allVenuesWithHH: VenueWithHappyHours[] = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return venues
      .filter((v) => !q || v.name.toLowerCase().includes(q) || v.address.toLowerCase().includes(q))
      .sort((a, b) => {
        const aLive = liveVenueIds.has(a.id) ? 0 : 1;
        const bLive = liveVenueIds.has(b.id) ? 0 : 1;
        if (aLive !== bLive) return aLive - bLive;
        return a.distance_meters - b.distance_meters;
      });
  }, [venues, liveVenueIds, searchQuery]);
  const handleSelectVenue = useCallback((id: string | null) => {
    setSelectedVenueId(id);
  }, []);
  const handleOpenDetail = useCallback((id: string) => {
    setSelectedVenueId(id);
    setDetailVenueId(id);
  }, []);
  const handleLocationSearch = useCallback((coords: {
    lng: number;
    lat: number;
  }) => {
    setSearchCenter(coords);
  }, []);
  const handleRecenter = useCallback(() => {
    setSearchCenter(null);
  }, []);
  const detailVenue = allVenuesWithHH.find((v) => v.id === detailVenueId) ?? null;
  const selectedVenue = allVenuesWithHH.find((v) => v.id === selectedVenueId) ?? null;
  const showSearchArea = mapCenter && (Math.abs(mapCenter.lng - (queryLng ?? 0)) > 0.005 || Math.abs(mapCenter.lat - (queryLat ?? 0)) > 0.005);
  const handleSearchArea = () => {
    if (mapCenter) setSearchCenter(mapCenter);
  };
  // What the date/time filter means relative to now: "Live" only when it is now.
  const selection = useMemo(() => describeSelection(date, time, now), [date, time, now]);

  const resetToNow = useCallback(() => {
    isDateManual.current = false;
    isTimeManual.current = false;
    const d = new Date();
    setNow(d);
    setDate(d);
    setTime(roundTo15(d));
  }, []);

  const clearFilters = useCallback(() => {
    setSearchQuery("");
    setSelectedTags([]);
    resetToNow();
  }, [resetToNow]);

  // Venue list: loading (including while the location is still unknown and
  // the query is disabled), error with retry, empty naming the filters, or the
  // list itself.
  const locating = isLocating(geoStatus, queryLat !== null);
  const listState = selectListState({
    locating,
    pending: venuesQuery.isPending,
    isError: venuesQuery.isError,
    hasData: venuesQuery.data !== undefined,
    visibleCount: allVenuesWithHH.length,
  });
  const emptyCopy = describeEmptyState({
    searchQuery,
    tags: selectedTags,
    whenPhrase: selection.isNow ? null : selection.phrase,
    radiusMeters: radius,
    venuesInRadius: venues.length,
  });
  const nextRadius = RADIUS_OPTIONS.find((r) => r > radius);
  const radiusIsTheCause = venues.length === 0 && radius < MAX_RADIUS && nextRadius !== undefined;
  const countLine = `${plural(allVenuesWithHH.length, "venue")} · ${plural(filteredHH.length, "deal")} on ${selection.phrase}`;

  const banner =
    geoStatus === "requesting" && geoUserInitiated
      ? { message: "Finding your location…", action: null }
      : geoBanner(geoStatus, DEFAULT_LOCATION_NAME, geoUserInitiated);
  const realLocation = hasRealLocation(geoStatus);

  // --- Mobile scroll-linked header hide ---
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const [collapsibleHeight, setCollapsibleHeight] = useState(0);
  const [headerOffset, setHeaderOffset] = useState(0);
  const lastScrollTopRef = useRef(0);
  const isAnimatingRef = useRef(false);

  useLayoutEffect(() => {
    if (!collapsibleRef.current || !isMobile) return;
    // Measure immediately to avoid layout flash on first render
    setCollapsibleHeight(collapsibleRef.current.offsetHeight);
    const ro = new ResizeObserver(() => {
      if (collapsibleRef.current) {
        setCollapsibleHeight(collapsibleRef.current.offsetHeight);
      }
    });
    ro.observe(collapsibleRef.current);
    return () => ro.disconnect();
  }, [isMobile]);

  // Reset when switching away from mobile
  useEffect(() => {
    if (!isMobile) setHeaderOffset(0);
  }, [isMobile]);

  // Restore header when switching back to list view
  useEffect(() => {
    if (mobileView === "list") {
      isAnimatingRef.current = true;
      setHeaderOffset(0);
    }
  }, [mobileView]);

  // Fix #5: auto-advance time every 60s when the user hasn't manually changed it
  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date());
      if (!isTimeManual.current) {
        setTime(roundTo15(new Date()));
      }
      // Fix B5: roll `date` forward across midnight so we don't keep filtering
      // with yesterday's weekday. Setting a new date triggers the dateString
      // effect below, which re-syncs the time and resets isTimeManual — that
      // cascade is intended. `date` is in the deps so the check never reads a
      // stale closure; restarting the interval on a date change is harmless.
      if (!isDateManual.current && date.toDateString() !== new Date().toDateString()) {
        setDate(new Date());
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [date]);

  // Fix #5: when the date rolls over to a new day, reset manual flag so time re-syncs.
  // Use the date string as a stable primitive dependency to avoid the complex-expression warning.
  const dateString = date.toDateString();
  useEffect(() => {
    isTimeManual.current = false;
    setTime(roundTo15(new Date()));
  }, [dateString]);

  const handleListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (!isMobile || collapsibleHeight === 0) return;
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const delta = scrollTop - lastScrollTopRef.current;
    lastScrollTopRef.current = scrollTop;
    // Skip at the bottom boundary — Android overscroll fires scroll events here
    // that would otherwise create a feedback loop with the header resize.
    if (scrollTop + clientHeight >= scrollHeight - 2) return;
    isAnimatingRef.current = false;
    setHeaderOffset((prev) => Math.max(0, Math.min(prev + delta * 2, collapsibleHeight)));
  }, [isMobile, collapsibleHeight]);

  const expandHeader = useCallback(() => {
    isAnimatingRef.current = true;
    setHeaderOffset(0);
  }, []);

  const collapseHeader = useCallback(() => {
    isAnimatingRef.current = true;
    setHeaderOffset(collapsibleHeight);
  }, [collapsibleHeight]);

  const dynamicPaddingTop = isMobile
    ? Math.max(MINI_STRIP_HEIGHT, collapsibleHeight - headerOffset)
    : 0;

  const collapsibleStyle: React.CSSProperties = isMobile ? {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 40,
    transform: `translateY(-${headerOffset}px)`,
    transition: isAnimatingRef.current ? "transform 0.25s ease" : "none",
    willChange: "transform",
  } : {};

  return <div className="flex flex-col h-dvh" style={{ paddingTop: dynamicPaddingTop }}>
      {/* Mini strip — always-visible tap target when header is collapsed (mobile only) */}
      {isMobile && headerOffset > 10 && (
        <button
          type="button"
          className="fixed top-0 left-0 right-0 z-50 h-11 bg-card border-b border-border flex items-center justify-center gap-1.5 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={expandHeader}
          aria-label="Show search and filters"
          aria-expanded={false}
        >
          <img src="/favicon.ico" alt="" className="h-4 w-4" />
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </button>
      )}

      {/* Collapsible header + filters (fixed on mobile, static on desktop) */}
      <div
        ref={collapsibleRef}
        style={collapsibleStyle}
        className="bg-background"
        onTransitionEnd={() => { isAnimatingRef.current = false; }}
      >
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
          <div className="flex items-center gap-2">
            <img src="/favicon.ico" alt="" className="h-8 w-8" />
            <h1 className="text-lg font-bold tracking-tight">HoppyHour</h1>
          </div>
          <div className="flex items-center gap-3">
            {listState === "ready" && (
              <p className="text-xs text-muted-foreground hidden sm:block" role="status">
                {countLine}
              </p>
            )}
            {/* On mobile the submit CTA is the floating action button below */}
            <Button variant="outline" size="sm" asChild className="hidden sm:inline-flex">
              <Link to="/submit" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Submit a deal
              </Link>
            </Button>
            {/* Theme switcher + secondary nav */}
            <OptionsMenu />
          </div>
        </header>

        {/* Filters */}
        <div className="px-4 py-3 border-b border-border">
          <FiltersPanel date={date} onDateChange={(d) => { isDateManual.current = true; setDate(d); }} time={time} onTimeChange={(t) => { isTimeManual.current = true; setTime(t); }} isNow={selection.isNow} onResetToNow={resetToNow} radius={radius} onRadiusChange={setRadius} selectedTags={selectedTags} onTagsChange={setSelectedTags} searchQuery={searchQuery} onSearchQueryChange={setSearchQuery} onLocationSearch={handleLocationSearch} mapboxToken={token} />
        </div>

        {/* Location banner: why we're not using the real location, and a
            retry when one can help. role=status so a retry's result is heard. */}
        <div role="status" aria-live="polite">
          {banner && (
            <div className="flex items-center gap-3 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-900 text-sm dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-200">
              {geoStatus === "requesting" ? (
                <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" aria-hidden="true" />
              ) : (
                <LocateOff className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              )}
              <span className="flex-1">{banner.message}</span>
              {banner.action && (
                <button
                  type="button"
                  onClick={requestLocation}
                  className="touch-target font-medium underline underline-offset-2 hover:no-underline whitespace-nowrap rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {banner.action}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 flex flex-col md:flex-row min-h-0">
        {/* Mobile toggle — segmented pill control */}
        {isMobile && <div className="px-4 py-2 border-b border-border">
            <div className="flex rounded-full bg-muted p-1" role="group" aria-label="View">
              {(["list", "map"] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  aria-pressed={mobileView === view}
                  onClick={() => setMobileView(view)}
                  className={cn(
                    "touch-target flex-1 py-1.5 text-sm font-semibold capitalize rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    mobileView === view
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {view}
                </button>
              ))}
            </div>
          </div>}

        {/* List */}
        <section
          aria-labelledby="venues-heading"
          className={`${isMobile ? mobileView === "list" ? "flex-1 overflow-y-auto overscroll-y-contain" : "hidden" : "w-[380px] border-r border-border overflow-y-auto overscroll-y-contain"} p-3`}
          onScroll={handleListScroll}
        >
          <h2 id="venues-heading" className="sr-only">Venues</h2>
          {listState === "loading" ? (
            <VenueListSkeleton />
          ) : listState === "error" ? (
            <VenueListError
              onRetry={() => { void venuesQuery.refetch(); }}
              retrying={venuesFetching}
              offline={!isOnline}
            />
          ) : listState === "empty" ? (
            <VenueListEmpty
              copy={emptyCopy}
              onClearFilters={clearFilters}
              onWidenRadius={radiusIsTheCause && nextRadius ? () => setRadius(nextRadius) : undefined}
              widenLabel={nextRadius ? `Search within ${formatDistanceRadius(nextRadius)}` : undefined}
            />
          ) : (
            <>
              {/* A background refresh failed; keep the list, say so. */}
              {venuesQuery.isError && !venuesFetching && (
                <div role="alert" className="flex items-center gap-2 text-xs text-muted-foreground pb-2 px-1">
                  <span className="flex-1">{isOnline ? "Couldn't refresh venues." : "You're offline. Showing venues already loaded."}</span>
                  <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => { void venuesQuery.refetch(); }}>
                    Retry
                  </Button>
                </div>
              )}
              {/* Fix #20: subtle refetch indicator during background radius/location changes */}
              {venuesFetching && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground pb-2" role="status">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  Updating…
                </div>
              )}
              {/* Counts live in the header on desktop (hidden sm:block above) */}
              <p className="sm:hidden text-xs text-muted-foreground px-1 pb-2" role="status">
                {countLine}
              </p>
              <VenueList venues={allVenuesWithHH} selectedVenueId={selectedVenueId} onSelectVenue={handleOpenDetail} filteredHappyHourIds={filteredHHIds} liveVenueIds={liveVenueIds} selection={selection} />
            </>
          )}
        </section>

        {/* Map */}
        <section aria-label="Map" className={`${isMobile ? mobileView === "map" ? "flex-1 min-h-0" : "hidden" : "flex-1"} relative`}>
          {tokenQuery.isError ? (
            <MapMessage
              kind="error"
              title="The map couldn't load"
              detail="The venue list still works."
              onRetry={() => { void tokenQuery.refetch(); }}
              retrying={tokenQuery.isFetching}
            />
          ) : !token || queryLng === null || queryLat === null ? (
            <MapMessage kind="loading" title="Loading map…" />
          ) : <>
              <MapView token={token} lng={queryLng} lat={queryLat} venues={allVenuesWithHH} liveVenueIds={liveVenueIds} liveVenueCounts={liveVenueCounts} selectedVenueId={selectedVenueId} onSelectVenue={handleSelectVenue} onBoundsChange={setMapCenter} userLng={realLocation ? lng : null} userLat={realLocation ? lat : null} onRecenter={realLocation ? handleRecenter : undefined} onDragStart={isMobile ? collapseHeader : undefined} />
              {showSearchArea && <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
                  <Button size="sm" onClick={handleSearchArea} className="shadow-lg gap-2" disabled={venuesFetching}>
                    <RefreshCw className={`h-3.5 w-3.5 ${venuesFetching ? "animate-spin" : ""}`} aria-hidden="true" />
                    {venuesFetching ? "Searching…" : "Search this area"}
                  </Button>
                </div>}
            </>}
        </section>
      </main>

      {/* Floating submit CTA (mobile) — hidden while the venue preview sheet
          is open so it doesn't overlap */}
      {isMobile && !(mobileView === "map" && selectedVenueId) && (
        <Button
          asChild
          size="icon"
          className="fixed bottom-6 right-4 z-30 h-14 w-14 rounded-full shadow-lg shadow-primary/35"
        >
          <Link to="/submit" aria-label="Submit a deal">
            <Plus className="h-6 w-6" aria-hidden="true" />
          </Link>
        </Button>
      )}

      {/* Mobile map venue preview */}
      <VenueBottomSheet
        venue={selectedVenue}
        open={!!isMobile && mobileView === "map" && !!selectedVenueId}
        onClose={() => handleSelectVenue(null)}
        onViewDetails={handleOpenDetail}
        filteredHappyHourIds={filteredHHIds}
        liveVenueIds={liveVenueIds}
        selection={selection}
      />

      {/* Venue detail */}
      <VenueDetailModal venue={detailVenue} open={!!detailVenueId} onClose={() => setDetailVenueId(null)} />
    </div>;
}