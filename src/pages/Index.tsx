import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMapboxToken } from "@/hooks/use-mapbox-token";
import { useGeolocation } from "@/hooks/use-geolocation";
import { useVenuesWithinRadius, filterByDayAndTime, filterByTags, type VenueWithHappyHours } from "@/hooks/use-venues";
import MapView from "@/components/MapView";
import FiltersPanel from "@/components/FiltersPanel";
import VenueList from "@/components/VenueList";
import VenueDetailModal from "@/components/VenueDetailModal";
import VenueBottomSheet from "@/components/VenueBottomSheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, RefreshCw, Plus, LocateOff, ChevronDown, Loader2 } from "lucide-react";
import OptionsMenu from "@/components/OptionsMenu";
import { Link } from "react-router-dom";
import { DEFAULT_LOCATION_NAME } from "@/lib/constants";
import { roundTo15 } from "@/lib/time";

const MINI_STRIP_HEIGHT = 36;

export default function Index() {
  const isMobile = useIsMobile();
  const [mobileView, setMobileView] = useState<"list" | "map">("list");
  const {
    lng,
    lat,
    status: geoStatus,
    requestLocation,
  } = useGeolocation();
  const {
    data: token,
    isLoading: tokenLoading
  } = useMapboxToken();

  // Filter state
  const [date, setDate] = useState(new Date());
  const [time, setTime] = useState(roundTo15(new Date()));
  const [radius, setRadius] = useState(5000);
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
  const {
    data: venues = [],
    isLoading: venuesLoading,
    isFetching: venuesFetching,
  } = useVenuesWithinRadius(queryLng, queryLat, radius);
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

  // Build ALL venues with their hoppy hours, apply name/address search filter
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
  // Bug #3: also gate on coords being non-null (possible when geoStatus is "denied"
  // but DEFAULT_LNG/LAT env vars are not set, or during the brief requesting window)
  const isLoading = tokenLoading || geoStatus === "requesting" || queryLng === null || queryLat === null;

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
        <div
          className="fixed top-0 left-0 right-0 z-50 h-9 bg-card border-b border-border flex items-center justify-center gap-1.5 cursor-pointer select-none"
          onClick={expandHeader}
        >
          <img src="/favicon.ico" alt="HoppyHour" className="h-4 w-4" />
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </div>
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
            <img src="/favicon.ico" alt="HoppyHour" className="h-8 w-8" />
            <h1 className="text-lg font-bold tracking-tight">HoppyHour</h1>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-xs text-muted-foreground hidden sm:block">
              {allVenuesWithHH.length} venue{allVenuesWithHH.length !== 1 ? "s" : ""} · {filteredHH.length} deal{filteredHH.length !== 1 ? "s" : ""}
            </p>
            {/* On mobile the submit CTA is the floating action button below */}
            <Button variant="outline" size="sm" asChild className="hidden sm:inline-flex">
              <Link to="/submit" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Submit a Deal
              </Link>
            </Button>
            {/* Theme switcher + secondary nav (submit / admin) */}
            <OptionsMenu />
          </div>
        </header>

        {/* Filters */}
        <div className="px-4 py-3 border-b border-border">
          <FiltersPanel date={date} onDateChange={(d) => { isDateManual.current = true; setDate(d); }} time={time} onTimeChange={(t) => { isTimeManual.current = true; setTime(t); }} radius={radius} onRadiusChange={setRadius} selectedTags={selectedTags} onTagsChange={setSelectedTags} searchQuery={searchQuery} onSearchQueryChange={setSearchQuery} onLocationSearch={handleLocationSearch} mapboxToken={token} />
        </div>

        {/* Geolocation denied banner */}
        {geoStatus === "denied" && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-300">
            <LocateOff className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1">
              Location access denied — showing results near <strong>{DEFAULT_LOCATION_NAME}</strong>.
            </span>
            <button
              onClick={requestLocation}
              className="font-medium underline underline-offset-2 hover:no-underline whitespace-nowrap"
            >
              Use my location
            </button>
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        {/* Mobile toggle — segmented pill control */}
        {isMobile && <div className="px-4 py-2 border-b border-border">
            <div className="flex rounded-full bg-muted p-1">
              <button onClick={() => setMobileView("list")} className={`flex-1 py-1.5 text-sm font-semibold rounded-full transition-all ${mobileView === "list" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
                List
              </button>
              <button onClick={() => setMobileView("map")} className={`flex-1 py-1.5 text-sm font-semibold rounded-full transition-all ${mobileView === "map" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
                Map
              </button>
            </div>
          </div>}

        {/* List */}
        <div
          className={`${isMobile ? mobileView === "list" ? "flex-1 overflow-y-auto overscroll-y-contain" : "hidden" : "w-[380px] border-r border-border overflow-y-auto overscroll-y-contain"} p-3`}
          onScroll={handleListScroll}
        >
          {venuesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
            </div>
          ) : (
            <>
              {/* Fix #20: subtle refetch indicator during background radius/location changes */}
              {venuesFetching && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground pb-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Updating…
                </div>
              )}
              {/* Counts live in the header on desktop (hidden sm:block above) */}
              {allVenuesWithHH.length > 0 && (
                <p className="sm:hidden text-xs text-muted-foreground px-1 pb-2">
                  <span className="font-semibold text-foreground">{allVenuesWithHH.length} venue{allVenuesWithHH.length !== 1 ? "s" : ""}</span> · {filteredHH.length} deal{filteredHH.length !== 1 ? "s" : ""} on now
                </p>
              )}
              <VenueList venues={allVenuesWithHH} selectedVenueId={selectedVenueId} onSelectVenue={handleOpenDetail} filteredHappyHourIds={filteredHHIds} liveVenueIds={liveVenueIds} />
            </>
          )}
        </div>

        {/* Map */}
        <div className={`${isMobile ? mobileView === "map" ? "flex-1 min-h-0" : "hidden" : "flex-1"} relative`}>
          {isLoading || !token ? <div className="w-full h-full flex items-center justify-center bg-muted">
              <div className="text-center text-muted-foreground">
                <MapPin className="h-8 w-8 mx-auto mb-2 animate-pulse" />
                <p className="text-sm">Loading map…</p>
              </div>
            </div> : <>
              <MapView token={token} lng={queryLng as number} lat={queryLat as number} venues={allVenuesWithHH} liveVenueIds={liveVenueIds} liveVenueCounts={liveVenueCounts} selectedVenueId={selectedVenueId} onSelectVenue={handleSelectVenue} onBoundsChange={setMapCenter} userLng={lng} userLat={lat} onRecenter={handleRecenter} onDragStart={isMobile ? collapseHeader : undefined} />
              {showSearchArea && <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
                  <Button size="sm" onClick={handleSearchArea} className="shadow-lg gap-2" disabled={venuesFetching}>
                    <RefreshCw className={`h-3.5 w-3.5 ${venuesFetching ? "animate-spin" : ""}`} />
                    {venuesFetching ? "Searching…" : "Search this area"}
                  </Button>
                </div>}
            </>}
        </div>
      </div>

      {/* Floating submit CTA (mobile) — hidden while the venue preview sheet
          is open so it doesn't overlap */}
      {isMobile && !(mobileView === "map" && selectedVenueId) && (
        <Button
          asChild
          size="icon"
          className="fixed bottom-6 right-4 z-30 h-14 w-14 rounded-full shadow-lg shadow-primary/35"
        >
          <Link to="/submit" aria-label="Submit a deal">
            <Plus className="h-6 w-6" />
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
      />

      {/* Venue detail */}
      <VenueDetailModal venue={detailVenue} open={!!detailVenueId} onClose={() => setDetailVenueId(null)} />
    </div>;
}