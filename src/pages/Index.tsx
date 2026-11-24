import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  List,
  Loader2,
  LocateOff,
  Map as MapIcon,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMapboxToken } from "@/hooks/use-mapbox-token";
import { useGeolocation } from "@/hooks/use-geolocation";
import {
  useVenue,
  useVenuesWithinRadius,
  filterByDayAndTime,
  filterByTags,
  type HappyHour,
  type VenueWithHappyHours,
} from "@/hooks/use-venues";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useHomeUrlState } from "@/hooks/use-home-url-state";
import { useToast } from "@/hooks/use-toast";
import MapView from "@/components/MapView";
import { MapMessage } from "@/components/MapMessage";
import FiltersPanel from "@/components/FiltersPanel";
import VenueList, { VenueListEmpty, VenueListError, VenueListSkeleton } from "@/components/VenueList";
import VenueDetail, { ScrollCue } from "@/components/VenueDetail";
import { venueStatus } from "@/lib/venue-status";
import VenueSheet, { type SheetMode } from "@/components/VenueSheet";
import { Button } from "@/components/ui/button";
import OptionsMenu from "@/components/OptionsMenu";
import { DEFAULT_LOCATION_NAME } from "@/lib/constants";
import { roundTo15 } from "@/lib/time";
import { describeSelection, plural } from "@/lib/format";
import { geoBanner, geoChip, hasRealLocation, isLocating } from "@/lib/geo-status";
import { describeEmptyState, selectListState } from "@/lib/list-state";
import { MAX_RADIUS, RADIUS_OPTIONS, formatDistanceRadius } from "@/lib/radius";
import { countActiveFilters, fromDateParam, toDateParam } from "@/lib/url-state";
import { describeNextDeal, findNextDeal } from "@/lib/next-deal";
import { scrollBehavior } from "@/lib/motion";
import { cn } from "@/lib/utils";

// Height of the collapsed header strip on phones: a full 44px tap target.
const MINI_STRIP_HEIGHT = 44;

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

/** Where a venue was opened from, so focus can go back there on close. */
type Opener = { kind: "card" | "pin"; id: string };

