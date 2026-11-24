import { forwardRef, useEffect, useState, type RefObject } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Clock, MapPin, Navigation, PencilLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import LiveBadge from "@/components/LiveBadge";
import type { VenueWithHappyHours } from "@/hooks/use-venues";
import { DAYS_SHORT } from "@/lib/constants";
import { formatDistance, formatTimeRange, plural, type SelectionLabel } from "@/lib/format";
import { formatDayRange, groupByDaySet, groupHappyHours, type GroupedHappyHour } from "@/lib/happy-hour-utils";
import { directionsUrlForBrowser } from "@/lib/directions";
import { suggestEditUrl } from "@/lib/venue-prefill";
import { cn } from "@/lib/utils";
import type { VenueStatus } from "@/lib/venue-status";

export type { VenueStatus } from "@/lib/venue-status";

/** One line: LIVE badge (or the next deal) plus the deal count. */
export function VenueStatusLine({
  status,
  selection,
  className,
}: {
  status: VenueStatus;
  selection: SelectionLabel;
  className?: string;
}) {
  return (
    <p className={cn("flex min-w-0 items-center gap-2 text-xs", className)}>
      {status.isLive ? (
        <>
          <LiveBadge selection={selection} />
          <span className="text-muted-foreground">{plural(status.liveCount, "deal")} on</span>
        </>
      ) : status.nextLabel ? (
        <span className="min-w-0 truncate font-medium">
          <span className="text-muted-foreground">Next:</span> {status.nextLabel}
        </span>
      ) : (
        <span className="text-muted-foreground">
          {status.dealCount > 0 ? "No deal matches your filters" : "No deals listed"}
        </span>
      )}
      {!status.isLive && status.dealCount > 0 && (
        <span className="ml-auto flex-shrink-0 whitespace-nowrap text-muted-foreground">
          {plural(status.dealCount, "deal")}
        </span>
      )}
    </p>
  );
}

/** Primary Directions and secondary Suggest an edit. */
export function VenueActions({ venue, className }: { venue: VenueWithHappyHours; className?: string }) {
  return (
    <div className={cn("flex gap-2", className)}>
      <Button asChild className="flex-1 gap-2">
        <a href={directionsUrlForBrowser(venue)} target="_blank" rel="noopener noreferrer">
          <Navigation className="h-4 w-4" aria-hidden="true" />
          Directions
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </Button>
      <Button asChild variant="outline" className="flex-1 gap-2">
        <Link to={suggestEditUrl(venue)}>
          <PencilLine className="h-4 w-4" aria-hidden="true" />
          Suggest an edit
        </Link>
      </Button>
    </div>
  );
}

interface VenueDetailProps {
  venue: VenueWithHappyHours;
  status: VenueStatus;
  selection: SelectionLabel;
  /** Deals on at the selection (to mark them). */
  filteredHappyHourIds: Set<string>;
  /** Weekday of the selected date (0=Sun…6=Sat): its deals come first. */
  selectedDay: number;
  selectedIsToday: boolean;
  /** Set when the venue lies outside the search radius (opened from a link). */
  outsideRadiusNote?: string | null;
  /** Id for the heading, so the containing dialog/panel can be labelled by it. */
  headingId: string;
  /** Leave out the name/status header (the sheet draws its own). */
  hideHeader?: boolean;
}

/**
 * The full venue detail: name, address, distance, actions, then deals grouped
 * by day in Monday-first order with the selected day's groups first.
 * Shared by the desktop side panel and the phone bottom sheet.
 */
const VenueDetail = forwardRef<HTMLHeadingElement, VenueDetailProps>(function VenueDetail(
  { venue, status, selection, filteredHappyHourIds, selectedDay, selectedIsToday, outsideRadiusNote, headingId, hideHeader },
  headingRef,
) {
  const grouped = groupHappyHours(venue.happy_hours);
  const sections = groupByDaySet(grouped);
  // Stable partition: the selected day's sections first, then the rest in week order.
  const ordered = [
    ...sections.filter((s) => s.days.includes(selectedDay)),
    ...sections.filter((s) => !s.days.includes(selectedDay)),
  ];
  const dayMark = selectedIsToday ? "Today" : DAYS_SHORT[selectedDay];

  return (
    <div className="space-y-4">
      {!hideHeader && (
        <div>
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold leading-tight focus:outline-none">
            {venue.name}
          </h2>
          <VenueStatusLine status={status} selection={selection} className="mt-1" />
        </div>
      )}

      <div className="space-y-1.5 text-sm">
        <p className="flex items-start gap-2 text-muted-foreground">
          <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <span>{venue.address}</span>
        </p>
        <p className="flex items-center gap-2">
          <Navigation className="h-4 w-4 flex-shrink-0 text-primary" aria-hidden="true" />
          <span className="font-medium text-primary">{formatDistance(venue.distance_meters)} away</span>
        </p>
        {outsideRadiusNote && <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{outsideRadiusNote}</p>}
      </div>

      <VenueActions venue={venue} />

      <section className="border-t border-border pt-4" aria-labelledby={`${headingId}-deals`}>
        <h3 id={`${headingId}-deals`} className="mb-3 text-sm font-semibold">
          Deals
        </h3>
        {ordered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deals listed</p>
        ) : (
          <div className="space-y-4">
            {ordered.map(({ days, deals }) => {
              const isSelectedDay = days.includes(selectedDay);
              return (
                <div
                  key={days.join(",")}
                  className={cn("border-l-2 pl-3", isSelectedDay ? "border-primary" : "border-primary/25")}
                >
                  <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {formatDayRange(days)}
                    {isSelectedDay && (
                      <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] normal-case tracking-normal text-primary-foreground">
                        {dayMark}
                      </span>
                    )}
                  </h4>
                  <ul className="space-y-3">
                    {deals.map((deal) => (
                      <DealItem
                        key={deal.ids[0]}
                        deal={deal}
                        on={deal.ids.some((id) => filteredHappyHourIds.has(id))}
                        selection={selection}
                      />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
});

export default VenueDetail;

function DealItem({ deal, on, selection }: { deal: GroupedHappyHour; on: boolean; selection: SelectionLabel }) {
  return (
    <li>
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <Clock className={cn("h-3.5 w-3.5 flex-shrink-0", on ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
        <span className={cn("tabular-nums", on && "text-primary")}>{formatTimeRange(deal.start_time, deal.end_time)}</span>
        {on && <LiveBadge selection={selection} className="ml-1" />}
      </div>
      <p className="mt-0.5 text-sm leading-snug">{deal.description}</p>
      {deal.tags && deal.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {deal.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs capitalize">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * A "more below" cue pinned to the bottom of a scroll container: a fade and a
 * chevron while there is content past the fold. Place it as the container's
 * last child.
 */
export function ScrollCue({ scrollRef }: { scrollRef: RefObject<HTMLElement> }) {
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    Array.from(el.children).forEach((c) => ro.observe(c));
    return () => {
      el.removeEventListener("scroll", check);
      ro.disconnect();
    };
  }, [scrollRef]);
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none sticky bottom-0 -mt-12 flex h-12 items-end justify-center bg-gradient-to-t from-background to-transparent pb-1 transition-opacity",
        more ? "opacity-100" : "opacity-0",
      )}
    >
      <ChevronDown className="h-5 w-5 text-muted-foreground" />
    </div>
  );
}
