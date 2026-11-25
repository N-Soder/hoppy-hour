import { forwardRef, useEffect, useState, type RefObject } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, MapPin, Navigation, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import LiveBadge from "@/components/LiveBadge";
import type { VenueWithHappyHours } from "@/hooks/use-venues";
import { DAYS_LONG, DAYS_SHORT } from "@/lib/constants";
import { splitOffers, type DealOffer } from "@/lib/deal-text";
import { formatDistance, formatTimeRange, plural, type SelectionLabel } from "@/lib/format";
import { dealsOnDay, formatDayRange, groupByDaySet, groupHappyHours, type GroupedHappyHour } from "@/lib/happy-hour-utils";
import { directionsUrlForBrowser } from "@/lib/directions";
import { suggestEditUrl } from "@/lib/venue-prefill";
import { cn } from "@/lib/utils";
import type { VenueStatus } from "@/lib/venue-status";

export type { VenueStatus } from "@/lib/venue-status";

/**
 * "Perth time": a quiet note that the times beside it are in the venue's zone,
 * shown only when that zone's clock differs from the viewer's.
 */
export function ZoneNote({ note, className }: { note: string | null | undefined; className?: string }) {
  if (!note) return null;
  return (
    <span className={cn("flex-shrink-0 whitespace-nowrap text-[11px] text-muted-foreground", className)}>
      <span aria-hidden="true">· </span>
      {note}
    </span>
  );
}