export default function Index() {
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const { state: url, update: updateUrl, openVenue, closeVenue } = useHomeUrlState();
  const mobileView = url.view;
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

  // Wall clock, refreshed every minute. With no date/time in the URL the
  // filter is "now" and follows it (including across midnight).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const todayKey = now.toDateString();
  const date = useMemo(
    () => (url.date ? fromDateParam(url.date) : new Date(todayKey)),
    [url.date, todayKey],
  );
  const time = url.time ?? roundTo15(now);
  const radius = url.radius;
  const selectedTags = url.tags;
  const searchQuery = url.q;

  // Map center for "search this area" (not in the URL: it is a map gesture).
  const [mapCenter, setMapCenter] = useState<{ lng: number; lat: number } | null>(null);
  const [searchCenter, setSearchCenter] = useState<{ lng: number; lat: number } | null>(null);
  const queryLng = searchCenter?.lng ?? lng;
  const queryLat = searchCenter?.lat ?? lat;
  const venuesQuery = useVenuesWithinRadius(queryLng, queryLat, radius);
  const { isFetching: venuesFetching } = venuesQuery;
  const venues = useMemo(() => venuesQuery.data ?? [], [venuesQuery.data]);

  // A linked venue that isn't in the loaded list (outside the radius, or
  // someone else's location): fetch it on its own.
  const venueInList = url.venue ? venues.find((v) => v.id === url.venue) ?? null : null;
  const linkedQuery = useVenue(
    url.venue,
    queryLng,
    queryLat,
    !!url.venue && venuesQuery.data !== undefined && !venueInList,
  );
  const linkedVenue = !venueInList ? linkedQuery.data ?? null : null;
  const venuesAll = useMemo(
    () => (linkedVenue ? [...venues, linkedVenue] : venues),
    [venues, linkedVenue],
  );
  const happyHours = useMemo(() => venuesAll.flatMap((v) => v.happy_hours), [venuesAll]);

  // Apply filters
  const dayOfWeek = date.getDay();
  const timeStr = time + ":00";
  const tagFilteredHH = useMemo(() => filterByTags(happyHours, selectedTags), [happyHours, selectedTags]);
  const filteredHH = useMemo(
    () => filterByDayAndTime(tagFilteredHH, dayOfWeek, timeStr),
    [tagFilteredHH, dayOfWeek, timeStr],
  );
  const filteredHHIds = useMemo(() => new Set(filteredHH.map((h) => h.id)), [filteredHH]);
  const liveVenueCounts = useMemo(() => {
    const counts = new Map<string, number>();
    filteredHH.forEach((hh) => counts.set(hh.venue_id, (counts.get(hh.venue_id) ?? 0) + 1));
    return counts;
  }, [filteredHH]);
  const liveVenueIds = useMemo(() => new Set(liveVenueCounts.keys()), [liveVenueCounts]);
  const selectedIsToday = sameDay(date, now);

  // Next deal for every venue with nothing on at the selection.
  const nextDealLabels = useMemo(() => {
    const byVenue = new Map<string, HappyHour[]>();
    tagFilteredHH.forEach((hh) => {
      const list = byVenue.get(hh.venue_id) ?? [];
      list.push(hh);
      byVenue.set(hh.venue_id, list);
    });
    const labels = new Map<string, string>();
    byVenue.forEach((deals, venueId) => {
      if (liveVenueIds.has(venueId)) return;
      const next = findNextDeal(deals, dayOfWeek, time);
      if (next) labels.set(venueId, describeNextDeal(next, selectedIsToday));
    });
    return labels;
  }, [tagFilteredHH, liveVenueIds, dayOfWeek, time, selectedIsToday]);

  // Name/address search, then live venues first, then by distance.
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

  const detailVenue = venueInList ?? linkedVenue;
  const venueOpen = !!url.venue;
  // The map always shows the open venue, even when the search hides it from
  // the list or it lies outside the radius.
  const mapVenues = useMemo(
    () =>
      detailVenue && !allVenuesWithHH.some((v) => v.id === detailVenue.id)
        ? [...allVenuesWithHH, detailVenue]
        : allVenuesWithHH,
    [allVenuesWithHH, detailVenue],
  );

  // A link to a venue that no longer exists: say so and drop it from the URL.
  useEffect(() => {
    if (url.venue && !venueInList && linkedQuery.isSuccess && linkedQuery.data === null) {
      toast({ title: "Venue not found", description: "That venue isn't listed any more." });
      closeVenue();
    }
  }, [url.venue, venueInList, linkedQuery.isSuccess, linkedQuery.data, toast, closeVenue]);

  // ── Opening and closing the detail ────────────────────────────────────
  const [sheetMode, setSheetMode] = useState<SheetMode>(() => (url.view === "map" ? "compact" : "expanded"));
  const [sheetHeight, setSheetHeight] = useState(0);
  const openerRef = useRef<Opener | null>(null);

  const openFromList = useCallback(
    (id: string) => {
      openerRef.current = { kind: "card", id };
      setSheetMode("expanded");
      openVenue(id);
    },
    [openVenue],
  );
  const openFromMap = useCallback(
    (id: string) => {
      openerRef.current = { kind: "pin", id };
      setSheetMode("compact");
      openVenue(id);
    },
    [openVenue],
  );
  const handleMapBackgroundClick = useCallback(() => {
    if (isMobile && venueOpen && sheetMode === "compact") closeVenue();
  }, [isMobile, venueOpen, sheetMode, closeVenue]);

  // Focus: the detail's heading when it opens (desktop panel; the sheet
  // focuses its own), and back to the card or pin that opened it on close.
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const prevVenueRef = useRef(url.venue);
  useEffect(() => {
    const prev = prevVenueRef.current;
    prevVenueRef.current = url.venue;
    if (url.venue && !isMobile) {
      requestAnimationFrame(() => panelHeadingRef.current?.focus({ preventScroll: true }));
    }
    if (prev && !url.venue) {
      const opener = openerRef.current;
      openerRef.current = null;
      requestAnimationFrame(() => {
        const card = document.querySelector<HTMLElement>(`[data-venue-card="${prev}"]`);
        const pin = document.querySelector<HTMLElement>(`[data-venue-pin="${prev}"]`);
        const target = opener?.kind === "pin" ? pin ?? card : card ?? pin;
        target?.focus({ preventScroll: opener?.kind === "pin" });
      });
    }
  }, [url.venue, isMobile, detailVenue]);

  // Esc closes the detail (unless a popover or menu is taking it).
  useEffect(() => {
    if (!venueOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("[data-radix-popper-content-wrapper], [role='dialog']:not([data-venue-sheet])")) return;
      closeVenue();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [venueOpen, closeVenue]);

  // The expanded phone sheet is modal: everything behind it is inert.
  const pageRef = useRef<HTMLDivElement>(null);
  const sheetModal = isMobile && venueOpen && sheetMode === "expanded";
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    el.inert = sheetModal;
    return () => {
      el.inert = false;
    };
  }, [sheetModal]);

  // Desktop: the detail replaces the list column; keep the list's scroll
  // position for when it comes back.
  const listScrollRef = useRef<HTMLElement>(null);
  const savedListScroll = useRef(0);
  const panelScrollRef = useRef<HTMLDivElement>(null);
  const desktopDetail = !isMobile && venueOpen;
  useLayoutEffect(() => {
    if (!desktopDetail && listScrollRef.current) listScrollRef.current.scrollTop = savedListScroll.current;
    if (desktopDetail) panelScrollRef.current?.scrollTo({ top: 0 });
  }, [desktopDetail, url.venue]);

  // ── Filters ──────────────────────────────────────────────────────────
  // Both fly the map to the new search centre, a move MapView doesn't report,
  // so forget the last user-moved centre too.
  const handleLocationSearch = useCallback((coords: { lng: number; lat: number }) => {
    setSearchCenter(coords);
    setMapCenter(null);
  }, []);
  const handleRecenter = useCallback(() => {
    setSearchCenter(null);
    setMapCenter(null);
  }, []);
  const showSearchArea = mapCenter && (Math.abs(mapCenter.lng - (queryLng ?? 0)) > 0.005 || Math.abs(mapCenter.lat - (queryLat ?? 0)) > 0.005);
  const handleSearchArea = () => {
    if (mapCenter) setSearchCenter(mapCenter);
  };
  const selection = useMemo(() => describeSelection(date, time, now), [date, time, now]);

  const resetToNow = useCallback(() => {
    setNow(new Date());
    updateUrl({ date: null, time: null });
  }, [updateUrl]);
  const onDateChange = useCallback(
    (d: Date) => updateUrl({ date: sameDay(d, new Date()) ? null : toDateParam(d) }),
    [updateUrl],
  );
  const onTimeChange = useCallback((t: string) => updateUrl({ time: t || null }), [updateUrl]);
  const onRadiusChange = useCallback((r: number) => updateUrl({ radius: r }), [updateUrl]);
  const onTagsChange = useCallback((tags: string[]) => updateUrl({ tags }), [updateUrl]);
  const onSearchQueryChange = useCallback((q: string) => updateUrl({ q }), [updateUrl]);
  const setMobileView = useCallback((view: "list" | "map") => updateUrl({ view }), [updateUrl]);
  const clearFilters = useCallback(() => {
    setNow(new Date());
    updateUrl({ q: "", tags: [], date: null, time: null });
  }, [updateUrl]);
  const activeFilterCount = countActiveFilters(url);

  // ── List state ───────────────────────────────────────────────────────
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
  const liveInList = allVenuesWithHH.filter((v) => liveVenueIds.has(v.id)).length;
  const countLine = `${plural(allVenuesWithHH.length, "venue")} · ${liveInList} with deals on ${selection.phrase}`;

  // ── Location notice ──────────────────────────────────────────────────
  const banner =
    geoStatus === "requesting" && geoUserInitiated
      ? { message: "Finding your location…", action: null }
      : geoBanner(geoStatus, DEFAULT_LOCATION_NAME, geoUserInitiated);
  const chip =
    geoStatus === "requesting" && geoUserInitiated
      ? { label: "Finding your location…", action: null }
      : geoChip(geoStatus, DEFAULT_LOCATION_NAME, geoUserInitiated);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  // A new problem (e.g. a retry that failed differently) shows the notice again.
  useEffect(() => setNoticeDismissed(false), [geoStatus, geoUserInitiated]);
  const realLocation = hasRealLocation(geoStatus);

  // ── Phone: scroll-linked header hide, FAB hide ────────────────────────
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const [collapsibleHeight, setCollapsibleHeight] = useState(0);
  const [headerOffset, setHeaderOffset] = useState(0);
  const lastScrollTopRef = useRef(0);
  const isAnimatingRef = useRef(false);
  const [fabHidden, setFabHidden] = useState(false);

  useLayoutEffect(() => {
    if (!collapsibleRef.current || !isMobile) return;
    setCollapsibleHeight(collapsibleRef.current.offsetHeight);
    const ro = new ResizeObserver(() => {
      if (collapsibleRef.current) setCollapsibleHeight(collapsibleRef.current.offsetHeight);
    });
    ro.observe(collapsibleRef.current);
    return () => ro.disconnect();
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile) setHeaderOffset(0);
  }, [isMobile]);

  useEffect(() => {
    if (mobileView === "list") {
      isAnimatingRef.current = true;
      setHeaderOffset(0);
    }
    setFabHidden(false);
  }, [mobileView]);

  const handleListScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (!desktopDetail) savedListScroll.current = scrollTop;
    if (!isMobile || collapsibleHeight === 0) return;
    const delta = scrollTop - lastScrollTopRef.current;
    lastScrollTopRef.current = scrollTop;
    // Skip at the bottom boundary: Android overscroll fires scroll events here
    // that would otherwise create a feedback loop with the header resize.
    if (scrollTop + clientHeight >= scrollHeight - 2) return;
    if (delta > 4 && scrollTop > 48) setFabHidden(true);
    else if (delta < -4 || scrollTop <= 48) setFabHidden(false);
    isAnimatingRef.current = false;
    setHeaderOffset((prev) => Math.max(0, Math.min(prev + delta * 2, collapsibleHeight)));
  }, [isMobile, collapsibleHeight, desktopDetail]);

  const expandHeader = useCallback(() => {
    isAnimatingRef.current = true;
    setHeaderOffset(0);
  }, []);
  const collapseHeader = useCallback(() => {
    isAnimatingRef.current = true;
    setHeaderOffset(collapsibleHeight);
  }, [collapsibleHeight]);
  const scrollListToTop = useCallback(() => {
    listScrollRef.current?.scrollTo({ top: 0, behavior: scrollBehavior() });
    expandHeader();
    // Keep keyboard focus somewhere sensible (the strip button disappears)
    // without focusing the search field, which would raise the phone keyboard.
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-venue-card]")?.focus({ preventScroll: true }));
  }, [expandHeader]);

  const headerCollapsed = isMobile && headerOffset > 10;
  const dynamicPaddingTop = isMobile ? Math.max(MINI_STRIP_HEIGHT, collapsibleHeight - headerOffset) : 0;
  const collapsibleStyle: React.CSSProperties = isMobile
    ? {
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 40,
        transform: `translateY(-${headerOffset}px)`,
        transition: isAnimatingRef.current ? "transform 0.25s ease" : "none",
        willChange: "transform",
      }
    : {};

  const detailStatus = detailVenue ? venueStatus(detailVenue, liveVenueCounts, nextDealLabels) : null;
  const outsideRadiusNote =
    detailVenue && !venueInList
      ? `Outside your ${formatDistanceRadius(radius)} search area, so it isn't in the list. Distance is from ${realLocation && !searchCenter ? "you" : "the map's search centre"}.`
      : null;

  const viewToggle = (
    <div className="flex rounded-full bg-muted p-0.5" role="group" aria-label="View">
      {(["list", "map"] as const).map((view) => {
        const Icon = view === "list" ? List : MapIcon;
        return (
          <button
            key={view}
            type="button"
            aria-pressed={mobileView === view}
            onClick={() => setMobileView(view)}
            className={cn(
              "touch-target flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mobileView === view ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {view}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      <div ref={pageRef} className="flex flex-col h-dvh" style={{ paddingTop: dynamicPaddingTop }}>
        {/* Collapsed strip (phones): says it expands the filters, shows how
            many are on, and offers a way back to the top of the list. */}
        {headerCollapsed && (
          <div className="fixed top-0 left-0 right-0 z-50 flex h-11 items-stretch border-b border-border bg-card">
            <button
              type="button"
              className="flex flex-1 items-center gap-2 px-4 text-sm font-medium select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={expandHeader}
              aria-expanded={false}
            >
              <SlidersHorizontal className="h-4 w-4 text-primary" aria-hidden="true" />
              Search and filters
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-xs font-semibold leading-5 text-primary-foreground">
                  {activeFilterCount}
                  <span className="sr-only"> active</span>
                </span>
              )}
              <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </button>
            {mobileView === "list" ? (
              <button
                type="button"
                onClick={scrollListToTop}
                className="flex items-center gap-1 px-4 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
                Top
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setMobileView("list")}
                className="flex items-center gap-1 px-4 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <List className="h-4 w-4" aria-hidden="true" />
                List
              </button>
            )}
          </div>
        )}

        {/* Header + filters (fixed and collapsible on phones, static on desktop) */}
        <div
          ref={collapsibleRef}
          style={collapsibleStyle}
          className="bg-background"
          onTransitionEnd={() => { isAnimatingRef.current = false; }}
        >
          <header className="flex items-center justify-between gap-2 border-b border-border bg-card px-4 py-1.5 md:px-6 md:py-3">
            <div className="flex min-w-0 items-center gap-2">
              <img src="/favicon.ico" alt="" className="h-7 w-7 md:h-8 md:w-8" />
              <h1 className="truncate text-base font-bold tracking-tight md:text-lg">HoppyHour</h1>
            </div>
            <div className="flex items-center gap-2 md:gap-3">
              {!isMobile && listState === "ready" && (
                <p className="text-xs text-muted-foreground" role="status">
                  {countLine}
                </p>
              )}
              {!isMobile && (
                <Button variant="outline" size="sm" asChild>
                  <Link to="/submit" className="gap-1.5">
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Submit a deal
                  </Link>
                </Button>
              )}
              {isMobile && viewToggle}
              <OptionsMenu />
            </div>
          </header>

          <div className="px-4 pb-2 pt-2.5 md:border-b md:border-border md:py-3">
            <FiltersPanel
              date={date}
              onDateChange={onDateChange}
              time={time}
              onTimeChange={onTimeChange}
              isNow={selection.isNow}
              onResetToNow={resetToNow}
              radius={radius}
              onRadiusChange={onRadiusChange}
              selectedTags={selectedTags}
              onTagsChange={onTagsChange}
              searchQuery={searchQuery}
              onSearchQueryChange={onSearchQueryChange}
              onLocationSearch={handleLocationSearch}
              mapboxToken={token}
            />
          </div>

          {/* Location notice: one dismissible line. role=status so a retry's
              result is heard; the full sentence is read out. */}
          <div role="status" aria-live="polite" className="border-b border-border md:border-0">
            {banner && chip && !noticeDismissed && (
              <div className="px-4 pb-2 md:py-2">
                <div className="flex h-8 items-center gap-2 rounded-full border border-amber-200 bg-amber-50 pl-3 pr-1 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  {geoStatus === "requesting" ? (
                    <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin" aria-hidden="true" />
                  ) : (
                    <LocateOff className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 truncate" aria-hidden="true">
                    {isMobile ? chip.label : banner.message}
                  </span>
                  <span className="sr-only">{banner.message}</span>
                  {chip.action && (
                    <button
                      type="button"
                      onClick={requestLocation}
                      className="touch-target flex-shrink-0 whitespace-nowrap rounded-full px-2 py-1 font-semibold underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {chip.action}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setNoticeDismissed(true)}
                    className="touch-target flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-amber-900/50"
                    aria-label="Dismiss location notice"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Main content */}
        <main className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* List column (desktop: 380px, swapped for the detail when a venue is open) */}
          <section
            aria-labelledby="venues-heading"
            className={cn(
              "flex min-h-0 flex-col",
              isMobile ? (mobileView === "list" ? "flex-1" : "hidden") : "w-[380px] flex-shrink-0 border-r border-border",
            )}
          >
            <h2 id="venues-heading" className="sr-only">Venues</h2>
            <div
              ref={listScrollRef as React.RefObject<HTMLDivElement>}
              className={cn("min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-3", isMobile && "pt-2 pb-28", desktopDetail && "hidden")}
              onScroll={handleListScroll}
            >
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
                  onWidenRadius={radiusIsTheCause && nextRadius ? () => onRadiusChange(nextRadius) : undefined}
                  widenLabel={nextRadius ? `Search within ${formatDistanceRadius(nextRadius)}` : undefined}
                />
              ) : (
                <>
                  {venuesQuery.isError && !venuesFetching && (
                    <div role="alert" className="flex items-center gap-2 px-1 pb-2 text-xs text-muted-foreground">
                      <span className="flex-1">{isOnline ? "Couldn't refresh venues." : "You're offline. Showing venues already loaded."}</span>
                      <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => { void venuesQuery.refetch(); }}>
                        Retry
                      </Button>
                    </div>
                  )}
                  {venuesFetching && (
                    <div className="flex items-center gap-1.5 pb-2 text-xs text-muted-foreground" role="status">
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                      Updating…
                    </div>
                  )}
                  {isMobile && (
                    <p className="px-1 pb-2 text-xs text-muted-foreground" role="status">
                      {countLine}
                    </p>
                  )}
                  <VenueList
                    venues={allVenuesWithHH}
                    selectedVenueId={url.venue}
                    onSelectVenue={openFromList}
                    filteredHappyHourIds={filteredHHIds}
                    liveVenueIds={liveVenueIds}
                    nextDealLabels={nextDealLabels}
                    selection={selection}
                  />
                </>
              )}
            </div>

            {desktopDetail && (
              <div role="region" aria-labelledby="venue-panel-title" className="flex min-h-0 flex-1 flex-col">
                <div className="border-b border-border px-2 py-2">
                  <Button variant="ghost" size="sm" className="gap-1.5" onClick={closeVenue}>
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    Back to list
                  </Button>
                </div>
                <div ref={panelScrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pt-4">
                  {detailVenue && detailStatus ? (
                    <div className="pb-6">
                      <VenueDetail
                        ref={panelHeadingRef}
                        venue={detailVenue}
                        status={detailStatus}
                        selection={selection}
                        filteredHappyHourIds={filteredHHIds}
                        selectedDay={dayOfWeek}
                        selectedIsToday={selectedIsToday}
                        outsideRadiusNote={outsideRadiusNote}
                        headingId="venue-panel-title"
                      />
                    </div>
                  ) : linkedQuery.isError ? (
                    <p role="alert" className="text-sm text-muted-foreground">
                      Couldn't load this venue. Check your connection and try again.
                    </p>
                  ) : (
                    <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Loading venue…
                    </div>
                  )}
                  <ScrollCue scrollRef={panelScrollRef} />
                </div>
              </div>
            )}
          </section>

          {/* Map */}
          <section aria-label="Map" className={cn("relative", isMobile ? (mobileView === "map" ? "flex-1 min-h-0" : "hidden") : "flex-1")}>
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
            ) : (
              <>
                <MapView
                  token={token}
                  lng={queryLng}
                  lat={queryLat}
                  venues={mapVenues}
                  liveVenueIds={liveVenueIds}
                  liveVenueCounts={liveVenueCounts}
                  selectedVenueId={url.venue}
                  selection={selection}
                  onSelectVenue={openFromMap}
                  onBackgroundClick={handleMapBackgroundClick}
                  onBoundsChange={setMapCenter}
                  userLng={realLocation ? lng : null}
                  userLat={realLocation ? lat : null}
                  onRecenter={realLocation ? handleRecenter : undefined}
                  onDragStart={isMobile ? collapseHeader : undefined}
                  bottomInset={isMobile && mobileView === "map" && venueOpen ? sheetHeight : 0}
                />
                {showSearchArea && (
                  <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2">
                    <Button size="sm" onClick={handleSearchArea} className="gap-2 shadow-lg" disabled={venuesFetching}>
                      <RefreshCw className={cn("h-3.5 w-3.5", venuesFetching && "animate-spin")} aria-hidden="true" />
                      {venuesFetching ? "Searching…" : "Search this area"}
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
        </main>

        {/* Floating submit button (phones): clear of the home indicator and
            Safari's bottom bar, out of the way while scrolling down, and
            hidden while a venue is open. */}
        {isMobile && !venueOpen && (
          <Button
            asChild
            size="icon"
            className={cn(
              "fixed right-4 z-30 h-14 w-14 rounded-full shadow-lg shadow-primary/35 transition-transform duration-200",
              fabHidden && "pointer-events-none translate-y-32",
            )}
            style={{ bottom: "max(1.5rem, calc(env(safe-area-inset-bottom) + 1rem))" }}
          >
            <Link to="/submit" aria-label="Submit a deal" aria-hidden={fabHidden || undefined} tabIndex={fabHidden ? -1 : undefined}>
              <Plus className="h-6 w-6" aria-hidden="true" />
            </Link>
          </Button>
        )}
      </div>

      {/* Phone venue detail: one sheet, from the list or the map. */}
      {isMobile && venueOpen && detailVenue && detailStatus && (
        <VenueSheet
          venue={detailVenue}
          status={detailStatus}
          mode={sheetMode}
          onModeChange={setSheetMode}
          onClose={closeVenue}
          selection={selection}
          filteredHappyHourIds={filteredHHIds}
          selectedDay={dayOfWeek}
          selectedIsToday={selectedIsToday}
          outsideRadiusNote={outsideRadiusNote}
          onHeightChange={setSheetHeight}
        />
      )}
    </>
  );
}
