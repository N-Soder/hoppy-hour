import { useRef, useEffect } from "react";
import { MapPin, Clock, AlertCircle, CalendarClock, RefreshCw, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";
import type { VenueWithHappyHours } from "@/hooks/use-venues";
import { formatDistance, formatTimeRange, plural, type SelectionLabel } from "@/lib/format";
import { groupHappyHours, type GroupedHappyHour } from "@/lib/happy-hour-utils";
import type { EmptyStateCopy } from "@/lib/list-state";
import { scrollBehavior } from "@/lib/motion";
import LiveBadge from "@/components/LiveBadge";
import { ZoneNote } from "@/components/VenueDetail";

interface VenueListProps {
  venues: VenueWithHappyHours[];
  selectedVenueId: string | null;
  onSelectVenue: (id: string) => void;
  filteredHappyHourIds: Set<string>;
  liveVenueIds: Set<string>;
  /** "Fri 4–6 pm" for venues with no deal on at the selection. */
  nextDealLabels: Map<string, string>;
  /** "Perth time" for venues whose clock differs from the viewer's; absent or null otherwise. */
  zoneNotes?: Map<string, string | null>;
  selection: SelectionLabel;
}

export default function VenueList({
  venues,
  selectedVenueId,
  onSelectVenue,
  filteredHappyHourIds,
  liveVenueIds,
  nextDealLabels,
  zoneNotes,
  selection,
}: VenueListProps) {
  const itemRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  useEffect(() => {
    if (selectedVenueId) {
      itemRefs.current.get(selectedVenueId)?.scrollIntoView({ behavior: scrollBehavior(), block: "nearest" });
    }
  }, [selectedVenueId]);

  return (
    <ul className="flex flex-col gap-2" aria-label="Venues">
      {venues.map((venue) => {
        const isLive = liveVenueIds.has(venue.id);
        const matchingHH = venue.happy_hours.filter((hh) => filteredHappyHourIds.has(hh.id));
        const groupedMatchingHH = groupHappyHours(matchingHH);
        const isSelected = venue.id === selectedVenueId;
        const next = isLive ? null : nextDealLabels.get(venue.id) ?? null;
        const dealCount = groupHappyHours(venue.happy_hours).length;
        const zoneNote = zoneNotes?.get(venue.id) ?? null;

        return (
          <li
            key={venue.id}
            ref={(el) => {
              if (el) itemRefs.current.set(venue.id, el);
              else itemRefs.current.delete(venue.id);
            }}
            // The whole card is clickable through the name button's stretched
            // ::after; the ring shows when that button has keyboard focus.
            className={cn(
              "relative rounded-xl border p-4 transition-colors ring-offset-background has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2",
              isSelected
                ? "border-primary bg-accent shadow-[0_6px_18px_-6px_hsl(var(--primary)/0.45)]"
                : isLive
                  ? "border-primary/25 bg-card shadow-[0_6px_18px_-6px_hsl(var(--primary)/0.3)] hover:border-primary/50"
                  : "border-border bg-card hover:border-input",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="min-w-0 truncate text-sm font-semibold">
                    <button
                      type="button"
                      data-venue-card={venue.id}
                      onClick={() => onSelectVenue(venue.id)}
                      className="text-left after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none"
                    >
                      {venue.name}
                    </button>
                  </h3>
                  {/* No zone note here: it would squeeze the name. The filter's
                      time pill already says which zone "now" is in. */}
                  {isLive && <LiveBadge selection={selection} />}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{venue.address}</p>
              </div>
              <span
                className={cn(
                  "whitespace-nowrap text-xs font-medium",
                  isLive ? "text-primary" : "text-muted-foreground",
                )}
              >
                {formatDistance(venue.distance_meters)}
              </span>
            </div>

            {groupedMatchingHH.length > 0 && (
              <div className="mt-2.5 space-y-1.5">
                {groupedMatchingHH.slice(0, 3).map((group) => (
                  <HappyHourRow key={group.ids[0]} hh={group} />
                ))}
                {groupedMatchingHH.length > 3 && (
                  <p className="text-xs text-muted-foreground">
                    +{plural(groupedMatchingHH.length - 3, "more deal")}
                  </p>
                )}
              </div>
            )}

            {!isLive && dealCount > 0 && (
              <div className="mt-2.5 flex items-center gap-2 text-xs">
                <CalendarClock className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">
                  {next ? (
                    <>
                      <span className="text-muted-foreground">Next:</span>{" "}
                      <span className="font-semibold tabular-nums">{next}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">No deal matches your filters</span>
                  )}
                </span>
                {next && <ZoneNote note={zoneNote} />}
                <span className="flex-shrink-0 whitespace-nowrap text-muted-foreground">{plural(dealCount, "deal")}</span>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function HappyHourRow({ hh }: { hh: GroupedHappyHour }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Clock className="h-3 w-3 flex-shrink-0 text-primary" aria-hidden="true" />
      <span className="whitespace-nowrap font-semibold tabular-nums text-primary">
        {formatTimeRange(hh.start_time, hh.end_time)}
      </span>
      <span className="flex-1 truncate font-medium">{hh.description}</span>
      <div className="flex flex-shrink-0 gap-1">
        {hh.tags?.slice(0, 2).map((tag) => (
          <Badge key={tag} variant="secondary" className="px-1.5 py-0 text-[10px] capitalize">
            {tag}
          </Badge>
        ))}
      </div>
    </div>
  );
}

/** Placeholder cards while the location or the first fetch is pending. */
export function VenueListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <span className="sr-only">Loading venues…</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-4" aria-hidden="true">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
            <Skeleton className="h-3 w-10" />
          </div>
          <div className="mt-3 space-y-1.5">
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The venues request failed and there is nothing cached to show. */
export function VenueListError({
  onRetry,
  retrying,
  offline,
}: {
  onRetry: () => void;
  retrying: boolean;
  offline: boolean;
}) {
  const Icon = offline ? WifiOff : AlertCircle;
  return (
    <div role="alert" className="flex flex-col items-center justify-center px-4 py-16 text-center">
      <Icon className="mb-3 h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-semibold">Couldn't load venues</p>
      <p className="mb-4 mt-1 max-w-xs text-sm text-muted-foreground">
        {offline
          ? "You're offline. Venues will load when you're back online."
          : "Something went wrong reaching the server. Check your connection and try again."}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying} className="gap-1.5">
        <RefreshCw className={cn("h-3.5 w-3.5", retrying && "animate-spin")} aria-hidden="true" />
        {retrying ? "Retrying…" : "Retry"}
      </Button>
    </div>
  );
}

/** Data arrived, but nothing is left to show. Names what is narrowing it. */
export function VenueListEmpty({
  copy,
  onClearFilters,
  onWidenRadius,
  widenLabel,
}: {
  copy: EmptyStateCopy;
  onClearFilters: () => void;
  /** Offer a wider radius (only when the radius is the cause). */
  onWidenRadius?: () => void;
  widenLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
      <MapPin className="mb-3 h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-semibold">{copy.title}</p>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">{copy.detail}</p>
      {copy.activeFilters.length > 0 && (
        <p className="mt-2 max-w-xs text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Filters:</span> {copy.activeFilters.join(" · ")}
        </p>
      )}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {copy.canClear && (
          <Button size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        )}
        {onWidenRadius && widenLabel && (
          <Button size="sm" variant="outline" onClick={onWidenRadius}>
            {widenLabel}
          </Button>
        )}
        <Button variant="outline" size="sm" asChild>
          <Link to="/submit">Submit a deal</Link>
        </Button>
      </div>
    </div>
  );
}