/** One line: LIVE badge (or the next deal) plus the deal count. */
export function VenueStatusLine({
  status,
  selection,
  zoneNote,
  className,
}: {
  status: VenueStatus;
  selection: SelectionLabel;
  /** "Perth time" when the venue's clock differs from the viewer's. */
  zoneNote?: string | null;
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
      <ZoneNote note={zoneNote} />
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
  /** Weekday of the selected date (0=Sun…6=Sat): its deals are listed first. */
  selectedDay: number;
  selectedIsToday: boolean;
  /** "Perth time" when the venue's clock differs from the viewer's (deal times are venue time). */
  zoneNote?: string | null;
  /** Set when the venue lies outside the search radius (opened from a link). */
  outsideRadiusNote?: string | null;
  /** Id for the heading, so the containing dialog/panel can be labelled by it. */
  headingId: string;
  /** Leave out the name/status header (the sheet draws its own). */
  hideHeader?: boolean;
}

/**
 * The full venue detail: name, address, distance, actions, then the selected
 * day's deals ("Today" when it is today) by start time, each with the days it
 * runs, then the venue's other deals grouped by day set in Monday-first order.
 * Shared by the desktop side panel and the phone bottom sheet.
 */
const VenueDetail = forwardRef<HTMLHeadingElement, VenueDetailProps>(function VenueDetail(
  { venue, status, selection, filteredHappyHourIds, selectedDay, selectedIsToday, zoneNote, outsideRadiusNote, headingId, hideHeader },
  headingRef,
) {
  const grouped = groupHappyHours(venue.happy_hours);
  const today = dealsOnDay(grouped, selectedDay);
  // Today's deals carry their day set, so the rest of the week lists only the
  // others: the full schedule without printing a deal twice.
  const todayIds = new Set(today.map((d) => d.ids[0]));
  const sections = groupByDaySet(grouped.filter((d) => !todayIds.has(d.ids[0])));
  const dayName = selectedIsToday ? "Today" : DAYS_LONG[selectedDay];

  return (
    <div className="space-y-4">
      {!hideHeader && (
        <div>
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold leading-tight focus:outline-none">
            {venue.name}
          </h2>
          <VenueStatusLine status={status} selection={selection} zoneNote={zoneNote} className="mt-1" />
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

      {grouped.length === 0 ? (
        <section className="border-t border-border pt-4" aria-labelledby={`${headingId}-deals`}>
          <h3 id={`${headingId}-deals`} className={sectionLabel}>
            Deals
          </h3>
          <p className="text-sm text-muted-foreground">No deals listed</p>
        </section>
      ) : (
        <>
          <section className="border-t border-border pt-4" aria-labelledby={`${headingId}-today`}>
            <h3 id={`${headingId}-today`} className={cn(sectionLabel, "flex items-baseline gap-1.5")}>
              {dayName}
              {zoneNote && <span className="normal-case tracking-normal font-normal">· times are {zoneNote}</span>}
            </h3>
            {today.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No deals {selectedIsToday ? "today" : `on ${DAYS_LONG[selectedDay]}`}
              </p>
            ) : (
              <ul className="space-y-4">
                {today.map((deal) => (
                  <li key={deal.ids[0]} className={dayRow}>
                    {/* The days this deal runs, so Today lines up with the timetable below. */}
                    <span className={cn(dayCell, "font-normal text-muted-foreground")}>
                      {deal.days_of_week.length === 1
                        ? `${DAYS_SHORT[deal.days_of_week[0]]} only`
                        : formatDayRange(deal.days_of_week)}
                    </span>
                    <DealBody
                      deal={deal}
                      on={deal.ids.some((id) => filteredHappyHourIds.has(id))}
                      selection={selection}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {sections.length > 0 && (
            <section className="border-t border-border pt-4" aria-labelledby={`${headingId}-week`}>
              <h3 id={`${headingId}-week`} className={sectionLabel}>
                Other days
              </h3>
              <ul className="space-y-4">
                {sections.map(({ days, deals }) => (
                  <li key={days.join(",")} className={dayRow}>
                    <h4 className={dayCell}>{formatDayRange(days)}</h4>
                    <ul className="space-y-3">
                      {deals.map((deal) => (
                        <li key={deal.ids[0]}>
                          <DealBody deal={deal} on={false} selection={selection} />
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
});

export default VenueDetail;

/** Small grey label over each part of the deal list. */
const sectionLabel = "mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground";
/** A timetable row: the days in a fixed column, the deals beside them. */
const dayRow = "grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3";
const dayCell = "text-sm font-medium leading-snug";

/** "beer" → "Beer". */
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * One deal: its time (with the live state), then its offers one per line,
 * each price in a narrow column beside the text, then its tags.
 */
function DealBody({ deal, on, selection }: { deal: GroupedHappyHour; on: boolean; selection: SelectionLabel }) {
  const { title, offers } = splitOffers(deal.description);
  return (
    <div className="min-w-0 text-sm leading-snug">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className={cn("tabular-nums", on && "font-medium text-primary")}>
          {formatTimeRange(deal.start_time, deal.end_time)}
        </span>
        {on && <LiveBadge selection={selection} />}
      </div>
      {title && <p className="mt-1 font-medium">{title}</p>}
      {offers.length === 1 ? (
        <Offer offer={offers[0]} as="p" />
      ) : (
        offers.length > 1 && (
          // Prices share one column (subgrid), so their text lines up.
          <ul className={offerGrid}>
            {offers.map((o, i) => (
              <Offer key={i} offer={o} as="li" alignToText={offers.some((x) => x.price)} />
            ))}
          </ul>
        )
      )}
      {deal.tags && deal.tags.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">{deal.tags.map(capitalise).join(" · ")}</p>
      )}
    </div>
  );
}

const offerGrid = "mt-0.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5";

/**
 * One offer line: a leading price bold in its own column with the text beside
 * it (wrapping under the text, not the price), else the text full width. Price
 * and text stay in one element so a screen reader reads "$9 pints of …".
 */
function Offer({ offer, as: Tag, alignToText = false }: { offer: DealOffer; as: "li" | "p"; alignToText?: boolean }) {
  if (!offer.price) {
    // Beside priced siblings, an unpriced offer ("free pool") lines up with
    // their text, not under their prices.
    return (
      <Tag className={cn("break-words", alignToText ? "col-start-2" : "col-span-2", Tag === "p" && "mt-0.5")}>
        {offer.text}
      </Tag>
    );
  }
  return (
    <Tag className={Tag === "li" ? "col-span-2 grid grid-cols-subgrid" : offerGrid}>
      <span className="font-semibold tabular-nums">{offer.price}</span>{" "}
      <span className="break-words">{offer.text}</span>
    </Tag>
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
